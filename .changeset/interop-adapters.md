---
'effector-refetch': minor
---

Interop adapters for incremental migration: `effector-refetch/tanstack` and
`effector-refetch/apollo`.

- `withTanstackCache(getClient, handler, { queryKey, staleTime })` routes a
  handler through a TanStack `QueryClient.fetchQuery`, so its cache, dedupe and
  devtools apply while the query keeps the effector-refetch surface.
- `apolloHandler(getClient, { document, variables, fetchPolicy })` builds a
  handler backed by `client.query`, gaining Apollo's normalized cache; the
  run's AbortSignal travels through `context.fetchOptions.signal`.

Both are dependency-free (structural client types), read the client lazily for
per-fork wiring, and compose with `createRequestFx` so cancellation reaches the
wire.
