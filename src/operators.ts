import { is, merge, sample, type Event, type Unit, type Store } from 'effector';
import { inMemoryCache } from './cache';
import { stableStringify } from './utils';
import { isTrigger, type Trigger } from './trigger';
import type { Barrier } from './barrier';
import type { CacheConfig, ConcurrencyStrategy, DelayFn, Query, RetryConfig } from './types';

type AnyQuery = Query<any, any, any, any>;

/**
 * Set the concurrency strategy and/or lane key. Standalone & composable:
 *
 *   concurrency(searchQuery, { strategy: 'TAKE_LATEST' });
 *   concurrency(rowQuery, { strategy: 'TAKE_LATEST', key: ({ rowId }) => String(rowId) });
 *
 * With a `key`, runs whose params map to the same key compete with each other
 * (supersede / TAKE_FIRST drop apply within a lane); different lanes are independent.
 * `$data` stays single per query — lanes partition cancellation, not data.
 *
 * `createQuery({ concurrency })` is sugar over this.
 */
export function concurrency<Q extends AnyQuery>(
  query: Q,
  opts: { strategy?: ConcurrencyStrategy; key?: ((params: any) => string) | null },
): Q {
  if (opts.strategy != null) query.__.setStrategy(opts.strategy);
  if (opts.key !== undefined) query.__.setLaneKey(opts.key);
  return query;
}

/**
 * Add retry behavior. `retry(query, 3)` or `retry(query, { times, delay, filter })`.
 *
 * A `Store<number>` for `times` is accepted but **snapshotted** at setup (reads the
 * store's *default-scope* value via `getState`); it is not reactive and not
 * fork/SSR-correct. For per-scope reactive retry use the inline `createQuery({ retry })`
 * option, which wires the store through the engine's sourced layer at creation.
 */
export function retry<Q extends AnyQuery>(query: Q, opts: number | RetryConfig<any>): Q {
  const cfg = typeof opts === 'number' ? { times: opts } : opts;
  const times = typeof cfg.times === 'number' ? cfg.times : (cfg.times as Store<number>).getState();
  const delay: DelayFn =
    cfg.delay == null ? () => 0 : typeof cfg.delay === 'number' ? () => cfg.delay as number : cfg.delay;
  query.__.setRetry({
    times,
    delay,
    filter: cfg.filter ?? (() => true),
    suppress: cfg.suppressIntermediateErrors ?? true,
  });
  return query;
}

/**
 * Add caching. `cache(query)` (in-memory) or `cache(query, { adapter, staleAfter, key, purge })`.
 *
 * A `Store<number>` for `staleAfter` is accepted but **snapshotted** at setup (reads the
 * store's *default-scope* value via `getState`); it is not reactive and not fork/SSR-correct.
 * For per-scope reactive `staleAfter` use the inline `createQuery({ cache: { staleAfter } })`
 * option, which wires the store through the engine's sourced layer at creation.
 */
export function cache<Q extends AnyQuery>(query: Q, opts: boolean | CacheConfig<any> = true): Q {
  if (opts === false) {
    query.__.setCache(null);
    return query;
  }
  const cfg = opts === true ? {} : opts;
  const staleAfter =
    cfg.staleAfter == null ? Infinity : is.store(cfg.staleAfter) ? cfg.staleAfter.getState() : cfg.staleAfter;
  query.__.setCache({
    adapter: cfg.adapter ?? inMemoryCache(),
    staleAfter,
    key: cfg.key ?? ((p: unknown) => stableStringify(p)),
    swr: cfg.swr ?? false,
    dedupe: cfg.dedupe ?? false,
  });
  if (typeof opts === 'object' && opts.purge && is.unit(opts.purge)) {
    sample({ clock: opts.purge, target: query.__.purgeFx });
  }
  return query;
}

/**
 * Set a per-attempt deadline (ms): the in-flight request is aborted and the run
 * fails (retryable) if it exceeds `ms`. `timeout(query, 5000)`. `0` disables it.
 *
 * `createQuery({ timeout })` is sugar over this. A `Store<number>` is accepted here but
 * **snapshotted** at setup (reads the store's *default-scope* value via `getState`); it is
 * not reactive and not fork/SSR-correct. For per-scope reactive timeout use the inline
 * `createQuery({ timeout })` option, which wires the store through the engine's sourced
 * layer at creation.
 */
export function timeout<Q extends AnyQuery>(query: Q, ms: number | Store<number>): Q {
  query.__.setTimeout(is.store(ms) ? ms.getState() : ms);
  return query;
}

/**
 * Refetch the query (with its last params) whenever a `source` store changes or
 * a `@@trigger` fires — keeps the data fresh relative to external state (filters,
 * locale, viewer, a websocket ping, another query/mutation succeeding, …):
 *
 *   keepFresh(productsQuery, { source: $filters });
 *   keepFresh(productsQuery, { triggers: [createProductMutation, visibilityTrigger] });
 *
 * `triggers` accepts anything implementing the `@@trigger` protocol (our own
 * queries/mutations, farfetched-compatible triggers, withease's web-API triggers)
 * or a plain effector `Event`. Each trigger's `setup` is fired once when wired
 * (it stays active for the app's lifetime — no teardown).
 *
 * No-op until the query has run (`status !== 'initial'`) and while disabled.
 */
export function keepFresh<Q extends AnyQuery>(
  query: Q,
  config: {
    source?: Store<unknown> | ReadonlyArray<Store<unknown>>;
    triggers?: ReadonlyArray<Trigger | Event<unknown>>;
  },
): Q {
  const clocks: Array<Unit<unknown>> = [];

  if (config.source != null) {
    const sources = Array.isArray(config.source) ? config.source : [config.source as Store<unknown>];
    clocks.push(...sources);
  }

  for (const t of config.triggers ?? []) {
    if (isTrigger(t)) {
      const { fired, setup } = t['@@trigger']();
      clocks.push(fired);
      setup(); // activate the trigger (no teardown — wiring is permanent)
    } else {
      clocks.push(t);
    }
  }

  if (clocks.length === 0) return query;
  const clock = clocks.length === 1 ? clocks[0] : merge(clocks);

  type Snapshot = { params: unknown; status: string; enabled: boolean };
  sample({
    clock,
    source: { params: query.$params, status: query.$status, enabled: query.$enabled },
    filter: ({ status, enabled, params }: Snapshot) => status !== 'initial' && enabled && params != null,
    fn: ({ params }: Snapshot) => params,
    target: query.refetch,
  });
  return query;
}

/**
 * Gate a query/mutation on a barrier after it's been created — runs wait while
 * the barrier is locked (e.g. a 401 → token-refresh flow). The same effect as
 * the `barrier` config option, but composable onto an existing unit. Pass `null`
 * to detach.
 *
 *   const auth = createBarrier({ perform: refreshTokenFx });
 *   applyBarrier(userQuery, auth);
 */
export function applyBarrier<Q extends AnyQuery>(query: Q, barrier: Barrier | null): Q {
  query.__.setBarrier(barrier);
  return query;
}
