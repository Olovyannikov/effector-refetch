import {
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
import { RequestError } from './request';
import { replaceEqualDeep } from './utils';
import { makeTrigger } from './trigger';
import { setupPolling } from './engine/polling';
import { setupIntrospection } from './engine/introspection';

/** A never-aborted signal for non-abortable effects (avoids allocating a throwaway AbortController per run). */
const NEVER_ABORTED = new AbortController().signal;

interface Run<P> {
  runId: number;
  params: P;
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

  const isAbortable = (effectFx as { __abortable?: boolean }).__abortable === true;
  const callEffect = (params: Params, signal: AbortSignal): Promise<Result> =>
    isAbortable
      ? (effectFx as (a: { params: Params; signal: AbortSignal }) => Promise<Result>)({ params, signal })
      : (effectFx as (p: Params) => Promise<Result>)(params);

  const mapData = config.mapData ?? (({ result }) => result as unknown as Mapped);
  const mapError = config.mapError ?? (({ error }) => error);

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

  let strategyConst: ConcurrencyStrategy = 'TAKE_LATEST';
  let retryTimesConst = 0;
  let staleAfterConst = Infinity;
  let timeoutConst = 0;
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
  // keys with a request currently in flight (for dedupe coalescing)
  const inflightKeys = new Set<string>();
  const dedupeKey = (params: Params): string | null =>
    cacheRef && cacheRef.dedupe ? cacheRef.key(params) : null;
  let validateRef: ((result: unknown, params: Params) => string[] | null) | null = null;
  let barrierRef = config.barrier ?? null;

  const swrOf = () => !!cacheRef && cacheRef.swr;
  const stratOf = (v: ConcurrencyStrategy | null): ConcurrencyStrategy => v ?? strategyConst;
  const timesOf = (v: number | null): number => v ?? retryTimesConst;
  const staleOf = (v: number | null): number => v ?? staleAfterConst;
  const timeoutOf = (v: number | null): number => v ?? timeoutConst;
  const isCurrent = (strategy: ConcurrencyStrategy, lastId: number, runId: number) =>
    strategy === 'TAKE_EVERY' ? true : runId === lastId;

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

  const aborted = createEvent<{ params: Params }>(evName('aborted'));
  // farfetched-compatible `finished.skip`: the `enabled` gate prevented execution.
  const skipped = createEvent<{ params: Params }>(evName('finished.skip'));
  const finishedDone = createEvent<{ params: Params; result: Mapped }>(evName('finished.done'));
  const finishedFail = createEvent<{ params: Params; error: Error }>(evName('finished.fail'));
  const finishedFinally = createEvent<{ params: Params; status: 'done' | 'fail' }>(
    evName('finished.finally'),
  );

  // ---- internal units ----
  const $runId = createStore(0, nm('$runId'));
  const $attempts = createStore(0, nm('$attempts'));
  const $retrying = createStore(false, nm('$retrying'));

  const sleepFx = createEffect<{ ms: number; payload: unknown }, unknown>({
    name: evName('sleepFx'),
    handler: ({ ms, payload }) => new Promise((res) => setTimeout(() => res(payload), ms)),
  });

  const controllers = new Set<AbortController>();
  const abortInFlightFx = createEffect({
    name: evName('abortInFlightFx'),
    handler: () => {
      controllers.forEach((c) => c.abort());
      controllers.clear();
    },
  });

  const runFx = createEffect<Run<Params>, ExecDone<Params, Result>, Error>({
    name: ns ? `${ns}.runFx` : undefined,
    handler: async ({ runId, params, timeoutMs }) => {
      const key = dedupeKey(params);
      if (key) inflightKeys.add(key);
      const controller = isAbortable ? new AbortController() : null;
      if (controller) controllers.add(controller);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const exec = callEffect(params, controller?.signal ?? NEVER_ABORTED);
        if (!timeoutMs || timeoutMs <= 0) {
          return { runId, params, timeoutMs, result: await exec };
        }
        // race the request against a deadline; on timeout, abort it (abortable
        // effects actually stop) and reject — the normal fail/retry path handles it
        const timedOut = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller?.abort();
            reject(new RequestError(`Request timed out after ${timeoutMs}ms`, { reason: 'timeout' }));
          }, timeoutMs);
        });
        const result = (await Promise.race([exec, timedOut])) as Result;
        return { runId, params, timeoutMs, result };
      } finally {
        if (timer) clearTimeout(timer);
        if (key) inflightKeys.delete(key);
        if (controller) controllers.delete(controller);
      }
    },
  });

  // ---- barrier gate ----
  // A run waits on the barrier (e.g. a token refresh) BEFORE hitting the effect. The
  // wait lives in its own effect — not inside runFx — so that when the barrier opens we
  // re-check currency in the graph (fork-correct $runId) and drop a superseded/cancelled
  // run WITHOUT performing its request. Runs with no barrier attached skip this hop.
  const toRunFx = createEvent<Run<Params>>(evName('toRunFx'));
  const barrierWaitFx = createEffect<Run<Params>, Run<Params>>({
    name: evName('barrierWaitFx'),
    handler: async (run) => {
      if (barrierRef) await barrierRef.__.wait();
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
    source: { lastId: $runId, strat: $strategySrc },
    filter: ({ lastId, strat }, run) => isCurrent(stratOf(strat), lastId, run.runId),
    fn: (_s, run) => run,
    target: runFx,
  });
  sample({
    clock: barrierWaitFx.doneData,
    source: { lastId: $runId, strat: $strategySrc },
    filter: ({ lastId, strat }, run) => !isCurrent(stratOf(strat), lastId, run.runId),
    fn: (_s, run) => ({ params: run.params }),
    target: aborted,
  });
  // "in progress" for TAKE_FIRST means waiting on the barrier OR executing the effect
  const $busy = combine(barrierWaitFx.pending, runFx.pending, (w, r) => w || r);

  const requested = createEvent<{ params: Params; fresh: boolean }>(evName('requested'));
  sample({ clock: start, fn: (params) => ({ params, fresh: false }), target: requested });
  sample({ clock: refresh, fn: (params) => ({ params, fresh: true }), target: requested });

  // enabled gate
  const allowed = sample({
    clock: requested,
    source: $enabled,
    filter: (enabled) => enabled,
    fn: (_e, r) => r,
  });
  sample({
    clock: requested,
    source: $enabled,
    filter: (enabled) => !enabled,
    fn: (_e, r) => ({ params: r.params }),
    target: [aborted, skipped],
  });

  // concurrency gate (TAKE_FIRST drops while busy) — strategy sourced
  const proceed = createEvent<{ params: Params; fresh: boolean }>(evName('proceed'));
  sample({
    clock: allowed,
    source: { busy: $busy, strat: $strategySrc },
    filter: ({ busy, strat }) => !(stratOf(strat) === 'TAKE_FIRST' && busy),
    fn: (_s, r) => r,
    target: proceed,
  });
  sample({
    clock: allowed,
    source: { busy: $busy, strat: $strategySrc },
    filter: ({ busy, strat }) => stratOf(strat) === 'TAKE_FIRST' && busy,
    fn: (_s, r) => ({ params: r.params }),
    target: aborted,
  });

  // cache lookup / exec branch — presence via cacheRef, staleAfter sourced
  const toExec = createEvent<{ params: Params }>(evName('toExec'));
  const cacheHit = createEvent<{ params: Params; result: Result }>(evName('cacheHit'));
  // current-run success, before validation (carries runId for the retry path)
  const rawDone = createEvent<{ runId: number; params: Params; result: Result; timeoutMs: number }>(
    evName('rawDone'),
  );
  // validated success — drives $data, cache write, finished.done
  const acceptedDone = createEvent<{ params: Params; result: Result }>(evName('acceptedDone'));
  // SWR: a stale cache entry served immediately while a background refetch runs
  const staleServe = createEvent<{ params: Params; result: Result }>(evName('staleServe'));

  const lookupFx = createEffect({
    name: evName('lookupFx'),
    handler: async ({ params, staleAfter }: { params: Params; staleAfter: number }) => {
      const cfg = cacheRef;
      if (!cfg) return { entry: null, params, fresh: false };
      const entry = await cfg.adapter.get(cfg.key(params));
      const fresh = entry != null && Date.now() - entry.storedAt < staleAfter;
      return { entry, params, fresh };
    },
  });
  sample({
    clock: proceed,
    filter: (r) => !cacheRef || r.fresh,
    fn: (r) => ({ params: r.params }),
    target: toExec,
  });
  sample({
    clock: proceed,
    source: $staleAfterSrc,
    filter: (_s, r) => !!cacheRef && !r.fresh,
    fn: (s, r) => ({ params: r.params, staleAfter: staleOf(s) }),
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
    fn: ({ params }) => ({ params }),
    target: toExec,
  });
  // miss, or stale without SWR -> just execute
  sample({
    clock: lookupFx.doneData,
    filter: ({ fresh, entry }) => !fresh && !(entry != null && swrOf()),
    fn: ({ params }) => ({ params }),
    target: toExec,
  });

  const setFx = createEffect({
    name: evName('setFx'),
    handler: (p: { params: Params; result: Result }) => {
      const cfg = cacheRef;
      if (cfg) cfg.adapter.set(cfg.key(p.params), p.result, Date.now());
    },
  });
  sample({ clock: acceptedDone, filter: () => !!cacheRef, target: setFx });

  // prefetch: warm the cache without touching $data/$status (cache-only; skips if fresh)
  const prefetchLookupFx = createEffect({
    name: evName('prefetchLookupFx'),
    handler: async ({ params, staleAfter }: { params: Params; staleAfter: number }) => {
      const cfg = cacheRef;
      if (!cfg) return { params, fresh: false };
      const entry = await cfg.adapter.get(cfg.key(params));
      return { params, fresh: entry != null && Date.now() - entry.storedAt < staleAfter };
    },
  });
  const prefetchRunFx = createEffect<Params, { params: Params; result: Result }, Error>({
    name: evName('prefetchRunFx'),
    handler: async (params) => ({
      params,
      result: await callEffect(params, NEVER_ABORTED),
    }),
  });
  sample({
    clock: prefetch,
    source: $staleAfterSrc,
    filter: () => !!cacheRef,
    fn: (s, params) => ({ params, staleAfter: staleOf(s) }),
    target: prefetchLookupFx,
  });
  sample({
    clock: prefetchLookupFx.doneData,
    filter: ({ fresh }) => !fresh,
    fn: ({ params }) => params,
    target: prefetchRunFx,
  });
  sample({ clock: prefetchRunFx.doneData, target: setFx });

  const purgeFx = createEffect({
    name: evName('purgeFx'),
    handler: () => {
      cacheRef?.adapter.purge();
    },
  });

  // dedupe gate: drop a run whose key is already in flight (coalesce)
  const toRun = createEvent<{ params: Params }>(evName('toRun'));
  sample({
    clock: toExec,
    filter: (r) => {
      const key = dedupeKey(r.params);
      return !key || !inflightKeys.has(key);
    },
    target: toRun,
  });

  // tag with a fresh runId, reset attempts, then execute the real effect
  const tagged = sample({
    clock: toRun,
    source: { id: $runId, timeout: $timeoutSrc },
    fn: ({ id, timeout }, r): Run<Params> => ({
      runId: id + 1,
      params: r.params,
      timeoutMs: timeoutOf(timeout),
    }),
  });
  $runId.on(tagged, (_id, t) => t.runId);
  $attempts.on(tagged, () => 0);
  // TAKE_LATEST: abort the superseded in-flight request before the new one starts
  sample({
    clock: tagged,
    source: $strategySrc,
    filter: (s) => stratOf(s) === 'TAKE_LATEST',
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
    source: { lastId: $runId, strat: $strategySrc },
    filter: ({ lastId, strat }, { result }) => isCurrent(stratOf(strat), lastId, result.runId),
    fn: (_s, { result }) => ({
      runId: result.runId,
      params: result.params,
      result: result.result,
      timeoutMs: result.timeoutMs,
    }),
    target: rawDone,
  });
  sample({
    clock: runFx.done,
    source: { lastId: $runId, strat: $strategySrc },
    filter: ({ lastId, strat }, { result }) => !isCurrent(stratOf(strat), lastId, result.runId),
    fn: (_s, { result }) => ({ params: result.params }),
    target: aborted,
  });

  // ---- failure / retry ----
  const willRetry = (
    strategy: ConcurrencyStrategy,
    lastId: number,
    attempts: number,
    times: number,
    runId: number,
    error: Error,
  ) =>
    !!retryRef &&
    isCurrent(strategy, lastId, runId) &&
    attempts < times &&
    retryRef.filter({ error, attempt: attempts + 1 });

  const scheduleRetry = createEvent<Run<Params> & { error: Error }>(evName('scheduleRetry'));
  const finalFail = createEvent<{ params: Params; error: Error }>(evName('finalFail'));
  const intermediateFail = createEvent<{ params: Params; error: Error }>(evName('intermediateFail'));
  // unified failure stream: transport failures + validation failures
  const failed = createEvent<{ runId: number; params: Params; error: Error; timeoutMs: number }>(
    evName('failed'),
  );

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
    fn: ({ params, result }) => ({ params, result }),
    target: acceptedDone,
  });
  sample({
    clock: checked,
    filter: ({ errors }) => errors !== null,
    fn: ({ runId, params, result, timeoutMs, errors }) => ({
      runId,
      params,
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
      error,
      timeoutMs: params.timeoutMs,
    }),
    target: failed,
  });

  const failSource = { lastId: $runId, attempts: $attempts, timesSrc: $retryTimesSrc, strat: $strategySrc };
  sample({
    clock: failed,
    source: failSource,
    filter: ({ lastId, attempts, timesSrc, strat }, { runId, error }) =>
      willRetry(stratOf(strat), lastId, attempts, timesOf(timesSrc), runId, error),
    fn: (_s, { runId, params, error, timeoutMs }) => ({ runId, params, error, timeoutMs }),
    target: scheduleRetry,
  });
  sample({
    clock: failed,
    source: failSource,
    filter: ({ lastId, attempts, timesSrc, strat }, { runId, error }) =>
      isCurrent(stratOf(strat), lastId, runId) &&
      !willRetry(stratOf(strat), lastId, attempts, timesOf(timesSrc), runId, error),
    fn: (_s, { params, error }) => ({ params, error }),
    target: finalFail,
  });
  sample({
    clock: failed,
    source: { lastId: $runId, strat: $strategySrc },
    filter: ({ lastId, strat }, { runId }) => !isCurrent(stratOf(strat), lastId, runId),
    fn: (_s, { params }) => ({ params }),
    target: aborted,
  });

  // retry: bump attempts, wait, re-run the same runId (unless superseded meanwhile)
  $attempts.on(scheduleRetry, (n) => n + 1);
  $retrying.on(scheduleRetry, () => true);
  sample({
    clock: scheduleRetry,
    source: $attempts,
    fn: (attempt, s): { ms: number; payload: unknown } => ({
      ms: (retryRef?.delay ?? (() => 0))(attempt),
      payload: { runId: s.runId, params: s.params, timeoutMs: s.timeoutMs } as Run<Params>,
    }),
    target: sleepFx,
  });
  sample({
    clock: sleepFx.doneData,
    source: { lastId: $runId, strat: $strategySrc },
    filter: ({ lastId, strat }, payload) => isCurrent(stratOf(strat), lastId, (payload as Run<Params>).runId),
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
  $retrying.reset(invalidate);
  sample({ clock: invalidate, target: abortInFlightFx });

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
      purgeFx,
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
