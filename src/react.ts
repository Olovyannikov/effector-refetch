import { useEffect, useRef } from 'react';
import { createWatch, type Unit } from 'effector';
import { useUnit, useProvidedScope } from 'effector-react';
import type { Query, QueryStatus, UseQueryOptions } from './types';

export type { UseQueryOptions };

type AnyQuery = Query<any, any, any, any>;

export interface UseQueryResult<Params, Mapped, Error, Data = Mapped | null> {
  data: Data;
  error: Error | null;
  status: QueryStatus;
  pending: boolean;
  /** A run is in flight and there's no real data yet — show a skeleton. */
  isInitialLoading: boolean;
  /** A run is in flight over existing data (refetch / polling) — show data + a spinner. */
  isRefetching: boolean;
  stale: boolean;
  enabled: boolean;
  params: Params | null;
  /** Derived convenience flags. */
  isInitial: boolean;
  isPending: boolean;
  isDone: boolean;
  isFail: boolean;
  // bound triggers (scope-aware via effector-react's Provider)
  start: (params: Params) => void;
  refresh: (params: Params) => void;
  refetch: (params: Params) => void;
  reset: () => void;
  cancel: () => void;
}

/**
 * React binding for a Query. Reads its stores and binds its triggers to the
 * current effector scope (effector-react <Provider>) via `useUnit`.
 *
 * It does NOT start the query — call `start`/`refresh` yourself (e.g. in an
 * effect), keeping the query explicit and SSR-friendly.
 */
export function useQuery<Params, Result, Error, Mapped, Data>(
  query: Query<Params, Result, Error, Mapped, Data>,
  options?: UseQueryOptions,
): UseQueryResult<Params, Mapped, Error, Data> {
  const state = useUnit({
    data: query.$data,
    error: query.$error,
    status: query.$status,
    pending: query.$pending,
    isInitialLoading: query.$isInitialLoading,
    isRefetching: query.$isRefetching,
    stale: query.$stale,
    enabled: query.$enabled,
    params: query.$params,
  });

  const triggers = useUnit({
    start: query.start,
    refresh: query.refresh,
    refetch: query.refetch,
    reset: query.reset,
    cancel: query.cancel,
  });

  // refetch-stale-on-mount (with the last params), opt-in.
  // The ref guard keeps StrictMode's double effect-run from firing 'always' twice.
  const mountRefetched = useRef(false);
  useEffect(() => {
    const mode = options?.refetchOnMount;
    if (mountRefetched.current || !mode || state.status === 'initial' || !state.enabled) return;
    if (state.params == null) return;
    mountRefetched.current = true;
    if (mode === 'always' || state.stale) triggers.refetch(state.params as Params);
    // mount-only: read the values as they are when the component first subscribes
  }, []);

  return {
    ...state,
    isInitial: state.status === 'initial',
    isPending: state.status === 'pending',
    isDone: state.status === 'done',
    isFail: state.status === 'fail',
    ...triggers,
  };
}

// Per-(scope, query) promise cache: while a query is loading we throw a *stable*
// promise (React keys Suspense retries on identity) that resolves on the next settle.
// Keyed by scope so concurrent forks don't share each other's settle signal; the
// inner map is a WeakMap so a query GC's with its scope.
const NO_SCOPE = {};
const suspenseByScope = new WeakMap<object, WeakMap<object, Promise<void>>>();
function suspenseCacheFor(scope: object): WeakMap<object, Promise<void>> {
  let cache = suspenseByScope.get(scope);
  if (!cache) {
    cache = new WeakMap();
    suspenseByScope.set(scope, cache);
  }
  return cache;
}

/**
 * Suspense binding for a Query. Returns the data directly (never null):
 *
 *  - `initial` → auto-starts with the given params, then suspends;
 *  - `pending` → suspends (the nearest `<Suspense>` shows its fallback);
 *  - `fail` → throws the error (caught by the nearest Error Boundary);
 *  - `done` → returns the data.
 *
 * Client-side Suspense (CSR). Scope-aware throughout: reads/triggers via
 * effector-react, the settle signal via a scope-bound `createWatch`. Not meant
 * for concurrent SSR streaming.
 *
 * The suspense promise is cached per (scope, query) and dropped on settle. A query
 * holds a single state, so when several components suspend on the same query the
 * params of the first starter win — pass the same params, or use separate queries.
 */
export function useSuspenseQuery<Params, Result, Error, Mapped>(
  query: Query<Params, Result, Error, Mapped>,
  ...args: [Params] extends [void] ? [] : [Params]
): Mapped {
  const scope = useProvidedScope();
  const cache = suspenseCacheFor(scope ?? NO_SCOPE);
  const { data, status, error } = useUnit({
    data: query.$data,
    status: query.$status,
    error: query.$error,
  });
  const start = useUnit(query.start) as (...a: unknown[]) => void;

  if (status === 'done') {
    cache.delete(query as object);
    return data as Mapped;
  }
  if (status === 'fail') {
    cache.delete(query as object);
    throw error;
  }

  // initial / pending → suspend until the query settles. The settle signal is
  // observed scope-correctly via createWatch (no scope -> default, same as before).
  // Discards count as settles too: `aborted` (a dropped run reporting in), and
  // `cancel`/`reset` themselves — for a NON-abortable effect a cancelled run's promise
  // may never settle, so no `aborted` would ever fire. Without these the promise stays
  // pending forever and the component hangs in the Suspense fallback; resolving lets
  // React retry the render, where an `initial` status auto-restarts the query.
  let promise = cache.get(query as object);
  if (!promise) {
    promise = new Promise<void>((resolve) => {
      const q = query as unknown as AnyQuery;
      const unwatchers: Array<() => void> = [];
      const settle = () => {
        unwatchers.forEach((un) => un());
        // drop the entry HERE, not only on a `done`/`fail` render: if the component
        // unmounted before the settle, a stale RESOLVED promise would otherwise be
        // re-thrown on the next pending cycle — React retries it instantly, in a loop
        cache.delete(query as object);
        resolve();
      };
      for (const unit of [q.finished.finally, q.aborted, q.cancel, q.reset] as Array<Unit<unknown>>) {
        unwatchers.push(createWatch({ unit, scope: scope ?? undefined, fn: settle }));
      }
    });
    cache.set(query as object, promise);
    if (status === 'initial') start(...args);
  }
  throw promise;
}
