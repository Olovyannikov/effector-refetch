# Interop: TanStack Query & Apollo

Wrap an external client as a query's **fetch stage** — the query keeps the full
effector-refetch surface (`$data`/`$status`, retries, invalidation, bindings),
while the external ecosystem's cache does what it's good at. The main use case
is **incremental migration**: move a screen to effector-refetch without giving
up the TanStack/Apollo cache (and devtools) the rest of the app still uses.

Both adapters are dependency-free: the client is typed **structurally** (a real
`QueryClient` / `ApolloClient` satisfies the shape, nothing is imported from
those packages) and read **lazily** via `getClient()`, so per-fork clients work.

## TanStack Query — `effector-refetch/tanstack`

`withTanstackCache(getClient, handler, options?)` routes every run of `handler`
through `QueryClient.fetchQuery` — TanStack's cache, dedupe, and devtools apply:

```ts
import { createQuery, createRequestFx } from 'effector-refetch';
import { withTanstackCache } from 'effector-refetch/tanstack';

const fetchUserFx = createRequestFx(
  withTanstackCache(
    () => queryClient, // lazy: can come from per-request/per-fork wiring
    (id: number, { signal }) => fetch(`/api/users/${id}`, { signal }).then((r) => r.json()),
    { queryKey: (id) => ['user', id], staleTime: 60_000 },
  ),
);

const userQuery = createQuery({ effect: fetchUserFx });
```

- `queryKey` defaults to `['effector-refetch', params]`.
- A fresh TanStack entry (within `staleTime`) skips the fetch entirely.
- The run's `AbortSignal` is forwarded into your handler, so `cancel` /
  `TAKE_LATEST` still abort the wire request. Caveat: when TanStack coalesces
  two concurrent runs into one in-flight fetch, they share one signal.
- Don't combine with effector-refetch's own `cache` on the same query — pick
  one cache owner, or they'll disagree about freshness.

## Apollo — `effector-refetch/apollo`

`apolloHandler(getClient, options)` builds a handler backed by `client.query`,
so Apollo's normalized cache and link chain apply:

```ts
import { createQuery, createRequestFx } from 'effector-refetch';
import { apolloHandler } from 'effector-refetch/apollo';
import { USER_QUERY } from './queries';

const fetchUserFx = createRequestFx(
  apolloHandler<number, { user: User }>(() => apolloClient, {
    document: USER_QUERY, // or (params) => document
    variables: (id) => ({ id }),
    fetchPolicy: 'cache-first',
  }),
);

const userQuery = createQuery({
  effect: fetchUserFx,
  mapData: ({ result }) => result.user,
});
```

- The run's `AbortSignal` travels through Apollo's HTTP link
  (`context.fetchOptions.signal`).
- `document` accepts a static `gql` document or a per-params function.

## When NOT to use these

If you're not migrating from (or coexisting with) TanStack/Apollo, you don't
need the adapters — effector-refetch's own [`cache`](/api/operators#cache)
(SWR, dedupe, scope-isolated `$queryCache`) covers caching natively, and
GraphQL is [just a `POST` in an effect](/api/http).
