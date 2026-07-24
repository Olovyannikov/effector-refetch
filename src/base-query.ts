import {
  attach,
  combine,
  createEffect,
  createEvent,
  createStore,
  is,
  merge,
  sample,
  type Effect,
  type Event,
  type EventCallable,
  type Store,
} from 'effector';

import type {
  AbortReason,
  CacheAdapter,
  ConcurrencyStrategy,
  CreateQueryConfig,
  CreateQueryHandlerConfig,
  Query,
  QueryStatus,
  ResolvedCache,
  ResolvedRetry,
  SourcedConfig,
} from './types';
import { ValidationError } from './validation';
import { provideAbortSignal, RequestError, takeAbortSignal } from './request';
import { $queryCache } from './cache';
import { $queryDefaults, type QueryDefaults } from './defaults';
import { replaceEqualDeep, stableStringify } from './utils';
import { makeTrigger } from './trigger';
import { setupPolling } from './engine/polling';
import { setupIntrospection } from './engine/introspection';

/** A never-aborted signal for runs that are not cancellable by design (prefetch). */
const NEVER_ABORTED = new AbortController().signal;

/** Fallback namespace id for queries without a `name` or an effect sid. */
let queryCounter = 0;

interface Run<P> {
  runId: number;
  params: P;
  /** Effect-level params: `mapParams(params, source)`, frozen at tag time (=== params without mapping). */
  mapped: unknown;
  /** Per-run deadline in ms (0 = off); resolved fork-correctly at tag time. */
  timeoutMs: number;
  /** Retries already performed for THIS run — per-run, so concurrent runs never share a budget. */
  attempts: number;
}
interface ExecDone<P, R> extends Run<P> {
  result: R;
}

/**
 * The engine. Contains ALL machinery (concurrency / retry / cache) always.
 *
 * Config is read fork-correctly through two layers:
 *  - reactive "sourced" stores ($strategySrc / $retryTimesSrc / $staleAfterSrc) —
 *    either the user's own Store (passed by `createQuery` for inline `Store` options)
 *    or a `createStore(null)` placeholder;
 *  - constant closures (strategyConst / retryTimesConst / staleAfterConst + retryRef /
 *    cacheRef) set by the standalone operators (post-hoc, fork-safe because config is
 *    global, not scoped state).
 *
 * Effective value = sourcedStoreValue ?? constant.
 */
export function createBaseQuery<Params, Result, Error = unknown, Mapped = Result>(
  config:
    | CreateQueryConfig<Params, Result, Error, Mapped>
    | CreateQueryHandlerConfig<Params, Result, Error, Mapped>,
  sourced: SourcedConfig = {},
): Query<Params, Result, Error, Mapped> {
  const effectFx =
    'effect' in config ? config.effect : (createEffect(config.handler) as Effect<Params, Result, Error>);

  // The AbortSignal is staged in a synchronous side channel right before the call and
  // consumed by the createRequestFx handler on its first line — so it survives any
  // composition (attach, wrappers); plain effects simply never read it. The finally
  // clears an unconsumed slot so it can't leak into an unrelated later call.
  const callEffect = (params: unknown, signal: AbortSignal): Promise<Result> => {
    provideAbortSignal(signal);
    try {
      return (effectFx as unknown as (p: unknown) => Promise<Result>)(params);
    } finally {
      takeAbortSignal();
    }
  };

  // params mapping (createQuery's `source` / `mapParams`): public params -> effect params,
  // resolved in the graph with the source store so each scope sees its own value.
  const mapCfg = config as { source?: Store<unknown> | Record<string, Store<unknown>>; mapParams?: unknown };
  const mapFn = (mapCfg.mapParams ?? null) as ((params: Params, src: unknown) => unknown) | null;
  const $mapSrc: Store<unknown> = mapCfg.source
    ? is.store(mapCfg.source)
      ? mapCfg.source
      : combine(mapCfg.source)
    : createStore(null);
  const mapOf = (params: Params, src: unknown): unknown => (mapFn ? mapFn(params, src) : params);

  const mapData = config.mapData ?? (({ result }) => result as unknown as Mapped);
  const mapError = config.mapError ?? (({ error }) => error);
  // a throwing user mapError must not kill the failure flow — fall back to the raw error
  const mapErrorSafe = (error: Error, params: Params): Error => {
    try {
      return mapError({ error, params });
    } catch {
      return error;
    }
  };

  // per-query namespace inside a SHARED scope adapter ($queryCache): name -> effect
  // sid (stable across server/client with the effector plugin) -> creation counter
  const cacheScopeId: string =
    config.name ?? (effectFx as { sid?: string | null }).sid ?? `q${++queryCounter}`;
  // only called on cache paths, where cacheRef is guaranteed non-null
  const cacheKeyOf = (mapped: unknown, scoped: boolean): string => {
    const key = cacheRef!.key(mapped as Params);
    return scoped ? `${cacheScopeId}:${key}` : key;
  };

  // devtools labelling: name the public units when a `name` (or `debug`) is given
  const ns = config.name ?? (config.debug ? 'query' : undefined);
  const nm = (suffix: string) => (ns ? { name: `${ns}.${suffix}` } : undefined);
  const evName = (suffix: string): string | undefined => (ns ? `${ns}.${suffix}` : undefined);

  // ---- config: reactive sourced stores (fork-correct) + constant closures ----
  const $strategySrc: Store<ConcurrencyStrategy | null> =
    sourced.strategy ?? createStore<ConcurrencyStrategy | null>(null);
  const $retryTimesSrc: Store<number | null> = sourced.retryTimes ?? createStore<number | null>(null);
  const $staleAfterSrc: Store<number | null> = sourced.staleAfter ?? createStore<number | null>(null);
  const $timeoutSrc: Store<number | null> = sourced.timeout ?? createStore<number | null>(null);
  const $debounceSrc: Store<number | null> = sourced.debounce ?? createStore<number | null>(null);
  const $intervalMs: Store<number> = is.store(config.refetchInterval)
    ? (config.refetchInterval as Store<number>)
    : createStore(typeof config.refetchInterval === 'number' ? config.refetchInterval : 0);

  // null = not explicitly configured -> the $queryDefaults layer (then built-ins) applies
  let strategyConst: ConcurrencyStrategy | null = null;
  let laneKeyConst: ((params: Params) => string) | null = null;
  let retryTimesConst = 0;
  let staleAfterConst: number | null = null;
  let timeoutConst: number | null = null;
  let debounceConst = 0;
  let fallbackRef: ((ctx: { error: Error; params: Params }) => Result) | null = null;
  let retryRef: {
    delay: ResolvedRetry<Error>['delay'];
    filter: ResolvedRetry<Error>['filter'];
    suppress: boolean;
  } | null = null;
  let cacheRef: {
    adapter: ResolvedCache<Params>['adapter'];
    key: (p: Params) => string;
    swr: boolean;
    dedupe: boolean;
  } | null = null;
  const dedupeKey = (mapped: unknown): string | null =>
    cacheRef && cacheRef.dedupe ? cacheRef.key(mapped as Params) : null;
  let validateRef: ((result: unknown, params: Params) => string[] | null) | null = null;
  let barrierRef = config.barrier ?? null;

  const swrOf = () => !!cacheRef && cacheRef.swr;
  // effective config: inline Store ?? explicit constant ?? $queryDefaults ?? built-in
  const stratOf = (v: ConcurrencyStrategy | null, defs: QueryDefaults): ConcurrencyStrategy =>
    v ?? strategyConst ?? defs.concurrency ?? 'TAKE_LATEST';
  const timesOf = (v: number | null, defs: QueryDefaults): number =>
    v ?? (retryRef ? retryTimesConst : (defs.retry ?? 0));
  const staleOf = (v: number | null, defs: QueryDefaults): number =>
    v ?? staleAfterConst ?? defs.staleAfter ?? Infinity;
  const timeoutOf = (v: number | null, defs: QueryDefaults): number => v ?? timeoutConst ?? defs.timeout ?? 0;
  const debounceOf = (v: number | null): number => v ?? debounceConst;
  // retry behavior for runs relying on `$queryDefaults.retry` (no explicit retry config)
  const DEFAULT_RETRY = { delay: () => 0, filter: () => true, suppress: true };
  const retryOf = (defs: QueryDefaults) => retryRef ?? ((defs.retry ?? 0) > 0 ? DEFAULT_RETRY : null);
  // concurrency lanes: runs whose (public) params map to the same key compete with each
  // other; runs in different lanes are independent. No key -> one lane ('') = old behavior.
  const laneOf = (params: Params): string => {
    if (!laneKeyConst) return '';
    // a throwing user key must not kill the propagation — degrade to the single lane
    try {
      return laneKeyConst(params);
    } catch {
      return '';
    }
  };
  const isCurrent = (
    strategy: ConcurrencyStrategy,
    laneIds: ReadonlyMap<string, number>,
    runId: number,
    params: Params,
  ) => (strategy === 'TAKE_EVERY' ? true : laneIds.get(laneOf(params)) === runId);
  // why a settle lost currency: its lane was re-tagged (superseded) or wiped (cancel/reset)
  const staleReason = (laneIds: ReadonlyMap<string, number>, params: Params): AbortReason =>
    laneIds.has(laneOf(params)) ? 'superseded' : 'cancelled';
  // shared sample predicates/payloads (also keeps the bundle small)
  const currentIn = (
    s: { laneIds: ReadonlyMap<string, number>; strat: ConcurrencyStrategy | null; defs: QueryDefaults },
    run: { runId: number; params: Params },
  ) => isCurrent(stratOf(s.strat, s.defs), s.laneIds, run.runId, run.params);
  const staleAbort = (s: { laneIds: ReadonlyMap<string, number> }, run: { params: Params }) => ({
    params: run.params,
    reason: staleReason(s.laneIds, run.params),
  });

  // ---- public units ----
  const start = createEvent<Params>(evName('start'));
  const refresh = createEvent<Params>(evName('refresh'));
  const prefetch = createEvent<Params>(evName('prefetch'));
  const reset = createEvent<void>(evName('reset'));
  const cancel = createEvent<void>(evName('cancel'));

  const resolvePlaceholder = (prev: Mapped | null): Mapped | null => {
    const p = config.placeholderData;
    if (p == null) return null;
    return typeof p === 'function' ? (p as (prev: Mapped | null) => Mapped | null)(prev) : p;
  };
  const initialData = config.initialData ?? resolvePlaceholder(null);

  const $enabled = config.enabled ?? createStore(true, nm('$enabled'));
  const $data = createStore<Mapped | null>(initialData ?? null, nm('$data'));
  const $isPlaceholderData = createStore(
    config.placeholderData != null && config.initialData == null,
    nm('$isPlaceholderData'),
  );
  const $error = createStore<Error | null>(null, nm('$error'));
  const $status = createStore<QueryStatus>('initial', nm('$status'));
  const $stale = createStore(false, nm('$stale'));
  const $params = createStore<Params | null>(null, nm('$params'));

  const aborted = createEvent<{ params: Params; reason: AbortReason }>(evName('aborted'));
  // farfetched-compatible `finished.skip`: the `enabled` gate prevented execution.
  const skipped = createEvent<{ params: Params }>(evName('finished.skip'));
  const finishedDone = createEvent<{ params: Params; result: Mapped }>(evName('finished.done'));
  const finishedFail = createEvent<{ params: Params; error: Error }>(evName('finished.fail'));
  const finishedFinally = createEvent<{ params: Params; status: 'done' | 'fail' }>(
    evName('finished.finally'),
  );

  // ---- internal units ----
  const $runId = createStore(0, nm('$runId'));
  // lane -> last tagged runId; currency checks compare against their own lane only.
  // Always replaced immutably, so the shared initial Map is never written to.
  const $laneIds = createStore<ReadonlyMap<string, number>>(new Map(), {
    ...nm('$laneIds'),
    serialize: 'ignore',
  });
  // count of runs currently in a retry pause; $retrying derives from it, so one run's
  // pause ending (or a debounce sleep, which has its own effect) can't clear another's
  const $retryWaits = createStore(0, nm('$retryWaits'));
  const $retrying = $retryWaits.map((n) => n > 0);

  const sleep = ({ ms, payload }: { ms: number; payload: unknown }) =>
    new Promise((res) => setTimeout(() => res(payload), ms));
  const debounceSleepFx = createEffect<{ ms: number; payload: unknown }, unknown>({
    name: evName('debounceSleepFx'),
    handler: sleep,
  });
  const retrySleepFx = createEffect<{ ms: number; payload: unknown }, unknown>({
    name: evName('retrySleepFx'),
    handler: sleep,
  });

  // ---- per-scope run registry (in-flight controllers + dedupe keys) ----
  // A mutable container held in a store — NOT in the closure — so that every scope (and
  // the scope-less world) lazily creates its OWN container via the reducer below. This is
  // what keeps cancel / TAKE_LATEST in one fork from aborting another fork's in-flight
  // runs, and dedupe from coalescing requests across scopes (parallel SSR requests).
  // Container mutation (add/delete) deliberately bypasses store updates: runs only need
  // scope-correct identity, not reactivity.
  interface RunRegistry {
    /** lane -> in-flight AbortControllers of that lane */
    controllers: Map<string, Set<AbortController>>;
    inflightKeys: Set<string>;
    /** lane -> number of runs occupying it (barrier wait + effect execution) */
    laneBusy: Map<string, number>;
  }
  const $runRegistry = createStore<RunRegistry | null>(null, {
    ...nm('$runRegistry'),
    serialize: 'ignore',
  });
  const ensureRegistry = createEvent(evName('ensureRegistry'));
  $runRegistry.on(
    ensureRegistry,
    (reg) => reg ?? { controllers: new Map(), inflightKeys: new Set(), laneBusy: new Map() },
  );

  const laneDelta = (reg: RunRegistry | null, lane: string, d: number): void => {
    if (!reg) return;
    const next = (reg.laneBusy.get(lane) ?? 0) + d;
    if (next > 0) reg.laneBusy.set(lane, next);
    else reg.laneBusy.delete(lane);
  };
  const laneIsBusy = (reg: RunRegistry | null, params: Params): boolean =>
    !!reg && (reg.laneBusy.get(laneOf(params)) ?? 0) > 0;

  // abort in-flight runs of one lane (TAKE_LATEST supersede) or of all lanes (null:
  // cancel / reset) — always only within the acting scope's registry
  const abortSet = (set?: Set<AbortController>) => {
    set?.forEach((c) => c.abort());
    set?.clear();
  };
  const abortInFlightFx = attach({
    name: evName('abortInFlightFx'),
    source: $runRegistry,
    effect(reg: RunRegistry | null, lane: string | null) {
      if (!reg) return;
      if (lane == null) reg.controllers.forEach(abortSet);
      else abortSet(reg.controllers.get(lane));
    },
  });

  // `reg` is non-null on every engine path (ensureRegistry fires on `requested`, and
  // effects read their attached source only after that pure update applies); the guards
  // only cover direct `__.runFx` escape-hatch calls, which skip run tracking.
  const runFx = attach({
    name: ns ? `${ns}.runFx` : undefined,
    source: $runRegistry,
    effect: async (reg, { runId, params, mapped, timeoutMs, attempts }: Run<Params>) => {
      const key = dedupeKey(mapped);
      if (key) reg?.inflightKeys.add(key);
      const lane = laneOf(params);
      laneDelta(reg, lane, 1);
      // always allocate: attach-wrapped abortable effects don't carry the __abortable
      // marker, but the signal still reaches them through the side channel
      const controller = new AbortController();
      let laneSet: Set<AbortController> | undefined;
      if (reg) {
        laneSet = reg.controllers.get(lane);
        if (!laneSet) reg.controllers.set(lane, (laneSet = new Set()));
        laneSet.add(controller);
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const exec = callEffect(mapped, controller.signal);
        if (!timeoutMs || timeoutMs <= 0) {
          return { runId, params, mapped, timeoutMs, attempts, result: await exec };
        }
        // race the request against a deadline; on timeout, abort it (abortable
        // effects actually stop) and reject — the normal fail/retry path handles it
        const timedOut = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new RequestError(`Request timed out after ${timeoutMs}ms`, { reason: 'timeout' }));
          }, timeoutMs);
        });
        const result = (await Promise.race([exec, timedOut])) as Result;
        return { runId, params, mapped, timeoutMs, attempts, result };
      } finally {
        if (timer) clearTimeout(timer);
        if (key) reg?.inflightKeys.delete(key);
        laneDelta(reg, lane, -1);
        if (laneSet) {
          laneSet.delete(controller);
          if (laneSet.size === 0) reg?.controllers.delete(lane);
        }
      }
    },
  }) as unknown as Effect<Run<Params>, ExecDone<Params, Result>, Error>;

  // ---- barrier gate ----
  // A run waits on the barrier (e.g. a token refresh) BEFORE hitting the effect. The
  // wait lives in its own effect — not inside runFx — so that when the barrier opens we
  // re-check currency in the graph (fork-correct $runId) and drop a superseded/cancelled
  // run WITHOUT performing its request. Runs with no barrier attached skip this hop.
  const toRunFx = createEvent<Run<Params>>(evName('toRunFx'));
  // occupies the run's lane while waiting, so TAKE_FIRST sees barrier-gated runs as busy
  const barrierWaitFx = attach({
    name: evName('barrierWaitFx'),
    source: $runRegistry,
    effect: async (reg, run: Run<Params>) => {
      const lane = laneOf(run.params);
      laneDelta(reg, lane, 1);
      try {
        if (barrierRef) await barrierRef.__.wait();
      } finally {
        laneDelta(reg, lane, -1);
      }
      return run;
    },
  });
  // no barrier attached -> straight to the effect
  sample({ clock: toRunFx, filter: () => !barrierRef, target: runFx });
  // barrier attached -> wait for it to open
  sample({ clock: toRunFx, filter: () => !!barrierRef, target: barrierWaitFx });
  // barrier opened: only the still-current run proceeds; a superseded/cancelled one is
  // dropped here, so it never reaches the network
  sample({
    clock: barrierWaitFx.doneData,
    source: { laneIds: $laneIds, strat: $strategySrc, defs: $queryDefaults },
    filter: currentIn,
    fn: (_s, run) => run,
    target: runFx,
  });
  sample({
    clock: barrierWaitFx.doneData,
    source: { laneIds: $laneIds, strat: $strategySrc, defs: $queryDefaults },
    filter: (s, run) => !currentIn(s, run),
    fn: staleAbort,
    target: aborted,
  });

  const requested = createEvent<{ params: Params; mapped: unknown; fresh: boolean; broken?: unknown }>(
    evName('requested'),
  );
  // lazily create this scope's run registry before anything can need it: effects read
  // their attached source at effect priority, after this pure update has applied
  sample({ clock: requested, target: ensureRegistry });
  // mapParams is applied HERE, with the source store sampled fork-correctly. A throwing
  // mapParams must not kill the propagation: the run is converted into a final failure
  // (routed below) instead of silently never starting.
  const mapOfSafe = (params: Params, src: unknown, fresh: boolean) => {
    try {
      return { params, mapped: mapOf(params, src), fresh, broken: null as unknown };
    } catch (error) {
      return { params, mapped: null as unknown, fresh, broken: error ?? new Error('mapParams failed') };
    }
  };
  sample({
    clock: start,
    source: $mapSrc,
    fn: (src, params) => mapOfSafe(params, src, false),
    target: requested,
  });
  sample({
    clock: refresh,
    source: $mapSrc,
    fn: (src, params) => mapOfSafe(params, src, true),
    target: requested,
  });

  // enabled gate (runs whose mapParams threw never reach it — they fail below)
  const allowed = sample({
    clock: requested,
    source: $enabled,
    filter: (enabled, r) => enabled && r.broken == null,
    fn: (_e, r) => r,
  });
  // blocked by the gate: `finished.skip` keeps its farfetched-compatible `{ params }`
  // payload; only `aborted` carries the reason
  const disabledBlock = sample({
    clock: requested,
    source: $enabled,
    filter: (enabled) => !enabled,
    fn: (_e, r) => ({ params: r.params }),
  });
  sample({ clock: disabledBlock, target: skipped });
  sample({
    clock: disabledBlock,
    fn: ({ params }) => ({ params, reason: 'disabled' as const }),
    target: aborted,
  });

  // concurrency gate (TAKE_FIRST drops while its lane is busy) — strategy sourced;
  // "busy" covers waiting on the barrier and executing the effect (registry laneBusy)
  const proceed = createEvent<{ params: Params; mapped: unknown; fresh: boolean }>(evName('proceed'));
  sample({
    clock: allowed,
    source: { reg: $runRegistry, strat: $strategySrc, defs: $queryDefaults },
    filter: ({ reg, strat, defs }, r) =>
      !(stratOf(strat, defs) === 'TAKE_FIRST' && laneIsBusy(reg, r.params)),
    fn: (_s, r) => r,
    target: proceed,
  });
  sample({
    clock: allowed,
    source: { reg: $runRegistry, strat: $strategySrc, defs: $queryDefaults },
    filter: ({ reg, strat, defs }, r) => stratOf(strat, defs) === 'TAKE_FIRST' && laneIsBusy(reg, r.params),
    fn: (_s, r) => ({ params: r.params, reason: 'take-first-busy' as const }),
    target: aborted,
  });

  // cache lookup / exec branch — presence via cacheRef, staleAfter sourced
  const toExec = createEvent<{ params: Params; mapped: unknown }>(evName('toExec'));
  const cacheHit = createEvent<{ params: Params; result: Result }>(evName('cacheHit'));
  // current-run success, before validation (carries runId for the retry path)
  const rawDone = createEvent<{
    runId: number;
    params: Params;
    mapped: unknown;
    result: Result;
    timeoutMs: number;
    attempts: number;
  }>(evName('rawDone'));
  // validated success — drives $data, cache write, finished.done
  const acceptedDone = createEvent<{ params: Params; mapped: unknown; result: Result }>(
    evName('acceptedDone'),
  );
  // SWR: a stale cache entry served immediately while a background refetch runs
  const staleServe = createEvent<{ params: Params; result: Result }>(evName('staleServe'));
  // fallback: a FINAL failure recovered into data (bypasses the cache write — the
  // fallback value is not server truth)
  const recovered = createEvent<{ params: Params; result: Result }>(evName('recovered'));

  const lookupFx = createEffect({
    name: evName('lookupFx'),
    handler: async ({
      params,
      mapped,
      staleAfter,
      adapter,
    }: {
      params: Params;
      mapped: unknown;
      staleAfter: number;
      adapter: CacheAdapter | null;
    }) => {
      const cfg = cacheRef;
      if (!cfg) return { entry: null, params, mapped, fresh: false };
      const entry = await (adapter ?? cfg.adapter).get(cacheKeyOf(mapped, adapter !== null));
      const fresh = entry != null && Date.now() - entry.storedAt < staleAfter;
      return { entry, params, mapped, fresh };
    },
  });
  sample({
    clock: proceed,
    filter: (r) => !cacheRef || r.fresh,
    fn: (r) => ({ params: r.params, mapped: r.mapped }),
    target: toExec,
  });
  sample({
    clock: proceed,
    source: { stale: $staleAfterSrc, adapter: $queryCache, defs: $queryDefaults },
    filter: (_s, r) => !!cacheRef && !r.fresh,
    fn: ({ stale, adapter, defs }, r) => ({
      params: r.params,
      mapped: r.mapped,
      staleAfter: staleOf(stale, defs),
      adapter,
    }),
    target: lookupFx,
  });
  sample({
    clock: lookupFx.doneData,
    filter: ({ fresh }) => fresh,
    fn: ({ entry, params }) => ({ params, result: (entry as { value: Result }).value }),
    target: cacheHit,
  });
  // SWR: stale entry present -> serve it now AND revalidate in the background
  sample({
    clock: lookupFx.doneData,
    filter: ({ fresh, entry }) => !fresh && entry != null && swrOf(),
    fn: ({ entry, params }) => ({ params, result: (entry as { value: Result }).value }),
    target: staleServe,
  });
  sample({
    clock: lookupFx.doneData,
    filter: ({ fresh, entry }) => !fresh && entry != null && swrOf(),
    fn: ({ params, mapped }) => ({ params, mapped }),
    target: toExec,
  });
  // miss, or stale without SWR -> just execute
  sample({
    clock: lookupFx.doneData,
    filter: ({ fresh, entry }) => !fresh && !(entry != null && swrOf()),
    fn: ({ params, mapped }) => ({ params, mapped }),
    target: toExec,
  });

  const setFx = createEffect({
    name: evName('setFx'),
    handler: (p: { params: Params; mapped: unknown; result: Result; adapter: CacheAdapter | null }) => {
      const cfg = cacheRef;
      if (cfg) (p.adapter ?? cfg.adapter).set(cacheKeyOf(p.mapped, p.adapter !== null), p.result, Date.now());
    },
  });
  sample({
    clock: acceptedDone,
    source: $queryCache,
    filter: () => !!cacheRef,
    fn: (adapter, p) => ({ ...p, adapter }),
    target: setFx,
  });

  // prefetch: warm the cache without touching $data/$status (cache-only; skips if fresh)
  const prefetchLookupFx = createEffect({
    name: evName('prefetchLookupFx'),
    handler: async ({
      params,
      mapped,
      staleAfter,
      adapter,
    }: {
      params: Params;
      mapped: unknown;
      staleAfter: number;
      adapter: CacheAdapter | null;
    }) => {
      const cfg = cacheRef;
      if (!cfg) return { params, mapped, adapter, fresh: false };
      const entry = await (adapter ?? cfg.adapter).get(cacheKeyOf(mapped, adapter !== null));
      return { params, mapped, adapter, fresh: entry != null && Date.now() - entry.storedAt < staleAfter };
    },
  });
  const prefetchRunFx = createEffect<
    { params: Params; mapped: unknown; adapter: CacheAdapter | null },
    { params: Params; mapped: unknown; result: Result; adapter: CacheAdapter | null },
    Error
  >({
    name: evName('prefetchRunFx'),
    handler: async ({ params, mapped, adapter }) => ({
      params,
      mapped,
      adapter,
      result: await callEffect(mapped, NEVER_ABORTED),
    }),
  });
  sample({
    clock: prefetch,
    source: { src: $mapSrc, stale: $staleAfterSrc, adapter: $queryCache, defs: $queryDefaults },
    filter: () => !!cacheRef,
    fn: ({ src, stale, adapter, defs }, params) => ({
      params,
      mapped: mapOf(params, src),
      staleAfter: staleOf(stale, defs),
      adapter,
    }),
    target: prefetchLookupFx,
  });
  sample({
    clock: prefetchLookupFx.doneData,
    filter: ({ fresh }) => !fresh,
    fn: ({ params, mapped, adapter }) => ({ params, mapped, adapter }),
    target: prefetchRunFx,
  });
  sample({ clock: prefetchRunFx.doneData, target: setFx });

  // purge seam: an event (targetable by the cache() operator) sampled with the scope
  // adapter. In a SHARED scope adapter only this query's namespaced entries are removed
  // (via dump), so one query's purge can't wipe its neighbours.
  const purgeRequested = createEvent<void>(evName('purge'));
  const purgeFx = createEffect({
    name: evName('purgeFx'),
    handler: ({ adapter }: { adapter: CacheAdapter | null }) => {
      const cfg = cacheRef;
      if (!cfg) return;
      if (!adapter) {
        cfg.adapter.purge();
        return;
      }
      if (typeof adapter.dump === 'function') {
        const prefix = `${cacheScopeId}:`;
        for (const entry of adapter.dump()) if (entry.key.startsWith(prefix)) adapter.remove(entry.key);
      } else {
        adapter.purge();
      }
    },
  });
  sample({
    clock: purgeRequested,
    source: $queryCache,
    fn: (adapter) => ({ adapter }),
    target: purgeFx,
  });

  // dedupe gate: drop a run whose key is already in flight (coalesce) — per scope
  const toRun = createEvent<{ params: Params; mapped: unknown }>(evName('toRun'));
  sample({
    clock: toExec,
    source: $runRegistry,
    filter: (reg, r) => {
      const key = dedupeKey(r.mapped);
      return !key || !reg || !reg.inflightKeys.has(key);
    },
    fn: (_reg, r) => r,
    target: toRun,
  });

  // tag with a fresh runId (attempts start at 0), then execute the real effect
  const tagged = sample({
    clock: toRun,
    source: { id: $runId, timeout: $timeoutSrc, defs: $queryDefaults },
    fn: ({ id, timeout, defs }, r): Run<Params> => ({
      runId: id + 1,
      params: r.params,
      mapped: r.mapped,
      timeoutMs: timeoutOf(timeout, defs),
      attempts: 0,
    }),
  });
  $runId.on(tagged, (_id, t) => t.runId);
  $laneIds.on(tagged, (map, t) => new Map(map).set(laneOf(t.params), t.runId));
  // TAKE_LATEST: abort the superseded in-flight request OF THIS LANE before the new one starts
  sample({
    clock: tagged,
    source: { strat: $strategySrc, defs: $queryDefaults },
    filter: ({ strat, defs }) => stratOf(strat, defs) === 'TAKE_LATEST',
    fn: (_s, t) => laneOf(t.params),
    target: abortInFlightFx,
  });
  // debounce: hold the tagged run in debounceSleepFx; the shared wake-up sample below
  // re-checks lane currency, so a newer run started during the wait drops this one BEFORE
  // the network (a true debounce under TAKE_LATEST). No debounce -> straight to the effect.
  sample({
    clock: tagged,
    source: $debounceSrc,
    filter: (d) => debounceOf(d) <= 0,
    fn: (_d, t) => t,
    target: toRunFx,
  });
  sample({
    clock: tagged,
    source: $debounceSrc,
    filter: (d) => debounceOf(d) > 0,
    fn: (d, t): { ms: number; payload: unknown } => ({ ms: debounceOf(d), payload: t }),
    target: debounceSleepFx,
  });

  $params
    .on(tagged, (_p, t) => t.params ?? null)
    .on(cacheHit, (_p, h) => h.params ?? null)
    .on(staleServe, (_p, h) => h.params ?? null);

  // ---- result acceptance (concurrency) ----
  sample({
    clock: runFx.done,
    source: { laneIds: $laneIds, strat: $strategySrc, defs: $queryDefaults },
    filter: (s, { result }) => currentIn(s, result),
    fn: (_s, { result }) => ({
      runId: result.runId,
      params: result.params,
      mapped: result.mapped,
      result: result.result,
      timeoutMs: result.timeoutMs,
      attempts: result.attempts,
    }),
    target: rawDone,
  });
  sample({
    clock: runFx.done,
    source: { laneIds: $laneIds, strat: $strategySrc, defs: $queryDefaults },
    filter: (s, { result }) => !currentIn(s, result),
    fn: (s, { result }) => staleAbort(s, result),
    target: aborted,
  });

  // ---- failure / retry ----
  const willRetry = (
    defs: QueryDefaults,
    strategy: ConcurrencyStrategy,
    laneIds: ReadonlyMap<string, number>,
    attempts: number,
    times: number,
    runId: number,
    params: Params,
    error: Error,
  ) => {
    const retry = retryOf(defs);
    return (
      !!retry &&
      isCurrent(strategy, laneIds, runId, params) &&
      attempts < times &&
      retry.filter({ error, attempt: attempts + 1 })
    );
  };

  const scheduleRetry = createEvent<Run<Params> & { error: Error }>(evName('scheduleRetry'));
  const finalFail = createEvent<{ params: Params; error: Error }>(evName('finalFail'));
  const intermediateFail = createEvent<{ params: Params; error: Error }>(evName('intermediateFail'));
  // unified failure stream: transport failures + validation failures
  const failed = createEvent<{
    runId: number;
    params: Params;
    mapped: unknown;
    error: Error;
    timeoutMs: number;
    attempts: number;
  }>(evName('failed'));

  // validation gate: a current-run success must pass the contract / validate fn,
  // otherwise it becomes a (retryable) ValidationError failure. Run the check ONCE
  // per result and carry its messages (null = ok), so the contract/schema isn't
  // re-evaluated across the two branches (and the error-message build).
  const checked = sample({
    clock: rawDone,
    fn: (r) => {
      // a throwing contract/validate is a validation failure, not a dead propagation
      let errors: string[] | null = null;
      if (validateRef) {
        try {
          errors = validateRef(r.result, r.params);
        } catch (e) {
          errors = [e instanceof globalThis.Error ? e.message : String(e)];
        }
      }
      return { ...r, errors };
    },
  });
  sample({
    clock: checked,
    filter: ({ errors }) => errors === null,
    fn: ({ params, mapped, result }) => ({ params, mapped, result }),
    target: acceptedDone,
  });
  sample({
    clock: checked,
    filter: ({ errors }) => errors !== null,
    fn: ({ runId, params, mapped, result, timeoutMs, attempts, errors }) => ({
      runId,
      params,
      mapped,
      error: new ValidationError(errors ?? [], result) as unknown as Error,
      timeoutMs,
      attempts,
    }),
    target: failed,
  });
  // transport failures into the same stream
  sample({
    clock: runFx.fail,
    fn: ({ params, error }) => ({
      runId: params.runId,
      params: params.params,
      mapped: params.mapped,
      error,
      timeoutMs: params.timeoutMs,
      attempts: params.attempts,
    }),
    target: failed,
  });

  // a run whose mapParams threw fails immediately (it never started executing)
  sample({
    clock: requested,
    filter: (r) => r.broken != null,
    fn: (r) => ({ params: r.params, error: r.broken as Error }),
    target: finalFail,
  });

  const failSource = {
    laneIds: $laneIds,
    timesSrc: $retryTimesSrc,
    strat: $strategySrc,
    defs: $queryDefaults,
  };
  // ONE atomic verdict per failure, split by filters below (deciding retry/final/stale
  // against a single snapshot avoids same-propagation races between the branches).
  // Attempts ride in the failure payload itself — per-run, never shared state.
  const failVerdict = sample({
    clock: failed,
    source: failSource,
    fn: (s, f) => {
      const retry = willRetry(
        s.defs,
        stratOf(s.strat, s.defs),
        s.laneIds,
        f.attempts,
        timesOf(s.timesSrc, s.defs),
        f.runId,
        f.params,
        f.error,
      );
      let kind = retry
        ? ('retry' as const)
        : currentIn(s, f)
          ? fallbackRef
            ? ('recover' as const)
            : ('final' as const)
          : ('stale' as const);
      // the fallback value is computed HERE, once, under a guard: a throwing fallback
      // demotes the verdict to a plain final failure with the ORIGINAL request error
      let recoveredValue: Result | null = null;
      if (kind === 'recover') {
        try {
          recoveredValue = fallbackRef!({ error: f.error, params: f.params });
        } catch {
          kind = 'final' as const;
        }
      }
      return {
        f,
        kind,
        reason: staleReason(s.laneIds, f.params),
        recoveredValue,
        // mapError applied ONCE at construction; consumers use the payload as-is
        finalError: kind === 'final' ? mapErrorSafe(f.error, f.params) : null,
      };
    },
  });
  sample({
    clock: failVerdict,
    filter: ({ kind }) => kind === 'retry',
    fn: ({ f }) => ({
      runId: f.runId,
      params: f.params,
      mapped: f.mapped,
      error: f.error,
      timeoutMs: f.timeoutMs,
      attempts: f.attempts,
    }),
    target: scheduleRetry,
  });
  sample({
    clock: failVerdict,
    filter: ({ kind }) => kind === 'final',
    fn: ({ f, finalError }) => ({ params: f.params, error: finalError as Error }),
    target: finalFail,
  });
  // fallback recovers the final failure into data (aborts/skips never reach this stream)
  sample({
    clock: failVerdict,
    filter: ({ kind }) => kind === 'recover',
    fn: ({ f, recoveredValue }) => ({ params: f.params, result: recoveredValue as Result }),
    target: recovered,
  });
  sample({
    clock: failVerdict,
    filter: ({ kind }) => kind === 'stale',
    fn: ({ f, reason }) => ({ params: f.params, reason }),
    target: aborted,
  });

  // retry: wait, then re-run the same runId with attempts+1 (unless superseded meanwhile)
  $retryWaits.on(scheduleRetry, (n) => n + 1).on(retrySleepFx.finally, (n) => Math.max(0, n - 1));
  sample({
    clock: scheduleRetry,
    source: $queryDefaults,
    fn: (defs, s): { ms: number; payload: unknown } => ({
      // 1-based attempt number for the delay fn, from THIS run's own counter
      ms: (retryOf(defs)?.delay ?? (() => 0))(s.attempts + 1),
      payload: {
        runId: s.runId,
        params: s.params,
        mapped: s.mapped,
        timeoutMs: s.timeoutMs,
        attempts: s.attempts + 1,
      } as Run<Params>,
    }),
    target: retrySleepFx,
  });
  const sleepWake = merge([debounceSleepFx.doneData, retrySleepFx.doneData]);
  sample({
    clock: sleepWake,
    source: { laneIds: $laneIds, strat: $strategySrc, defs: $queryDefaults },
    filter: (s, payload) => currentIn(s, payload as Run<Params>),
    fn: (_s, payload) => payload as Run<Params>,
    target: toRunFx,
  });
  // a sleeping run (debounce wait / retry pause) that lost currency is DROPPED here —
  // emit aborted so observers (and startAsync deferreds) learn about it instead of
  // waiting forever
  sample({
    clock: sleepWake,
    source: { laneIds: $laneIds, strat: $strategySrc, defs: $queryDefaults },
    filter: (s, payload) => !currentIn(s, payload as Run<Params>),
    fn: (s, payload) => staleAbort(s, payload as Run<Params>),
    target: aborted,
  });

  // surface intermediate (retried) failures only when suppression is off
  sample({
    clock: scheduleRetry,
    filter: () => !!retryRef && retryRef.suppress === false,
    fn: ({ params, error }) => ({ params, error: mapErrorSafe(error, params) }),
    target: intermediateFail,
  });

  // ---- invalidation ----
  const invalidate = merge([reset, cancel]);
  $runId.on(invalidate, (id) => id + 1);
  $laneIds.reset(invalidate); // wipe currency in every lane -> pending settles report 'cancelled'
  $retryWaits.reset(invalidate);
  sample({ clock: invalidate, fn: () => null, target: abortInFlightFx });

  // ---- mapped-data stage ----
  // mapData runs ONCE per settle, under a guard: a throwing user mapper becomes a final
  // failure instead of a dead propagation, and $data / finished.done share the SAME
  // mapped object (they used to call mapData independently, losing identity equality).
  const mapDataSafe = (
    clock: Event<{ params: Params; result: Result }>,
  ): Event<{ params: Params; result: Mapped }> => {
    const outcome = sample({
      clock,
      fn: ({ params, result }) => {
        try {
          return { params, ok: true as const, value: mapData({ result, params }), error: null as unknown };
        } catch (error) {
          return { params, ok: false as const, value: null as never, error };
        }
      },
    });
    sample({
      clock: outcome,
      filter: (o) => !o.ok,
      fn: (o) => ({ params: o.params, error: o.error as Error }),
      target: finalFail,
    });
    return sample({
      clock: outcome,
      filter: (o) => o.ok,
      fn: (o) => ({ params: o.params, result: o.value as Mapped }),
    });
  };
  const dataAccepted = mapDataSafe(acceptedDone);
  const dataRecovered = mapDataSafe(recovered);
  const dataCacheHit = mapDataSafe(cacheHit);
  const dataStale = mapDataSafe(staleServe);

  // ---- state stores ----
  $status
    .on(dataStale, () => 'done' as const)
    .on(tagged, () => 'pending' as const)
    .on(dataAccepted, () => 'done' as const)
    .on(dataRecovered, () => 'done' as const)
    .on(dataCacheHit, () => 'done' as const)
    .on(finalFail, () => 'fail' as const)
    .reset(reset);
  // cancel leaves "pending" — settle the status to reflect what we have.
  // Only when actually in-flight: cancelling an already-settled query (done / fail)
  // is a no-op, so it can't flip a finished failure back to "done" on stale data.
  sample({
    clock: cancel,
    source: { data: $data, status: $status },
    filter: ({ status }) => status === 'pending',
    fn: ({ data }): QueryStatus => (data != null ? 'done' : 'initial'),
    target: $status,
  });

  const commitData = (prev: Mapped | null, value: Mapped): Mapped =>
    config.structuralSharing ? (replaceEqualDeep(prev, value) as Mapped) : value;

  // imperative writes (setQueryData): a value via setData, or a prev->next updater
  // via updateData. updateData applies the function in the reducer so `prev` is read
  // scope-correctly (no getState) in whatever scope the event fires.
  const setData = createEvent<Mapped | null>(evName('setData'));
  const updateData = createEvent<(prev: Mapped | null) => Mapped | null>(evName('updateData'));

  $data
    .on([dataAccepted, dataRecovered, dataCacheHit, dataStale], (prev, { result }) =>
      commitData(prev, result),
    )
    .on(setData, (_prev, value) => value)
    .on(updateData, (prev, fn) => fn(prev))
    .reset(reset);

  $error
    // finalFail / intermediateFail already carry the mapped error (mapped once, at construction)
    .on([finalFail, intermediateFail], (_e, { error }) => error)
    .reset([tagged, dataAccepted, dataRecovered, dataCacheHit, reset]);

  $stale
    .on(dataStale, () => true)
    .on([dataAccepted, dataRecovered, dataCacheHit], () => false)
    .reset(reset);

  $isPlaceholderData.on([dataAccepted, dataRecovered, dataCacheHit, dataStale], () => false).reset(reset);

  // Track the *current* run explicitly: a cancel/reset clears it immediately,
  // even if a non-abortable effect's promise is still resolving in the background.
  const $inflight = createStore(false, nm('$inflight'))
    .on(tagged, () => true)
    .on([dataAccepted, dataRecovered, finalFail, dataCacheHit], () => false)
    .on(invalidate, () => false);
  const $pending = combine($inflight, $retrying, (p, r) => p || r);

  // first load vs background refetch: a placeholder is not real data, initialData is
  const $isInitialLoading = combine(
    $pending,
    $data,
    $isPlaceholderData,
    (pending, data, placeholder) => pending && (data === null || placeholder),
  );
  const $isRefetching = combine($pending, $isInitialLoading, (p, initial) => p && !initial);

  // ---- finished / lifecycle wiring ----
  // the mapped events carry the SAME object instance that landed in $data
  sample({ clock: [dataAccepted, dataRecovered, dataCacheHit], target: finishedDone });
  sample({ clock: finalFail, target: finishedFail });
  sample({
    clock: finishedDone,
    fn: ({ params }) => ({ params, status: 'done' as const }),
    target: finishedFinally,
  });
  sample({
    clock: finishedFail,
    fn: ({ params }) => ({ params, status: 'fail' as const }),
    target: finishedFinally,
  });

  // ---- polling (refetchInterval) ----
  setupPolling<Params>({
    finishedDone,
    finishedFail,
    refresh,
    reset,
    $intervalMs,
    $enabled,
    $params,
    $status,
    nm,
    evName,
  });

  // ---- introspection (devtools / logger) ----
  const { inspectStart, inspectRun, inspectCacheHit, inspectCacheMiss, inspectRetry } = setupIntrospection<
    Params,
    Error
  >({
    requested,
    runFx,
    cacheHit,
    lookupDone: lookupFx.doneData,
    scheduleRetry,
    evName,
  });

  // ---- imperative start (startAsync) ----
  // A real Effect that resolves with THIS run's mapped data. Scope-correct by
  // construction: the handler synchronously fires scope-bound unit calls (imperative
  // calls inside handlers are supported by effector 23), registering a globally unique
  // token in a PER-SCOPE store; settles are then matched to tokens in the graph via
  // `sample`, and only the infrastructure `settleAsyncFx` touches the promise world.
  // The deferred map is keyed by the unique token, so scopes can never swap results.
  const asyncDeferreds = new Map<number, { resolve: (v: Mapped) => void; reject: (e: unknown) => void }>();
  let asyncTokenSeq = 0;

  const asyncCallRegistered = createEvent<{ token: number; key: string }>(evName('asyncCallRegistered'));
  const asyncTokensTaken = createEvent<number[]>(evName('asyncTokensTaken'));
  const $asyncTokens = createStore<Array<{ token: number; key: string }>>([], {
    ...nm('$asyncTokens'),
    serialize: 'ignore',
  })
    .on(asyncCallRegistered, (list, call) => [...list, call])
    .on(asyncTokensTaken, (list, tokens) => list.filter((t) => !tokens.includes(t.token)));

  // eslint-disable-next-line effector/enforce-effect-naming-convention -- public API name: `query.startAsync(params)` reads as a verb, the Fx suffix is an internal convention
  const startAsync = createEffect<Params, Mapped>({
    name: evName('startAsync'),
    handler: (params) =>
      new Promise<Mapped>((resolve, reject) => {
        const token = ++asyncTokenSeq;
        asyncDeferreds.set(token, { resolve, reject });
        // both calls are synchronous, BEFORE any await — that's what keeps them scope-bound
        asyncCallRegistered({ token, key: stableStringify(params) });
        start(params);
      }),
  });

  const settleAsyncFx = createEffect({
    name: evName('settleAsyncFx'),
    handler: ({ tokens, ok, value }: { tokens: number[]; ok: boolean; value: unknown }) => {
      for (const token of tokens) {
        const deferred = asyncDeferreds.get(token);
        asyncDeferreds.delete(token);
        if (!deferred) continue;
        if (ok) deferred.resolve(value as Mapped);
        else deferred.reject(value);
      }
    },
  });

  // oldest pending call with these params settles first (FIFO within a scope)
  const matchToken = (list: Array<{ token: number; key: string }>, params: Params) => {
    const key = stableStringify(params);
    return list.find((t) => t.key === key);
  };
  const matchTokens = (list: Array<{ token: number; key: string }>, params: Params) => {
    const key = stableStringify(params);
    return list.filter((t) => t.key === key).map((t) => t.token);
  };
  // Real settles resolve EVERY pending call with these params — dedupe coalesces several
  // startAsync calls into one run, and all of them deserve the winner's outcome. Aborts
  // take only the OLDEST matching call: a superseded duplicate must not reject the newer
  // caller whose replacement run is still flying.
  const wireSettle = <P extends { params: Params }>(
    clock: Event<P>,
    ok: boolean,
    all: boolean,
    toValue: (payload: P) => unknown,
  ): void => {
    const matched = sample({
      clock,
      source: $asyncTokens,
      filter: (list, { params }) => !!matchToken(list, params),
      fn: (list, payload) => ({
        tokens: all ? matchTokens(list, payload.params) : [matchToken(list, payload.params)!.token],
        ok,
        value: toValue(payload),
      }),
    });
    sample({ clock: matched, target: settleAsyncFx });
    sample({ clock: matched, fn: ({ tokens }) => tokens, target: asyncTokensTaken });
  };
  wireSettle(finishedDone, true, true, (p) => p.result);
  wireSettle(finishedFail, false, true, (p) => p.error);
  wireSettle(aborted, false, false, (p) => new Error(`startAsync: run discarded (${p.reason})`));

  const refetch = refresh;

  return {
    start: start as EventCallable<Params>,
    startAsync,
    refresh: refresh as EventCallable<Params>,
    refetch: refetch as EventCallable<Params>,
    prefetch: prefetch as EventCallable<Params>,
    reset,
    cancel,

    $data,
    $error,
    $status,
    $pending,
    $isInitialLoading,
    $isRefetching,
    $stale,
    $isPlaceholderData,
    $enabled,
    $params,

    finished: {
      done: finishedDone,
      fail: finishedFail,
      finally: finishedFinally,
      success: finishedDone,
      failure: finishedFail,
      skip: skipped,
    },
    aborted,

    __: {
      effect: effectFx,
      runFx,
      purgeFx: purgeRequested,
      setData,
      updateData,
      inspect: {
        start: inspectStart,
        run: inspectRun,
        done: finishedDone,
        fail: finishedFail,
        aborted,
        cacheHit: inspectCacheHit,
        cacheMiss: inspectCacheMiss,
        retry: inspectRetry,
      },
      // INVARIANT: these setters mutate per-instance closure config (strategyConst /
      // retryRef / cacheRef / validateRef / timeoutConst / barrierRef) read inside pure
      // sample filter/fn stages. They are fork-safe ONLY because config is global and set
      // once (by the standalone operators / inline sugar) BEFORE any fork. Genuinely
      // per-scope/reactive config must go through the $...Src stores instead — do NOT wire
      // these constants to scoped/reactive state, or fork-correctness breaks silently.
      setStrategy: (s) => {
        strategyConst = s;
      },
      setLaneKey: (fn) => {
        laneKeyConst = fn;
      },
      setRetry: (cfg) => {
        if (!cfg) {
          retryRef = null;
          retryTimesConst = 0;
          return;
        }
        retryRef = { delay: cfg.delay, filter: cfg.filter, suppress: cfg.suppress };
        retryTimesConst = cfg.times;
      },
      setCache: (cfg) => {
        if (!cfg) {
          cacheRef = null;
          return;
        }
        cacheRef = { adapter: cfg.adapter, key: cfg.key, swr: cfg.swr, dedupe: cfg.dedupe };
        staleAfterConst = cfg.staleAfter;
      },
      setValidate: (fn) => {
        validateRef = fn;
      },
      setTimeout: (ms) => {
        timeoutConst = ms;
      },
      setDebounce: (ms) => {
        debounceConst = ms;
      },
      setFallback: (fn) => {
        fallbackRef = fn as ((ctx: { error: Error; params: Params }) => Result) | null;
      },
      setBarrier: (b) => {
        barrierRef = b;
      },
    },

    '@@unitShape': () => ({
      data: $data,
      error: $error,
      status: $status,
      pending: $pending,
      isInitialLoading: $isInitialLoading,
      isRefetching: $isRefetching,
      stale: $stale,
      enabled: $enabled,
      params: $params,
      isPlaceholderData: $isPlaceholderData,
      start: start as EventCallable<Params>,
      startAsync,
      refetch: refetch as EventCallable<Params>,
      refresh: refresh as EventCallable<Params>,
      reset,
      cancel,
    }),

    '@@trigger': makeTrigger(finishedDone, evName('asTrigger')),
  };
}
