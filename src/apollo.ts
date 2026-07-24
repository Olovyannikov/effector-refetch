/**
 * Apollo Client interop (`effector-refetch/apollo`).
 *
 * `apolloHandler` builds a handler backed by `client.query`, so Apollo's
 * normalized cache and links apply — while the query keeps the full
 * effector-refetch surface. Useful for incremental migration off Apollo (or
 * for living with both during a transition).
 *
 * The client shape is structural (no dependency on `@apollo/client`) and read
 * lazily via `getClient`, so per-fork clients work.
 */

/** Minimal structural shape of an Apollo client — a real `ApolloClient` satisfies it. */
export interface ApolloClientLike {
  query<Data>(options: {
    query: unknown;
    variables?: Record<string, unknown>;
    fetchPolicy?: string;
    context?: Record<string, unknown>;
  }): Promise<{ data: Data }>;
}

export interface ApolloHandlerOptions<Params> {
  /** A GraphQL document (from `gql`), or a function producing one per params. */
  document: unknown | ((params: Params) => unknown);
  /** Map public params to GraphQL variables. */
  variables?: (params: Params) => Record<string, unknown>;
  fetchPolicy?: string;
}

/**
 * Build a handler that runs a GraphQL document through Apollo:
 *
 *   const fetchUserFx = createRequestFx(
 *     apolloHandler(() => apolloClient, {
 *       document: USER_QUERY,
 *       variables: (id: number) => ({ id }),
 *     }),
 *   );
 *   const userQuery = createQuery({ effect: fetchUserFx });
 *
 * The run's AbortSignal is forwarded through Apollo's HTTP link
 * (`context.fetchOptions.signal`), so `cancel` / TAKE_LATEST abort the request.
 */
export function apolloHandler<Params, Data>(
  getClient: () => ApolloClientLike,
  options: ApolloHandlerOptions<Params>,
): (params: Params, ctx?: { signal: AbortSignal }) => Promise<Data> {
  return async (params, ctx) => {
    const document =
      typeof options.document === 'function'
        ? (options.document as (params: Params) => unknown)(params)
        : options.document;
    const { data } = await getClient().query<Data>({
      query: document,
      variables: options.variables?.(params),
      fetchPolicy: options.fetchPolicy,
      context: { fetchOptions: { signal: ctx?.signal } },
    });
    return data;
  };
}
