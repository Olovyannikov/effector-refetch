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
import { replaceEqualDeep } from './utils';
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
  const $intervalMs: Store<number> = is.store(config.refetchInterval)
    ? (config.refetchInterval as Store<number>)
    : createStore(typeof config.refetchInterval === 'number' ? config.refetchInterval : 0);

  // null = not explicitly configured -> the $queryDefaults layer (then built-ins) applies
  let strategyConst: ConcurrencyStrategy | null = null;
  let laneKeyConst: ((params: Params) => string) | null = null;
  let retryTimesConst = 0;
  let staleAfterConst: number | null = null;
  let timeoutConst: number | null = null;
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
  // retry behavior for runs relying on `$queryDefaults.retry` (no explicit retry config)
  const DEFAULT_RETRY = { delay: () => 0, filter: () => true, suppress: true };
  const retryOf = (defs: QueryDefaults) => retryRef ?? ((defs.retry ?? 0) > 0 ? DEFAULT_RETRY : null);
  // concurrency lanes: runs whose (public) params map to the same key compete with each
  // other; runs in different lanes are independent. No key -> one lane ('') = old behavior.
  const laneOf = (params: Params): string => (laneKeyConst ? laneKeyConst(params) : '');
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
  const $attempts = createStore(0, nm('$attempts'));
  const $retrying = createStore(false, nm('$retrying'));

  const sleepFx = createEffect<{ ms: number; payload: unknown }, unknown>({
    name: evName('sleepFx'),
    handler: ({ ms, payload }) => new Promise((res) => setTimeout(() => res(payload), ms)),
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
    effect: async (reg, { runId, params, mapped, timeoutMs }: Run<Params>) => {
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
          return { runId, params, mapped, timeoutMs, result: await exec };
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
        return { runId, params, mapped, timeoutMs, result };
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

  const requested = createEvent<{ params: Params; mapped: unknown; fresh: boolean }>(evName('requested'));
  // lazily create this scope's run registry before anything can need it: effects read
  // their attached source at effect priority, after this pure update has applied
  sample({ clock: requested, target: ensureRegistry });
  // mapParams is applied HERE, with the source store sampled fork-correctly
  sample({
    clock: start,
    source: $mapSrc,
    fn: (src, params) => ({ params, mapped: mapOf(params, src), fresh: false }),
    target: requested,
  });
  sample({
    clock: refresh,
    source: $mapSrc,
    fn: (src, params) => ({ params, mapped: mapOf(params, src), fresh: true }),
    target: requested,
  });

  // enabled gate
  const allowed = sample({
    clock: requested,
    source: $enabled,
    filter: (enabled) => enabled,
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
  }>(evName('rawDone'));
  // validated success — drives $data, cache write, finished.done
  const acceptedDone = createEvent<{ params: Params; mapped: unknown; result: Result }>(
    evName('acceptedDone'),
  );
  // SWR: a stale cache entry served immediately while a background refetch runs
  const staleServe = createEvent<{ params: Params; result: Result }>(evName('staleServe'));

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

  // tag with a fresh runId, reset attempts, then execute the real effect
  const tagged = sample({
    clock: toRun,
    source: { id: $runId, timeout: $timeoutSrc, defs: $queryDefaults },
    fn: ({ id, timeout, defs }, r): Run<Params> => ({
      runId: id + 1,
      params: r.params,
      mapped: r.mapped,
      timeoutMs: timeoutOf(timeout, defs),
    }),
  });
  $runId.on(tagged, (_id, t) => t.runId);
  $laneIds.on(tagged, (map, t) => new Map(map).set(laneOf(t.params), t.runId));
  $attempts.on(tagged, () => 0);
  // TAKE_LATEST: abort the superseded in-flight request OF THIS LANE before the new one starts
  sample({
    clock: tagged,
    source: { strat: $strategySrc, defs: $queryDefaults },
    filter: ({ strat, defs }) => stratOf(strat, defs) === 'TAKE_LATEST',
    fn: (_s, t) => laneOf(t.params),
    target: abortInFlightFx,
  });
  sample({ clock: tagged, target: toRunFx });

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
  }>(evName('failed'));

  // validation gate: a current-run success must pass the contract / validate fn,
  // otherwise it becomes a (retryable) ValidationError failure. Run the check ONCE
  // per result and carry its messages (null = ok), so the contract/schema isn't
  // re-evaluated across the two branches (and the error-message build).
  const checked = sample({
    clock: rawDone,
    fn: (r) => ({ ...r, errors: validateRef ? validateRef(r.result, r.params) : null }),
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
    fn: ({ runId, params, mapped, result, timeoutMs, errors }) => ({
      runId,
      params,
      mapped,
      error: new ValidationError(errors ?? [], result) as unknown as Error,
      timeoutMs,
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
    }),
    target: failed,
  });

  const failSource = {
    laneIds: $laneIds,
    attempts: $attempts,
    timesSrc: $retryTimesSrc,
    strat: $strategySrc,
    defs: $queryDefaults,
  };
  sample({
    clock: failed,
    source: failSource,
    filter: ({ laneIds, attempts, timesSrc, strat, defs }, { runId, params, error }) =>
      willRetry(defs, stratOf(strat, defs), laneIds, attempts, timesOf(timesSrc, defs), runId, params, error),
    fn: (_s, { runId, params, mapped, error, timeoutMs }) => ({ runId, params, mapped, error, timeoutMs }),
    target: scheduleRetry,
  });
  sample({
    clock: failed,
    source: failSource,
    filter: (s, f) =>
      currentIn(s, f) &&
      !willRetry(
        s.defs,
        stratOf(s.strat, s.defs),
        s.laneIds,
        s.attempts,
        timesOf(s.timesSrc, s.defs),
        f.runId,
        f.params,
        f.error,
      ),
    fn: (_s, { params, error }) => ({ params, error }),
    target: finalFail,
  });
  sample({
    clock: failed,
    source: { laneIds: $laneIds, strat: $strategySrc, defs: $queryDefaults },
    filter: (s, f) => !currentIn(s, f),
    fn: staleAbort,
    target: aborted,
  });

  // retry: bump attempts, wait, re-run the same runId (unless superseded meanwhile)
  $attempts.on(scheduleRetry, (n) => n + 1);
  $retrying.on(scheduleRetry, () => true);
  sample({
    clock: scheduleRetry,
    source: { attempt: $attempts, defs: $queryDefaults },
    fn: ({ attempt, defs }, s): { ms: number; payload: unknown } => ({
      ms: (retryOf(defs)?.delay ?? (() => 0))(attempt),
      payload: { runId: s.runId, params: s.params, mapped: s.mapped, timeoutMs: s.timeoutMs } as Run<Params>,
    }),
    target: sleepFx,
  });
  sample({
    clock: sleepFx.doneData,
    source: { laneIds: $laneIds, strat: $strategySrc, defs: $queryDefaults },
    filter: (s, payload) => currentIn(s, payload as Run<Params>),
    fn: (_s, payload) => payload as Run<Params>,
    target: toRunFx,
  });
  $retrying.reset(sleepFx.done);

  // surface intermediate (retried) failures only when suppression is off
  sample({
    clock: scheduleRetry,
    filter: () => !!retryRef && retryRef.suppress === false,
    fn: ({ params, error }) => ({ params, error }),
    target: intermediateFail,
  });

  // ---- invalidation ----
  const invalidate = merge([reset, cancel]);
  $runId.on(invalidate, (id) => id + 1);
  $laneIds.reset(invalidate); // wipe currency in every lane -> pending settles report 'cancelled'
  $retrying.reset(invalidate);
  sample({ clock: invalidate, fn: () => null, target: abortInFlightFx });

  // ---- state stores ----
  $status
    .on(staleServe, () => 'done' as const)
    .on(tagged, () => 'pending' as const)
    .on(acceptedDone, () => 'done' as const)
    .on(cacheHit, () => 'done' as const)
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
    .on(acceptedDone, (prev, { params, result }) => commitData(prev, mapData({ result, params })))
    .on(cacheHit, (prev, { params, result }) => commitData(prev, mapData({ result, params })))
    .on(staleServe, (prev, { params, result }) => commitData(prev, mapData({ result, params })))
    .on(setData, (_prev, value) => value)
    .on(updateData, (prev, fn) => fn(prev))
    .reset(reset);

  $error
    .on(finalFail, (_e, { params, error }) => mapError({ error, params }))
    .on(intermediateFail, (_e, { params, error }) => mapError({ error, params }))
    .reset([tagged, acceptedDone, cacheHit, reset]);

  $stale
    .on(staleServe, () => true)
    .on(acceptedDone, () => false)
    .on(cacheHit, () => false)
    .reset(reset);

  $isPlaceholderData
    .on(acceptedDone, () => false)
    .on(cacheHit, () => false)
    .on(staleServe, () => false)
    .reset(reset);

  // Track the *current* run explicitly: a cancel/reset clears it immediately,
  // even if a non-abortable effect's promise is still resolving in the background.
  const $inflight = createStore(false, nm('$inflight'))
    .on(tagged, () => true)
    .on([acceptedDone, finalFail, cacheHit], () => false)
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
  sample({
    clock: acceptedDone,
    fn: ({ params, result }) => ({ params, result: mapData({ result, params }) }),
    target: finishedDone,
  });
  sample({
    clock: cacheHit,
    fn: ({ params, result }) => ({ params, result: mapData({ result, params }) }),
    target: finishedDone,
  });
  sample({
    clock: finalFail,
    fn: ({ params, error }) => ({ params, error: mapError({ error, params }) }),
    target: finishedFail,
  });
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
    $attempts,
    evName,
  });

  const refetch = refresh;

  return {
    start: start as EventCallable<Params>,
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
      refetch: refetch as EventCallable<Params>,
      refresh: refresh as EventCallable<Params>,
      reset,
      cancel,
    }),

    '@@trigger': makeTrigger(finishedDone, evName('asTrigger')),
  };
}
