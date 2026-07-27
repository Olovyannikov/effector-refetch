import { computed, onMounted, type Ref } from 'vue';
import { useUnit } from 'effector-vue/composition';
import type { Query, QueryStatus, UseQueryOptions } from './types';

export type { UseQueryOptions };

export interface UseQueryVueResult<Params, Mapped, Error, Data = Mapped | null> {
  data: Ref<Data>;
  error: Ref<Error | null>;
  status: Ref<QueryStatus>;
  pending: Ref<boolean>;
  /** A run is in flight and there's no real data yet — show a skeleton. */
  isInitialLoading: Ref<boolean>;
  /** A run is in flight over existing data (refetch / polling) — show data + a spinner. */
  isRefetching: Ref<boolean>;
  stale: Ref<boolean>;
  enabled: Ref<boolean>;
  params: Ref<Params | null>;
  isInitial: Ref<boolean>;
  isPending: Ref<boolean>;
  isDone: Ref<boolean>;
  isFail: Ref<boolean>;
  start: (params: Params) => void;
  refetch: (params: Params) => void;
  refresh: (params: Params) => void;
  reset: () => void;
  cancel: () => void;
}

/**
 * Vue binding for a Query. Wraps effector-vue's `useUnit` (scope-aware via the
 * EffectorScope plugin) and adds derived status flags. Does not auto-start.
 */
export function useQuery<Params, Result, Error, Mapped, Data>(
  query: Query<Params, Result, Error, Mapped, Data>,
  options?: UseQueryOptions,
): UseQueryVueResult<Params, Mapped, Error, Data> {
  const u = useUnit(query) as unknown as {
    data: Ref<Data>;
    error: Ref<Error | null>;
    status: Ref<QueryStatus>;
    pending: Ref<boolean>;
    isInitialLoading: Ref<boolean>;
    isRefetching: Ref<boolean>;
    stale: Ref<boolean>;
    enabled: Ref<boolean>;
    params: Ref<Params | null>;
    start: (params: Params) => void;
    refetch: (params: Params) => void;
    refresh: (params: Params) => void;
    reset: () => void;
    cancel: () => void;
  };

  // refetch-stale-on-mount (with the last params), opt-in
  onMounted(() => {
    const mode = options?.refetchOnMount;
    if (!mode || u.status.value === 'initial' || !u.enabled.value || u.params.value == null) return;
    if (mode === 'always' || u.stale.value) u.refetch(u.params.value as Params);
  });

  return {
    data: u.data,
    error: u.error,
    status: u.status,
    pending: u.pending,
    isInitialLoading: u.isInitialLoading,
    isRefetching: u.isRefetching,
    stale: u.stale,
    enabled: u.enabled,
    params: u.params,
    isInitial: computed(() => u.status.value === 'initial'),
    isPending: computed(() => u.status.value === 'pending'),
    isDone: computed(() => u.status.value === 'done'),
    isFail: computed(() => u.status.value === 'fail'),
    start: u.start,
    refetch: u.refetch,
    refresh: u.refresh,
    reset: u.reset,
    cancel: u.cancel,
  };
}
