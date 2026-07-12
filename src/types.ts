import type { Effect, Event, EventCallable, Store } from 'effector';
import type { Contract } from './validation';
import type { Barrier } from './barrier';

export type QueryStatus = 'initial' | 'pending' | 'done' | 'fail';

export type ConcurrencyStrategy = 'TAKE_LATEST' | 'TAKE_FIRST' | 'TAKE_EVERY';

/**
 * An abort-aware effect produced by `createRequestFx` / `createJsonRequestFx`. It is a
 * regular `Effect<Params, Result>` — the per-run AbortSignal reaches the handler through
 * a synchronous side channel, not through the params — so it can be called directly and
 * composed with a plain `attach` without losing real cancellation.
 */
export type AbortableEffect<Params, Result, Fail = unknown> = Effect<Params, Result, Fail> & {
  readonly __abortable: true;
};

/** Either a plain effect or an abort-aware one. */
export type QueryEffect<Params, Result, Fail> =
  | Effect<Params, Result, Fail>
  | AbortableEffect<Params, Result, Fail>;

/** A `Store` or an object of stores injected into `mapParams` at call time (like `attach`'s `source`). */
export type QuerySource = Store<unknown> | Record<string, Store<unknown>>;

/** The value `mapParams` receives for a given {@link QuerySource} shape. */
export type QuerySourceValue<S> =
  S extends Store<infer V>
    ? V
    : S extends Record<string, Store<unknown>>
      ? { [K in keyof S]: S[K] extends Store<infer V> ? V : never }
      : undefined;

/** Function computing the pause (ms) before retry attempt N (1-based). */
export type DelayFn = (attempt: number) => number;

export interface RetryConfig<Error = unknown> {
  /** Max retries after the first failure. */
  times: number | Store<number>;
  /** Pause before a retry, ms. A number, f(attempt), or linearDelay/exponentialDelay. */
  delay?: number | DelayFn;
  /** Whether to retry this particular failure. Default: always. */
  filter?: (ctx: { error: Error; attempt: number }) => boolean;
  /** Hide intermediate failures from $error/$status until the final one. Default: true. */
  suppressIntermediateErrors?: boolean;
}

export interface CacheEntry {
  value: unknown;
  storedAt: number;
}

export interface CacheAdapter {
  get(key: string): Promise<CacheEntry | null> | CacheEntry | null;
  set(key: string, value: unknown, storedAt: number): void | Promise<void>;
  remove(key: string): void | Promise<void>;
  purge(): void | Promise<void>;
  /**
   * Optional: list every stored entry for {@link dehydrate}. Adapters that can't
   * enumerate (e.g. `voidCache`) omit it; web-storage adapters persist themselves
   * so they don't need it.
   */
  dump?(): Array<CacheEntry & { key: string }>;
}

export interface CacheConfig<Params = unknown> {
  /** Storage implementation. Default: inMemoryCache(). */
  adapter?: CacheAdapter;
  /** ms after which a cached entry is considered stale. Default: Infinity (never). Inline accepts a reactive `Store<number>`. */
  staleAfter?: number | Store<number>;
  /** Cache key from params. Default: stable JSON of params. */
  key?: (params: Params) => string;
  /** Event that clears the whole cache when fired. */
  purge?: Event<unknown>;
  /** Stale-while-revalidate: serve a stale entry immediately, then refetch in the background. */
  swr?: boolean;
  /** Coalesce identical in-flight requests (by key) into one effect run. */
  dedupe?: boolean;
}

export interface CreateQueryConfig<Params, Result, Error, Mapped = Result> {
  /** Primary input: a real effector Effect (plain or abort-aware). */
  effect: QueryEffect<Params, Result, Error>;
  /** Initial $data value before the first success. */
  initialData?: Mapped;
  /** Placeholder shown while there's no real data (value or `(prev) => …`); flagged via `$isPlaceholderData`. */
  placeholderData?: Mapped | ((previousData: Mapped | null) => Mapped | null);
  /** Gate: while false, start/refresh are skipped. */
  enabled?: Store<boolean>;
  /** Map a successful result before writing it to $data. */
  mapData?: (ctx: { result: Result; params: Params }) => Mapped;
  /** Normalize an error before writing it to $error. */
  mapError?: (ctx: { error: Error; params: Params }) => Error;
  /** Validate the response against a schema; failure -> ValidationError. */
  contract?: Contract<Result>;
  /** Custom validation: return true/void = ok, false or string[] = invalid. */
  validate?: (ctx: { result: Result; params: Params }) => boolean | string[] | void;

  retry?: number | RetryConfig<Error>;
  cache?: boolean | CacheConfig<Params>;
  /** Inline accepts a reactive `Store<ConcurrencyStrategy>`. */
  concurrency?: ConcurrencyStrategy | Store<ConcurrencyStrategy>;
  /** Poll: refetch every N ms after each settle, while enabled and started. `Store<number>` is reactive. 0 = off. */
  refetchInterval?: number | Store<number>;
  /** Per-attempt deadline in ms: abort the in-flight request and fail (retryable) if it exceeds it. `Store<number>` is reactive. 0 = off. */
  timeout?: number | Store<number>;
  /** Preserve referential identity of unchanged parts of the result (fewer re-renders). */
  structuralSharing?: boolean;
  /** Gate execution on a barrier — the effect waits while the barrier is locked (e.g. token refresh). */
  barrier?: Barrier;

  /**
   * Invalidation tags: `invalidateTag('todos')` purges this query's cache namespace
   * and refetches it with its last params (if it has run). See {@link invalidateTag}.
   */
  tags?: string[];

  /** Prefix for unit names (devtools). */
  name?: string;
  /** Label units for the effector inspector even without a `name` (uses `query`). */
  debug?: boolean;
}

/** Reactive (sourced) config stores read fork-correctly by the engine. */
export interface SourcedConfig {
  strategy?: Store<ConcurrencyStrategy>;
  retryTimes?: Store<number>;
  staleAfter?: Store<number>;
  timeout?: Store<number>;
}

/** Same as CreateQueryConfig but with a plain async handler instead of an Effect. */
export interface CreateQueryHandlerConfig<Params, Result, Error, Mapped = Result> extends Omit<
  CreateQueryConfig<Params, Result, Error, Mapped>,
  'effect'
> {
  handler: (params: Params) => Promise<Result> | Result;
}

/**
 * `createQuery` with params mapping: `start(params)` (+ optional `source` store
 * values, read fork-correctly per scope) is mapped into the effect's params
 * before every run — the `attach({ source, mapParams })` idiom as an inline
 * option, working for abortable (`createRequestFx`) effects too.
 *
 * The query's public params (`start` / `$params` / `finished.*` / `mapData` ctx)
 * stay as given; the effect — and the **cache key** — see the mapped params.
 * `mapParams` must be pure (it runs inside a sample `fn`).
 */
export interface CreateQueryMappedConfig<
  Params,
  EffectParams,
  Src extends QuerySource | undefined,
  Result,
  Error,
  Mapped = Result,
> extends Omit<CreateQueryConfig<Params, Result, Error, Mapped>, 'effect' | 'cache'> {
  effect: QueryEffect<EffectParams, Result, Error>;
  /** Cache key is computed from the *mapped* (effect-level) params. */
  cache?: boolean | CacheConfig<EffectParams>;
  /** Stores injected into `mapParams` at call time — read fork-correctly per scope. */
  source?: Src;
  /** Pure mapping of public params (+ `source` values) into the effect's params. */
  mapParams: (params: Params, source: QuerySourceValue<Src>) => EffectParams;
}

/** Resolved retry config the engine reads at runtime (operators produce it). */
export interface ResolvedRetry<Error = unknown> {
  times: number;
  delay: DelayFn;
  filter: (ctx: { error: Error; attempt: number }) => boolean;
  suppress: boolean;
}

/** Resolved cache config the engine reads at runtime (operators produce it). */
export interface ResolvedCache<Params = unknown> {
  adapter: CacheAdapter;
  staleAfter: number;
  key: (params: Params) => string;
  swr: boolean;
  dedupe: boolean;
}

/** Lifecycle event stream for devtools / logging. */
export interface QueryInspect<Params, Mapped, Error> {
  start: Event<{ params: Params }>;
  run: Event<{ params: Params; attempt: number }>;
  done: Event<{ params: Params; result: Mapped }>;
  fail: Event<{ params: Params; error: Error }>;
  aborted: Event<{ params: Params }>;
  cacheHit: Event<{ params: Params }>;
  cacheMiss: Event<{ params: Params }>;
  retry: Event<{ params: Params; attempt: number; error: Error }>;
}

/** Internal engine seams that standalone operators (retry/cache/concurrency) configure. */
export interface QueryEngine<Params, Error> {
  setStrategy: (strategy: ConcurrencyStrategy) => void;
  setRetry: (cfg: ResolvedRetry<Error> | null) => void;
  setCache: (cfg: ResolvedCache<Params> | null) => void;
  /** Validation check: return error messages (invalid) or null (ok). */
  setValidate: (fn: ((result: unknown, params: Params) => string[] | null) | null) => void;
  setTimeout: (ms: number) => void;
  setBarrier: (barrier: Barrier | null) => void;
  /** Purge this query's cache entries (scope-aware: honors `$queryCache` and its namespacing). */
  purgeFx: EventCallable<void>;
}

export interface QueryFinished<Params, Result, Error> {
  done: Event<{ params: Params; result: Result }>;
  fail: Event<{ params: Params; error: Error }>;
  finally: Event<{ params: Params; status: 'done' | 'fail' }>;
  /** farfetched-compatible alias of `done` (same event, fires on success). */
  success: Event<{ params: Params; result: Result }>;
  /** farfetched-compatible alias of `fail` (same event, fires on failure). */
  failure: Event<{ params: Params; error: Error }>;
  /**
   * Fired when a run is skipped by the `enabled` gate (the query didn't execute) —
   * the farfetched `finished.skip`. Cancel/reset/TAKE_LATEST supersede surface via
   * the broader `aborted` event, not here.
   */
  skip: Event<{ params: Params }>;
}

/**
 * What `useUnit(query)` resolves to: store values + scope-bound triggers.
 * Declared as a type alias (not an interface) so it stays assignable to the
 * `Record<string, Unit>` shape that effector's `useUnit` overloads expect.
 */
export type QueryUnitShape<Params, Mapped, Error> = {
  data: Store<Mapped | null>;
  error: Store<Error | null>;
  status: Store<QueryStatus>;
  pending: Store<boolean>;
  isInitialLoading: Store<boolean>;
  isRefetching: Store<boolean>;
  stale: Store<boolean>;
  enabled: Store<boolean>;
  params: Store<Params | null>;
  isPlaceholderData: Store<boolean>;
  start: EventCallable<Params>;
  refetch: EventCallable<Params>;
  refresh: EventCallable<Params>;
  reset: EventCallable<void>;
  cancel: EventCallable<void>;
};

export interface Query<Params, Result, Error, Mapped = Result> {
  // triggers
  start: EventCallable<Params>;
  /** Re-run, bypassing cache freshness. */
  refresh: EventCallable<Params>;
  /** Alias of `refresh`, for the familiar `refetch` name. */
  refetch: EventCallable<Params>;
  /** Warm the cache for `params` without touching `$data`/`$status` (no-op without cache). */
  prefetch: EventCallable<Params>;
  reset: EventCallable<void>;
  cancel: EventCallable<void>;

  // state
  $data: Store<Mapped | null>;
  $error: Store<Error | null>;
  $status: Store<QueryStatus>;
  $pending: Store<boolean>;
  /** A run is in flight and there's no real data yet (placeholder doesn't count) — show a skeleton. */
  $isInitialLoading: Store<boolean>;
  /** A run is in flight over existing real data (refetch / polling / SWR) — show data + a corner spinner. */
  $isRefetching: Store<boolean>;
  $stale: Store<boolean>;
  /** True while `$data` is the configured placeholder (no real result yet). */
  $isPlaceholderData: Store<boolean>;
  $enabled: Store<boolean>;
  /** Last params the query ran with (null before first run). */
  $params: Store<Params | null>;

  // lifecycle
  finished: QueryFinished<Params, Mapped, Error>;
  aborted: Event<{ params: Params }>;

  /** Escape hatch — "based on real effects" — plus engine seams used by operators. */
  __: {
    effect: QueryEffect<Params, Result, Error>;
    runFx: Effect<{ runId: number; params: Params; mapped: unknown; timeoutMs: number }, any, Error>;
    inspect: QueryInspect<Params, Mapped, Error>;
    /** Imperative write to `$data` (see `setQueryData`). */
    setData: EventCallable<Mapped | null>;
    /** Imperative `prev -> next` update of `$data` — applied in the reducer (scope-correct, no getState). */
    updateData: EventCallable<(prev: Mapped | null) => Mapped | null>;
  } & QueryEngine<Params, Error>;

  /**
   * effector `useUnit` protocol: `useUnit(query)` returns
   * `{ data, error, status, pending, stale, enabled, params, start, refetch, refresh, reset, cancel }`.
   * Works with both effector-react and effector-vue.
   */
  '@@unitShape': () => QueryUnitShape<Params, Mapped, Error>;

  /**
   * `@@trigger` protocol — the query as a reactive trigger (`fired` = `finished.done`),
   * usable in farfetched's `keepFresh({ triggers })` and our own {@link keepFresh}.
   */
  '@@trigger': () => {
    fired: Event<{ params: Params; result: Mapped }>;
    setup: EventCallable<void>;
    teardown: EventCallable<void>;
  };
}

// ---- mutations ----

export interface CreateMutationConfig<Params, Result, Error, Mapped = Result> {
  /** Primary input: a real effector Effect (plain or abort-aware). */
  effect: QueryEffect<Params, Result, Error>;
  enabled?: Store<boolean>;
  mapData?: (ctx: { result: Result; params: Params }) => Mapped;
  mapError?: (ctx: { error: Error; params: Params }) => Error;
  /** Validate the response against a schema; failure -> ValidationError. */
  contract?: Contract<Result>;
  /** Custom validation: return true/void = ok, false or string[] = invalid. */
  validate?: (ctx: { result: Result; params: Params }) => boolean | string[] | void;
  retry?: number | RetryConfig<Error>;
  /** Default: 'TAKE_EVERY' — independent mutations should not cancel each other. Inline accepts a reactive `Store<ConcurrencyStrategy>`. */
  concurrency?: ConcurrencyStrategy | Store<ConcurrencyStrategy>;
  /** Gate execution on a barrier (e.g. token refresh). */
  barrier?: Barrier;
  name?: string;
  debug?: boolean;
}

export interface CreateMutationHandlerConfig<Params, Result, Error, Mapped = Result> extends Omit<
  CreateMutationConfig<Params, Result, Error, Mapped>,
  'effect'
> {
  handler: (params: Params) => Promise<Result> | Result;
}

export type MutationUnitShape<Params, Mapped, Error> = {
  data: Store<Mapped | null>;
  error: Store<Error | null>;
  status: Store<QueryStatus>;
  pending: Store<boolean>;
  params: Store<Params | null>;
  start: EventCallable<Params>;
  mutate: EventCallable<Params>;
  reset: EventCallable<void>;
  cancel: EventCallable<void>;
};

export interface Mutation<Params, Result, Error, Mapped = Result> {
  start: EventCallable<Params>;
  /** Alias of `start`, reads better for writes: `userMutation.mutate(payload)`. */
  mutate: EventCallable<Params>;
  reset: EventCallable<void>;
  cancel: EventCallable<void>;

  $data: Store<Mapped | null>;
  $error: Store<Error | null>;
  $status: Store<QueryStatus>;
  $pending: Store<boolean>;
  $params: Store<Params | null>;

  finished: QueryFinished<Params, Mapped, Error>;
  aborted: Event<{ params: Params }>;

  __: {
    effect: QueryEffect<Params, Result, Error>;
    runFx: Effect<{ runId: number; params: Params; mapped: unknown; timeoutMs: number }, any, Error>;
  };

  '@@unitShape': () => MutationUnitShape<Params, Mapped, Error>;

  /**
   * `@@trigger` protocol — the mutation as a reactive trigger (`fired` = `finished.done`),
   * e.g. to refresh a query whenever a write succeeds.
   */
  '@@trigger': () => {
    fired: Event<{ params: Params; result: Mapped }>;
    setup: EventCallable<void>;
    teardown: EventCallable<void>;
  };
}

// ---- type-level helpers ----

export type ParamsOf<Q> =
  Q extends Query<infer P, any, any, any> ? P : Q extends Mutation<infer P, any, any, any> ? P : never;
export type ResultOf<Q> =
  Q extends Query<any, any, any, infer M> ? M : Q extends Mutation<any, any, any, infer M> ? M : never;
export type ErrorOf<Q> =
  Q extends Query<any, any, infer E, any> ? E : Q extends Mutation<any, any, infer E, any> ? E : never;

/** Options for the `useQuery` binding helpers (React / Vue / Solid). */
export interface UseQueryOptions {
  /**
   * Refetch on subscribe/mount with the query's last params:
   *  - `true` — only if the data is stale (`$stale`);
   *  - `'always'` — every mount.
   * No-op until the query has run at least once (`status !== 'initial'`) and is enabled.
   */
  refetchOnMount?: boolean | 'always';
}
