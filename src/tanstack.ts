/**
 * TanStack Query interop (`effector-refetch/tanstack`).
 *
 * `withTanstackCache` routes a handler through a TanStack `QueryClient`, so its
 * cache, request deduplication, and devtools apply — while the query keeps the
 * full effector-refetch surface ($data/$status, retries, invalidation, …).
 * Useful for incremental migration from TanStack Query and for reusing its
 * devtools during the transition.
 *
 * The client shape is structural (no dependency on `@tanstack/query-core`) and
 * read lazily via `getClient`, so per-fork clients work.
 */

/** Minimal structural shape of a TanStack `QueryClient` — a real one satisfies it. */
export interface TanstackQueryClientLike {
  fetchQuery<Data>(options: {
    queryKey: readonly unknown[];
    queryFn: () => Promise<Data>;
    staleTime?: number;
  }): Promise<Data>;
}

/** An abortable handler, as accepted by `createRequestFx` (ctx is optional for plain effects). */
export type AbortableHandler<Params, Result> = (
  params: Params,
  ctx?: { signal: AbortSignal },
) => Promise<Result>;

export interface WithTanstackCacheOptions<Params> {
  /** TanStack cache key for a run. Default: `['effector-refetch', params]`. */
  queryKey?: (params: Params) => readonly unknown[];
  /** Freshness window (ms) for `fetchQuery` — a fresh entry skips the fetch entirely. */
  staleTime?: number;
}

/**
 * Wrap `handler` so every run goes through `QueryClient.fetchQuery`:
 *
 *   const fetchUserFx = createRequestFx(
 *     withTanstackCache(() => queryClient, fetchUser, { queryKey: (id) => ['user', id] }),
 *   );
 *   const userQuery = createQuery({ effect: fetchUserFx });
 *
 * The run's AbortSignal is forwarded into `handler`, so `cancel` / TAKE_LATEST
 * still abort the underlying request. Note that when TanStack coalesces two
 * concurrent runs into one in-flight fetch, they share one signal — aborting
 * the run that started the fetch aborts it for the coalesced one too.
 */
export function withTanstackCache<Params, Result>(
  getClient: () => TanstackQueryClientLike,
  handler: AbortableHandler<Params, Result>,
  options: WithTanstackCacheOptions<Params> = {},
): AbortableHandler<Params, Result> {
  return (params, ctx) =>
    getClient().fetchQuery<Result>({
      queryKey: options.queryKey ? options.queryKey(params) : ['effector-refetch', params],
      staleTime: options.staleTime,
      queryFn: () => handler(params, ctx),
    });
}
