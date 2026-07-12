import { useUnit } from 'effector-solid';
import { onMount, type Accessor } from 'solid-js';
import type { Query, QueryStatus, UseQueryOptions } from './types';

export type { UseQueryOptions };

export interface UseQuerySolidResult<Params, Mapped, Error> {
  data: Accessor<Mapped | null>;
  error: Accessor<Error | null>;
  status: Accessor<QueryStatus>;
  pending: Accessor<boolean>;
  /** A run is in flight and there's no real data yet — show a skeleton. */
  isInitialLoading: Accessor<boolean>;
  /** A run is in flight over existing data (refetch / polling) — show data + a spinner. */
  isRefetching: Accessor<boolean>;
  stale: Accessor<boolean>;
  enabled: Accessor<boolean>;
  params: Accessor<Params | null>;
  /** Derived convenience flags. */
  isInitial: Accessor<boolean>;
  isPending: Accessor<boolean>;
  isDone: Accessor<boolean>;
  isFail: Accessor<boolean>;
  // bound triggers (scope-aware via effector-solid's <Provider>)
  start: (params: Params) => void;
  refresh: (params: Params) => void;
  refetch: (params: Params) => void;
  reset: () => void;
  cancel: () => void;
}

/**
 * Solid binding for a Query. Reads its stores as reactive accessors and binds
 * its triggers to the current effector scope (effector-solid `<Provider>`) via
 * `useUnit`. Mirrors the React/Vue bindings — values are Solid accessors
 * (call them), like Vue's refs.
 *
 * It does NOT start the query — call `start`/`refresh` yourself, keeping the
 * query explicit and SSR-friendly.
 */
export function useQuery<Params, Result, Error, Mapped>(
  query: Query<Params, Result, Error, Mapped>,
  options?: UseQueryOptions,
): UseQuerySolidResult<Params, Mapped, Error> {
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

  // refetch-stale-on-mount (with the last params), opt-in
  onMount(() => {
    const mode = options?.refetchOnMount;
    if (!mode || state.status() === 'initial' || !state.enabled() || state.params() == null) return;
    if (mode === 'always' || state.stale()) triggers.refetch(state.params() as Params);
  });

  return {
    data: state.data,
    error: state.error,
    status: state.status,
    pending: state.pending,
    isInitialLoading: state.isInitialLoading,
    isRefetching: state.isRefetching,
    stale: state.stale,
    enabled: state.enabled,
    params: state.params,
    // plain accessors (not memos): they read the reactive `status` accessor on
    // every call, so they stay correct in a tracked component scope.
    isInitial: () => state.status() === 'initial',
    isPending: () => state.status() === 'pending',
    isDone: () => state.status() === 'done',
    isFail: () => state.status() === 'fail',
    start: triggers.start,
    refresh: triggers.refresh,
    refetch: triggers.refetch,
    reset: triggers.reset,
    cancel: triggers.cancel,
  };
}
