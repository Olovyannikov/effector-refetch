---
name: effector-refetch
description: >-
  Use when building data fetching/caching in an effector app with the
  effector-refetch library — createQuery/createMutation, retries, caching,
  concurrency, pagination, connectQuery, React/Vue/Solid bindings, SSR via
  fork/allSettled, auth barrier and offline mode. Covers the effect-first API
  and the fork-correct idioms that are easy to get wrong.
---

# effector-refetch

A small, effect-first query layer for [effector](https://effector.dev). The unit of work is a
real `Effect<Params, Result, Error>`; a query is a thin reactive wrapper around it. Like
farfetched/TanStack Query, but built on real effects with a friendly inline-config API.

Published on npm as **`effector-refetch`**. Docs: https://olovyannikov.github.io/effector-refetch/

## Install

```bash
pnpm add effector-refetch effector
# bindings are optional peers — add only what you use:
pnpm add effector-react react        # effector-refetch/react
pnpm add effector-vue vue            # effector-refetch/vue
pnpm add effector-solid solid-js     # effector-refetch/solid
```

## Mental model (read first)

- **Effect-first.** You bring an `Effect` (often built with `createRequestFx` or `attach`); the
  query wraps it. `query.__.effect` is your original effect. `createRequestFx` effects are
  regular `Effect<Params, Result>` units — callable directly and composable with a plain
  `attach` (the AbortSignal rides a synchronous side channel, so cancellation survives).
- **Queries never auto-start.** Call `query.start(params)` / `refresh` / `refetch` yourself
  (in an effect, a `sample`, or a binding). The exception is `useSuspenseQuery`, which auto-starts.
- **Fork-correct.** Everything is plain effector units — use `fork`/`allSettled` for SSR and tests.
  Read state with `scope.getState($store)`, never module-level `getState` in app logic.
- **Inline option == sugar over a standalone operator.** `createQuery({ retry, cache, concurrency })`
  is the same as applying `retry()`/`cache()`/`concurrency()` operators.

## createQuery

```ts
import { createQuery } from 'effector-refetch';
import { createEffect } from 'effector';

const fetchUserFx = createEffect((id: number) => fetch(`/api/users/${id}`).then((r) => r.json()));

const userQuery = createQuery({
  effect: fetchUserFx, // required: a real Effect (or `handler: (p) => Promise<R>`)
  retry: 3, // number | { times, delay, filter, suppressIntermediateErrors }
  cache: true, // true | { adapter, staleAfter, key, swr (| {silent}), dedupe, fillOnAbort }
  debounce: 300, // wait before running; a newer same-lane run during the wait wins (pre-network)
  fallback: [], // recover a FINAL failure into data (value | ({error, params}) => value); not cached
  concurrency: 'TAKE_LATEST', // 'TAKE_LATEST' (default) | 'TAKE_FIRST' | 'TAKE_EVERY' | 'QUEUE' (serialized)
  // or lanes: { strategy, key: (params) => string } — same-key runs compete, others independent
  // mapData, mapError, enabled (Store<boolean>), initialData, placeholderData,
  // refetchInterval (number | Store<number>), structuralSharing, name (devtools), barrier
});

userQuery.start(1);
```

**Triggers**: `start`, `startAsync` (a real Effect — `await q.startAsync(p)` resolves with data,
rejects on failure/discard; `mutateAsync` on mutations), `refresh` (force, ignore cache freshness), `refetch`
(alias of refresh), `reset` (→ initial + cancel), `cancel` (abort in-flight, keep data),
`prefetch` (warm cache only).

**State** (Store): `$data`, `$error`, `$status` (`'initial'|'pending'|'done'|'fail'`),
`$pending`, `$stale`, `$enabled`, `$params`, `$isPlaceholderData`; `$state` — everything as ONE
discriminated union (`status === 'done'` narrows `data` non-null, `'fail'` narrows `error`).

**Lifecycle** (Event): `finished.done {params,result}`, `finished.fail {params,error}`,
`finished.finally`, `aborted {params, reason}` (`reason`: `'cancelled' | 'superseded' | 'take-first-busy' | 'disabled'`).
The reason also rides on the run's AbortSignal: `signal.reason` is an AbortError whose
message is the reason ('timeout' for the deadline race).

**Escape hatch:** `query.__` exposes `effect`, `runFx`, `setData`, `purgeFx`, `inspect.*`.

## Mutations + invalidation

```ts
import { createMutation, invalidate, invalidateTag } from 'effector-refetch';

const createTodoFx = createEffect((text: string) => api.post('/todos', { text }));
const createTodo = createMutation({ effect: createTodoFx }); // default concurrency TAKE_EVERY
createTodo.start('Buy milk'); // or createTodo.mutate(...)

invalidate({ on: createTodo, refetch: todosQuery }); // refetch on mutation success

// cross-module (no query imports at the call site): tags + invalidateTag
const todosQuery2 = createQuery({ effect: fetchTodosFx, cache: true, tags: ['todos'] });
sample({ clock: createTodo.finished.done, fn: () => 'todos', target: invalidateTag });
// tagged queries purge their cache namespace + refetch with last params;
// tagged infinite queries re-fetch the whole window (refetchAll)
```

`update` / `optimisticUpdate` patch one query's data from another query/mutation/event
(with rollback on failure for the optimistic variant).

## Relating queries

```ts
import { connectQuery, combineQueries } from 'effector-refetch';

// when `characterQuery` succeeds, start `originQuery` with derived params
connectQuery({
  source: characterQuery,
  fn: ({ result }) => ({ params: { url: result.origin.url } }),
  target: originQuery,
});

// effector-flavored useQueries: combined $data/$pending/$errors across queries
const { $data, $pending } = combineQueries({ user: userQuery, todos: todosQuery });
```

## HTTP & validation

```ts
import { createRequestFx, createJsonQuery, RequestError } from 'effector-refetch';

// Abortable effect — a regular Effect<Params, Result>, the AbortSignal arrives via a
// synchronous side channel; throws RequestError { status, data }.
const fetchUserFx = createRequestFx((id: number, { signal }) =>
  fetch(`/api/users/${id}`, { signal }).then((r) => r.json()),
);

// Declarative HTTP query (method/url/body from params + optional contract)
const userQuery = createJsonQuery({
  request: { url: (id: number) => `/api/users/${id}`, method: 'GET' },
  response: { contract: zodContract(UserSchema) }, // validation failure -> retryable ValidationError
  mapData: ({ result }) => result.user, // inline mapData/validate — same semantics as createQuery's
});
```

GraphQL = a `POST` with `{ query, variables }` wrapped in `createRequestFx` (turn GraphQL
`errors` into a `RequestError`). FormData/SSE/WebSocket: it's just an effect — see docs recipes.

**Interop / migration:** `withTanstackCache(getClient, handler, { queryKey, staleTime })` from
`effector-refetch/tanstack` routes a handler through a TanStack `QueryClient` (its cache/dedupe
apply); `apolloHandler(getClient, { document, variables })` from `effector-refetch/apollo` backs a
handler with `client.query` (normalized cache; signal via `context.fetchOptions.signal`). Both are
structural (no deps) and lazy (`getClient` per fork). Don't combine with the query's own `cache`.

**OpenAPI codegen:** `effector-refetch/openapi` is a `@hey-api/openapi-ts@0.82.x` plugin — add
`effectorRefetch()` (its `defineConfig` export) to the hey-api `plugins` array and every GET
becomes a generated `createQuery`, every other method a `createMutation` (`<operationId>Query` /
`<operationId>Mutation` in `refetch.gen.ts`), typed from the spec, abortable (signal forwarded),
`throwOnError: true`, with stable `name: '<operationId>'`. Also fits apicraft (same hey-api line).

## Params mapping (static params / app state in every request)

```ts
import { createQuery } from 'effector-refetch';

// inline: map public params (+ fork-correct source stores) into the effect's params
const postsQuery = createQuery({
  effect: getPostsFx, // Effect<{ search: string; userId: string }, Post[]>
  source: { userId: $userId },
  mapParams: (search: string, { userId }) => ({ search, userId }),
  cache: true, // cache key = MAPPED params (a source change never serves a stale user's entry)
});
postsQuery.start('effector'); // $params / finished.* keep the public params

// a reusable mapped effect: plain attach — cancellation survives for createRequestFx effects
const getPostsForUserFx = attach({
  source: { userId: $userId },
  mapParams: (search: string, { userId }) => ({ search, userId }),
  effect: getPostsFx,
});
```

`refetch`/polling re-read `source` at run time; `retry` reuses the mapping frozen at start.
`mapParams` must be pure. Prefer inline when the mapping belongs to one query (it also keys
the cache by the mapped params — a hand-rolled `attach` leaves the cache on public params).

## Caching

`cache: true` is in-memory + `staleAfter: Infinity`. Adapters: `inMemoryCache`,
`localStorageCache`, `sessionStorageCache`, `voidCache`. Options: `staleAfter`, `key`,
`swr` (serve stale then revalidate), `dedupe` (coalesce in-flight by key).
`getQueryData`/`setQueryData` read/write the cache imperatively.

## Pagination

`createInfiniteQuery({ effect, getNextPageParam, getPreviousPageParam, maxPages })` →
`fetchNext`/`fetchPrevious`, `$pages`, `$hasNextPage`, `$hasPreviousPage`.

## Framework bindings

```ts
// React — values are plain
import { useQuery, useSuspenseQuery } from 'effector-refetch/react';
const { data, isPending, isFail, error, start } = useQuery(userQuery);
const user = useSuspenseQuery(userQuery, id); // auto-starts, suspends, throws to ErrorBoundary

// Vue — values are refs (effector-refetch/vue)
const { data, isPending, start } = useQuery(userQuery); // data.value, isPending.value

// Solid — values are accessors (effector-refetch/solid)
const { data, isPending, start } = useQuery(userQuery); // data(), isPending()
```

Bindings read/bind to the current effector scope (React `<Provider>`, Vue `EffectorScopePlugin`,
Solid `<Provider>`). They do **not** auto-start (except `useSuspenseQuery`).

## SSR & testing (critical idioms)

```ts
import { fork, allSettled } from 'effector';

const scope = fork();
await allSettled(userQuery.start, { scope, params: 1 });
expect(scope.getState(userQuery.$data)).toEqual(/* ... */);
```

- Drive everything through `allSettled(trigger, { scope, params })`; assert via `scope.getState`.
- **Do not `await allSettled` for polling, infinite timers, or barrier-gated runs that stay busy**
  — the scope never goes idle. Fire the trigger, assert/advance, then resolve.
- Tests must avoid real timers/network; model delays inside the effect handler.
- **Cache isolation for SSR**: `fork({ values: [[$queryCache, inMemoryCache()]] })` per request —
  every query in that scope gets an isolated adapter (entries namespaced per query by
  `name` ?? effect sid); transfer with `dehydrate(cache)` / `hydrate(cache, snapshot)`.
  Without `$queryCache` adapters are module-level and shared across scopes.
- **Store-layer transfer needs NO effector plugin**: public stores carry explicit stable sids
  (`er/<name>/$data`, …) — `serialize(scope)` → `fork({ values })` restores $data/$status with
  no flash. Give queries a stable `name`; the USER's own stores still need explicit sids.
- **Next.js (App Router)**: one entry event per page (`pageStarted`); the server component does
  `fork()` → `allSettled(pageStarted, { params })` → `serialize(scope)` → nested
  `<EffectorNext values>`; root layout holds a bare `<EffectorNext>`. Client navigations re-run
  the target page's server component — no extra hooks. See docs recipe `recipes/nextjs`.

## Barrier (auth 401) & offline

```ts
import { createBarrier, createNetworkBarrier } from 'effector-refetch';

// pause the environment on 401, refresh the token, resume the queue
const authBarrier = createBarrier({ perform: refreshTokenFx });
sample({ clock: api.finished.fail, filter: ({ error }) => error.status === 401, target: authBarrier.lock });
const userQuery = createQuery({ effect: fetchUserFx, barrier: authBarrier });

// offline mode: pause runs while offline, resume on reconnect (browser)
const offline = createNetworkBarrier(); // offline.$online: Store<boolean>; offline.stop()
const q = createQuery({ effect: fetchFx, barrier: offline });
```

Barriers/browser helpers (`refetchOnWindowFocus`, `refetchOnReconnect`) use the **no-scope** store
— meant for a single running client app, not per-`fork` isolation.

## Shared defaults & devtools

- `createQueryFactory({ retry, cache, barrier, ... })` → a `createQuery` with shared defaults,
  a group `invalidate`, and a registry of its queries.
- `$queryDefaults` — run-time per-scope defaults (`concurrency`/`retry`/`staleAfter`/`timeout`),
  read at dispatch: `fork({ values: [[$queryDefaults, { timeout: 5_000 }]] })` or
  `setQueryDefaults({ retry: 1 })`. Explicit query config (incl. factory) always wins;
  explicit `timeout: 0` opts out entirely.
- `name` (or `debug: true`) labels every public + internal unit in the effector inspector.
- `attachQueryLogger(query, { name, handler })` for headless logging.
- Visual panels: `EffectorQueryDevtools` from `effector-refetch/devtools` (React) and
  `effector-refetch/devtools/vue` (Vue).

## Common mistakes to avoid

- Expecting a query to fetch on creation — it doesn't; call `start`.
- Using module-level `$store.getState()` in app/SSR code — read via `scope.getState` instead.
- `await allSettled(query.start, ...)` when the query polls / is barrier-gated → it hangs.
- Forgetting bindings return refs (Vue) / accessors (Solid) — call them, don't read raw.
- Reaching into `query.__` (e.g. `__.setData`) in app code — prefer public triggers; `__` is for
  advanced/streaming seams only.
