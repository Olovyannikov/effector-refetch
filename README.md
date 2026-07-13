# effector-refetch

📖 **Docs:** https://olovyannikov.github.io/effector-refetch/ · 🗺️ [Roadmap](./ROADMAP.md)

A small, friendly query layer for [effector](https://effector.dev), built on **real effects**.

The unit of work is your own `Effect<Params, Result, Error>` (including `attach`-built factory effects) — the query is just a thin reactive shell around it. `retry`, `cache`, `concurrency` and `timeout` are friendly inline options on `createQuery` (and also available as composable standalone operators).

## Install

Published on npm as **`effector-refetch`** (`effector` is a peer dependency):

```bash
pnpm add effector-refetch effector
# npm install effector-refetch effector
# yarn add effector-refetch effector
```

Optional framework bindings — install the peers you use:

```bash
pnpm add effector-react react   # effector-refetch/react  + /devtools
pnpm add effector-vue vue       # effector-refetch/vue    + /devtools/vue
pnpm add effector-solid solid-js # effector-refetch/solid + /devtools/solid
```

```ts
import { createQuery, connectQuery } from 'effector-refetch';

const characterQuery = createQuery({
  effect: fetchCharacterFx, // a real effector Effect
  retry: 3,
  cache: true,
  concurrency: 'TAKE_LATEST',
});

const originQuery = createQuery({ effect: fetchLocationFx });

connectQuery({
  source: characterQuery,
  fn: ({ result: character }) => ({ params: { url: character.origin.url } }),
  target: originQuery,
});

characterQuery.start(1); // origin loads automatically when the character resolves
```

## Query API

`createQuery(config)` returns a `Query` object:

| member                         | type                                          | meaning                                                                    |
| ------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------- |
| `start`                        | `EventCallable<Params>`                       | run (honoring cache / concurrency / enabled)                               |
| `refresh` / `refetch`          | `EventCallable<Params>`                       | run, bypassing cache freshness (`refetch` alias)                           |
| `prefetch`                     | `EventCallable<Params>`                       | warm the cache without touching `$data`/`$status`                          |
| `reset`                        | `EventCallable<void>`                         | reset to initial + invalidate in-flight                                    |
| `cancel`                       | `EventCallable<void>`                         | drop in-flight result, keep data                                           |
| `$data`                        | `Store<Mapped \| null>`                       | latest result                                                              |
| `$error`                       | `Store<Error \| null>`                        | latest error                                                               |
| `$status`                      | `Store<'initial'\|'pending'\|'done'\|'fail'>` |                                                                            |
| `$pending`                     | `Store<boolean>`                              | request (or retry) in flight                                               |
| `$isInitialLoading`            | `Store<boolean>`                              | in flight with no real data yet — show a skeleton                          |
| `$isRefetching`                | `Store<boolean>`                              | in flight over existing data (refetch / polling) — show a corner spinner   |
| `$stale`                       | `Store<boolean>`                              | current data is past `staleAfter`                                          |
| `$enabled`                     | `Store<boolean>`                              | gate                                                                       |
| `$params`                      | `Store<Params \| null>`                       | last params the query ran with                                             |
| `$isPlaceholderData`           | `Store<boolean>`                              | `$data` is the placeholder, not a real result                              |
| `finished.{done,fail,finally}` | `Event<…>`                                    | lifecycle (+ farfetched-compatible `success` / `failure` / `skip` aliases) |
| `aborted`                      | `Event<{ params }>`                           | result discarded (concurrency / cancel / skip)                             |
| `@@trigger`                    | protocol                                      | usable as a `@@trigger` (e.g. farfetched `keepFresh`)                      |
| `__.effect` / `__.runFx`       | `Effect`                                      | escape hatch to the real effects                                           |

### Options

- **`effect`** — your `Effect<Params, Result, Error>`. (`handler: async params => …` is sugar that wraps it in `createEffect`.)
- **`concurrency`** — `'TAKE_LATEST'` (default), `'TAKE_FIRST'`, `'TAKE_EVERY'`.
- **`retry`** — `number` or `{ times, delay?, filter?, suppressIntermediateErrors? }`. Each retry is a real effect call (graph-level), visible in devtools. Helpers: `linearDelay`, `exponentialDelay`.
- **`cache`** — `true` or `{ adapter?, staleAfter?, key?, purge?, swr?, dedupe? }`.
  - `swr: true` — serve a stale entry immediately and revalidate in the background (`$stale` flips `true` → `false` on fresh data).
  - `dedupe: true` — coalesce identical in-flight requests (by key) into a single effect run.
  - Adapters: `inMemoryCache({ maxAge?, maxEntries?, onHit?, onMiss?, onExpired?, onEvicted? })` (default, LRU GC + events), `localStorageCache({ version?, maxAge? })` / `sessionStorageCache({ version?, maxAge? })` (bump `version` to invalidate old data — migrations), `voidCache`.
- **`timeout`** — per-attempt deadline in ms (`number` or `Store<number>`): a slower run is aborted and fails (retryable). How _long_ one attempt may take, vs `refetchInterval`'s how _often_.
- **`refetchInterval`** — poll every N ms after each settle (`number` or `Store<number>`), while enabled and started; `0` = off.
- **`enabled`** — `Store<boolean>` gate.
- **`placeholderData`** — a value or `(prev) => …` shown while there's no real data; `$isPlaceholderData` is `true` until the first real result (unlike `initialData`, not treated as cached).
- **`structuralSharing`** — preserve referential identity of unchanged parts of the result (fewer re-renders).
- **`barrier`** — gate execution on a [barrier](#barriers-auth--offline) (e.g. pause during a token refresh).
- **`contract` / `validate`** — [validate the response](#validation-contracts) before it hits the stores.
- **`mapData` / `mapError`** — normalize result / error before they hit the stores.
- **`source` / `mapParams`** — [map public params into the effect's params](#params-mapping-source--mapparams) before every run (the `attach` idiom, abort-safe).

#### Params mapping (`source` / `mapParams`)

Bake static params or app-wide state (a user id, a token) into every run, so callers pass
only what varies — the `attach({ source, mapParams })` idiom as an inline option:

```ts
const $userId = createStore('user-123');

const postsQuery = createQuery({
  effect: getPostsFx, // Effect<{ search: string; userId: string; limit: number }, Post[]>
  source: { userId: $userId }, // a Store or an object of Stores, read fork-correctly per scope
  mapParams: (search: string, { userId }) => ({ search, userId, limit: 20 }),
  cache: true, // keyed by the MAPPED params — a source change can't serve a stale user's entry
});

postsQuery.start('effector'); // the effect receives { search, userId, limit }
```

The public surface (`start` / `$params` / `finished.*`) keeps the public params; the effect —
and the cache key — see the mapped ones. To reuse one mapped effect across queries, a plain
`attach({ source, mapParams })` works too — `createRequestFx` effects stay truly cancellable
through it (the AbortSignal travels via a synchronous side channel, not inside the params).
Runnable demo: [`examples/map-params.ts`](./examples/map-params.ts).

#### Sourced (reactive) config

Inline `concurrency`, `retry.times`, `cache.staleAfter`, `timeout` and `refetchInterval`
accept a `Store` instead of a constant — the engine reads it reactively and
**fork-correctly** (each scope sees its own value):

```ts
const $retries = createStore(0); // e.g. bump when online
createQuery({ effect: fx, retry: { times: $retries, delay: exponentialDelay(200) } });

createQuery({ effect: fx, concurrency: $strategy, cache: { staleAfter: $ttl } });
```

`enabled` is likewise a store. (Reactive sourcing is available through the inline
options; the standalone operators take constants.)

### Operators

`concurrency` / `retry` / `cache` / `timeout` / `keepFresh` / `applyBarrier` are standalone,
composable operators — the inline options above are just sugar that applies the first four. Use
them directly to compose or to configure a query built elsewhere:

```ts
import { createQuery, concurrency, retry, cache, timeout, keepFresh, applyBarrier } from 'effector-refetch';

const search = createQuery({ effect: searchFx });
concurrency(search, { strategy: 'TAKE_LATEST' });
retry(search, { times: 3, delay: exponentialDelay(200) });
cache(search, { staleAfter: 30_000, purge: loggedOut });
timeout(search, 5000); // abort + fail a run that takes over 5s

// refetch with the last params when a source store changes or a @@trigger fires
keepFresh(search, { source: $filters, triggers: [createTodoMutation, tabFocused] });
applyBarrier(search, authBarrier); // pause runs while the barrier is locked
```

The engine carries the machinery and the operators configure it. `createQuery({ retry, cache, concurrency, timeout })` === calling the operators yourself.

### `connectQuery`

```ts
connectQuery({ source, fn, target, filter? });          // single source
connectQuery({ source: { a, b }, fn, target, filter? }); // multi (waits for all done)
```

`fn` receives `{ result, params }` per source and returns `{ params }` for the target.

## Mutations & invalidation

A mutation is a write-flavored query: the same effect-first engine (status, retry,
concurrency, lifecycle) without cache/refresh/stale, plus a `mutate` alias.
Concurrency defaults to `TAKE_EVERY` so independent writes don't cancel each other.

```ts
import { createMutation, invalidate } from 'effector-refetch';

const addTodo = createMutation({ effect: addTodoFx, retry: 2 });

// when the mutation succeeds, refetch the list (with its last params, bypassing cache)
invalidate({ on: addTodo, refetch: todosQuery });

addTodo.mutate({ text: 'Buy milk' }); // -> todosQuery refetches automatically
```

`invalidate({ on, refetch, filter? })`:

- **`on`** — a Mutation/Query (fires on success), an `Event`, or an `Effect`; or an array of them.
- **`refetch`** — a query or array of queries; each re-runs with its last params, only if it has run before (`status !== 'initial'`).
- **`filter`** — optional gate on the trigger payload (e.g. mutation `{ params, result }`).

Cross-module invalidation — give queries `tags` and fire `invalidateTag('todos')` from
anywhere: tagged queries purge their cache namespace and refetch with their last params;
tagged infinite queries re-fetch the whole accumulated window.

A `Mutation` exposes `{ start, mutate, reset, cancel, $data, $error, $status, $pending, $params, finished, aborted }` and works with `useUnit(mutation)` too (`{ data, pending, mutate, ... }`).

### `update` & optimistic updates

Patch a query's `$data` directly from a mutation result — no refetch:

```ts
import { update, optimisticUpdate } from 'effector-refetch';

update({ query: todosQuery, on: addTodo, fn: ({ data, result }) => [...(data ?? []), result] });
```

Optimistic update: apply immediately on `start`, roll back on failure, optionally reconcile on success:

```ts
optimisticUpdate({
  query: todosQuery,
  on: addTodo,
  update: ({ data, params }) => [{ id: -1, ...params }, ...(data ?? [])], // shown instantly
  commit: ({ data, result }) => (data ?? []).map((t) => (t.id === -1 ? result : t)), // server id
});
```

Combine optimistic feedback with `invalidate` to reconcile against server truth (the TanStack-style pattern).

## Request factory (ofetch / axios)

`createRequestFx<Params, Response>(handler)` wraps any HTTP client into a typed,
devtools-visible effector effect, with shared error normalization (`RequestError`
with `status` / `data`):

```ts
import { ofetch } from 'ofetch';
import axios from 'axios';
import { createRequestFx, createQuery, createMutation } from 'effector-refetch';

// ofetch
const getPostsFx = createRequestFx<{ userId: number }, Post[]>(({ userId }, { signal }) =>
  ofetch('/api/posts', { query: { userId }, signal }),
);

// axios
const createPostFx = createRequestFx<NewPost, Post>((body, { signal }) =>
  axios.post('/api/posts', body, { signal }).then((r) => r.data),
);

const postsQuery = createQuery({ effect: getPostsFx, cache: true, retry: 2 });
const addPost = createMutation({ effect: createPostFx });
```

See [`examples/http-clients.ts`](./examples/http-clients.ts) for a full query +
mutation + invalidate + optimistic flow.

Narrow errors with the guards `isRequestError` / `isHttpError(e, status?)` / `isTimeoutError`
(and `isValidationError`) instead of `instanceof` + status casts:

```ts
import { isHttpError, isTimeoutError } from 'effector-refetch';
sample({
  clock: api.finished.fail,
  filter: ({ error }) => isHttpError(error, 401),
  target: authBarrier.lock,
});
```

### Composing from a shared factory

Bake `baseURL` + headers/auth into a factory once, then declare endpoints in one
line each — the FSD `shared/api` pattern. `createRequestFactory` here is a small helper you
write on top of `createRequestFx` (shown in full in the example), not a library export:

```ts
const createCommonRequestFx = createRequestFactory({
  baseURL: API_URL,
  headers: () => ({ 'X-API-KEY': apiKey }),
});

export const getProductsQuery = createQuery({
  effect: createCommonRequestFx<ProductsRequest, Product[]>((params) => ({ url: '/products', params })),
  cache: { staleAfter: 30_000 },
});
concurrency(getProductsQuery, { strategy: 'TAKE_LATEST' });

export const likeProductMutation = createMutation({
  effect: createInternalRequestFx<number, Product>((id) => ({ url: `/products/${id}/likes`, method: 'PUT' })),
});
invalidate({ on: likeProductMutation, refetch: getProductsQuery });
```

Full runnable version (with the `createRequestFactory` helper, api-key vs bearer
factories, and product endpoints): [`examples/shared-factory.ts`](./examples/shared-factory.ts).

### Real cancellation

Effects built with `createRequestFx` are **abort-aware**: the query owns an
`AbortController` per run and fires the handler's `signal` when the request is
cancelled — so ofetch/axios actually stop:

- `query.cancel()` / `query.reset()` abort all in-flight requests;
- under `TAKE_LATEST`, starting a new request aborts the superseded one;
- `TAKE_EVERY` never aborts earlier requests.

Plain effects (without `createRequestFx`) keep the previous behavior — their
stale results are simply ignored.

`createRequestFx` effects are regular `Effect<Params, Result>` units: callable
directly and composable with a plain `attach` — cancellation survives the wrapper.

> SSR note: in-flight controllers are tracked per query _instance_ (a closure
> `Set`), not per scope. For isolated SSR you already build per-request units, so
> this is a non-issue; just avoid sharing one query instance across concurrent
> requests if you also call `cancel`. For cache isolation set `$queryCache` per fork.

## Validation (contracts)

Validate a response against a schema; a failure becomes a `ValidationError`
(retryable like any other failure):

```ts
import { createQuery, zodContract, standardSchemaContract, createContract } from 'effector-refetch';

createQuery({ effect: getUserFx, contract: zodContract(UserSchema) }); // zod
createQuery({ effect: getUserFx, contract: standardSchemaContract(UserSchema) }); // valibot / zod 3.24+ / arktype
createQuery({ effect: getUserFx, contract: createContract({ isData: (r) => isUser(r) }) }); // manual
createQuery({ effect: getPriceFx, validate: ({ result }) => result >= 0 || ['negative price'] }); // ad-hoc
```

Contracts are **structural** — the schema libraries aren't imported, you pass your
own schema. On failure, `$error` is a `ValidationError` with `.validationErrors`.

[`@withease/contracts`](https://withease.effector.dev/contracts/) needs **no adapter** — its
combinators already have the `{ isData, getErrorMessages }` shape the `contract` option expects:

```ts
import { obj, str, num } from '@withease/contracts';
createQuery({ effect: getUserFx, contract: obj({ id: num, name: str }) });
```

## `createInfiniteQuery` — pagination

Cursor/offset pagination that accumulates pages. `start` loads the first page
(resetting), `fetchNext` appends the next one — driven by `getNextPageParam`:

```ts
import { createInfiniteQuery } from 'effector-refetch';

const feed = createInfiniteQuery({
  effect: fetchPageFx, // Effect<{ params, pageParam }, Page>
  initialPageParam: 0,
  getNextPageParam: ({ lastPage }) => lastPage.nextCursor ?? null, // null/undefined = done
});

feed.start({ tag: 'cats' });
feed.fetchNext(); // appends; no-op when $hasNextPage is false or already loading
feed.refetchAll(); // re-fetches every accumulated page, keeping the window
```

Exposes `$pages` (= `$data`), `$pageParams`, `$hasNextPage`, `$hasPreviousPage`, `$status`, `$pending`,
`$isInitialLoading` / `$isFetchingNextPage` / `$isFetchingPreviousPage` / `$isRefetching`,
`$error`, `finished.{done,fail}`, and `useUnit(feed)` support. Built on `createQuery`,
so the page fetch inherits concurrency / cancellation. Runnable demo:
[`examples/infinite-query.ts`](./examples/infinite-query.ts).

## `createJsonQuery` / `createJsonMutation` — declarative HTTP

Declare an endpoint over the global `fetch` (no HTTP-client dependency), with
abort-aware cancellation, normalized `RequestError`, optional contract, and all the
usual options. Request fields (`url` / `query` / `body` / `headers`) accept a function,
a `Store`, or `{ source, fn }` — sourced fields are wired through `attach`, so an auth
token / base URL in state is read **fork-correctly** per scope:

```ts
import { createJsonQuery, createJsonMutation, HTTP_METHODS, zodContract } from 'effector-refetch';

export const getProductsQuery = createJsonQuery({
  request: { url: 'https://api/products', query: ({ search }) => ({ search, limit: 20 }) },
  response: { contract: zodContract(ProductList) },
  concurrency: 'TAKE_LATEST',
  cache: { staleAfter: 30_000 },
});

// writes get their own helper (defaults to POST, returns a Mutation)
export const createUser = createJsonMutation<NewUser, User>({
  request: { url: 'https://api/users', body: (u) => u },
});
```

`createJsonRequestFx(request)` exposes the same declarative request as a reusable
**effect** you can drop into `createQuery` / `createMutation` / `createInfiniteQuery`.

## Framework bindings

A query implements effector's `@@unitShape` protocol, so you can pass it straight
to `useUnit` from **effector-react**, **effector-vue** or **effector-solid** — no wrapper needed:

```tsx
// React
import { useUnit } from 'effector-react';

function UserCard({ id }: { id: number }) {
  const { data, pending, error, refetch } = useUnit(userQuery);
  // useUnit(query) -> { data, error, status, pending, stale, enabled, params,
  //                     start, refetch, refresh, reset, cancel }
  return pending ? <Spinner /> : <div onClick={() => refetch(id)}>{data?.name}</div>;
}
```

```vue
<!-- Vue -->
<script setup lang="ts">
import { useUnit } from 'effector-vue/composition';
const { data, pending, refetch } = useUnit(userQuery);
</script>
```

There are also thin `useQuery` helpers that add derived booleans
(`isInitial / isPending / isDone / isFail`):

```tsx
// React — effector-refetch/react
import { useQuery } from 'effector-refetch/react';
const { data, isPending, isFail, error, start, refetch } = useQuery(userQuery);
useEffect(() => start(id), [id]); // queries never auto-start
```

```vue
<!-- Vue — effector-refetch/vue (returns refs) -->
<script setup lang="ts">
import { useQuery } from 'effector-refetch/vue';
const { data, isPending, isDone, start } = useQuery(userQuery);
</script>
```

```tsx
// Solid — effector-refetch/solid (returns accessors — call them)
import { useQuery } from 'effector-refetch/solid';
const { data, isPending, start } = useQuery(userQuery); // data(), isPending()
```

React works with `<Provider value={scope}>`, Vue with the `EffectorScopePlugin`, Solid with
effector-solid's `<Provider>` — all for SSR. Bindings require the matching optional peers.

For React Suspense there's `useSuspenseQuery` (auto-starts, suspends while loading, throws to
the nearest Error Boundary): `import { useSuspenseQuery } from 'effector-refetch/react'`.

### Devtools

Pass `name` (or `debug: true`) to label every unit — public **and** internal seams — in the
effector inspector:

```ts
const todos = createQuery({ effect: fetchTodosFx, name: 'todos' });
// units appear as todos.start, todos.$data, todos.runFx, todos.lookupFx, todos.scheduleRetry, …
```

There's also a **visual, TanStack-style devtools panel** for each framework —
`EffectorQueryDevtools` from `effector-refetch/devtools` (React), `…/devtools/vue` and
`…/devtools/solid` — with live status, params, data, error and a per-query event log.

### Introspection / logging

Every query exposes a lifecycle event stream at `query.__.inspect`
(`start / run / done / fail / aborted / cacheHit / cacheMiss / retry`).
`attachQueryLogger` turns it into structured, timed log entries:

```ts
import { attachQueryLogger } from 'effector-refetch';

const stop = attachQueryLogger(todos, { name: 'todos' });
// → { query: 'todos', type: 'run', params, attempt: 0 }
//   { query: 'todos', type: 'done', params, durationMs: 42 }
// pass a custom `handler` to forward into your own logger / the effector inspector
stop(); // unsubscribe
```

## Barriers (auth + offline)

`createBarrier({ perform })` is a mutex: gated queries pause while it's locked, run `perform`
(e.g. refresh a token on a 401), then resume the queue. Attach it via the `barrier` option or the
`applyBarrier` operator.

```ts
import { createQuery, createBarrier, createNetworkBarrier, applyBarrier } from 'effector-refetch';

const auth = createBarrier({ perform: refreshTokenFx });
const userQuery = createQuery({ effect: getUserFx, barrier: auth });

// ready-made offline barrier: locks while the browser is offline, unlocks on reconnect
const offline = createNetworkBarrier(); // also exposes $online
applyBarrier(userQuery, offline);
```

## More

| API                                                 | what                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `combineQueries([...])`                             | aggregate queries into combined stores (`$data` tuple, `$pending`, `$errors`, …) — `useQueries` |
| `attachToRoute({ route, query })`                   | start a query when an atomic-router route opens, reset on close (structural — no router import) |
| `getQueryData` / `setQueryData`                     | imperative cache read / write                                                                   |
| `dehydrate(adapter)` / `hydrate(adapter, snapshot)` | snapshot & restore the whole cache for SSR (pairs with `serialize` / `fork({ values })`)        |
| `refetchOnWindowFocus` / `refetchOnReconnect`       | opt-in, tree-shakeable browser refetch triggers                                                 |
| `keepFresh(query, { source, triggers })`            | refetch on a source store change or a `@@trigger` (another query/mutation, a focus event, …)    |
| `isTrigger` / `Trigger`                             | the `@@trigger` protocol — every query/mutation implements it                                   |

See the [docs](https://olovyannikov.github.io/effector-refetch/) for each.

## AI agents (Claude Code skill)

Ships a [Claude Code skill](./skills/) so agents know the effect-first API and fork-correct
idioms. Install it with the [`skills` CLI](https://github.com/vercel-labs/skills) (works with
Claude Code and 70+ agents), or copy it manually:

```bash
npx skills add Olovyannikov/effector-refetch        # recommended
# or:
cp -R node_modules/effector-refetch/skills/effector-refetch .claude/skills/
```

The docs site also serves [`llms.txt` / `llms-full.txt`](https://olovyannikov.github.io/effector-refetch/guide/llms)
for pasting into a model's context. See [`skills/README.md`](./skills/README.md) for details.

## Development

Uses **pnpm** and **vite**. `pnpm install` also sets up lefthook git hooks (pre-commit lint/format/
typecheck, commit-msg [Conventional Commits](https://www.conventionalcommits.org), pre-push tests).

```bash
pnpm install
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint + eslint-plugin-effector (typed rules)
pnpm test:coverage  # vitest (node + happy-dom) with v8 coverage thresholds
pnpm build          # vite build -> dist/{index,react,vue,solid,devtools,…}.{mjs,cjs} + .d.ts/.d.cts
pnpm attw           # verify published types resolve (node10 / node16 / bundler)
```

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for the full guide (conventions, CI, release flow).

## SSR / tests

Everything is plain effector under the hood, so `fork()` + `allSettled()` work as usual:

```ts
const scope = fork();
await allSettled(characterQuery.start, { scope, params: 1 });
expect(scope.getState(originQuery.$data)).toBeTruthy();
```

> Note: without `$queryCache` cache adapters hold module-level state shared across scopes. Set `fork({ values: [[$queryCache, inMemoryCache()]] })` per request for isolated, dehydratable SSR caches.

## vs. farfetched

[farfetched](https://ff.effector.dev) is the mature reference point — effect-refetch is the
younger, effect-first alternative. The difference in one line: farfetched models a query as its
own event-based `RemoteOperation`; effector-refetch wraps **your real `Effect`** with friendly
inline config. farfetched is still ahead on maturity, sourced-everything config and a couple of
validation adapters (superstruct / typed-contracts); the feature gap is otherwise closed —
declarative reads **and** writes (`createJsonQuery` / `createJsonMutation`), the `@@trigger`
protocol, router integration, `timeout` / `keepFresh`. effector-refetch also adds real
`AbortSignal` cancellation, built-in pagination, barrier/offline, cross-framework visual devtools
and `useSuspenseQuery`.

See the **[honest, up-to-date comparison](https://olovyannikov.github.io/effector-refetch/guide/vs-farfetched)**
(with a where-farfetched-is-ahead section) and the [migration guide](https://olovyannikov.github.io/effector-refetch/guide/migration)
— `npx effector-refetch-codemod` automates most of the switch.

## Status

Pre-1.0, actively developed. Implemented and tested (177 tests via `fork`/`allSettled` + happy-dom):
queries, mutations, invalidation, optimistic/list updates, retry/cache/concurrency/`timeout`/
`keepFresh`/`applyBarrier` operators, validation contracts, `createJsonQuery`/`createJsonMutation`,
`createInfiniteQuery` (bidirectional), `combineQueries`, the `@@trigger` protocol, router integration,
barriers (auth + offline), SSR cache dehydrate/hydrate, React/Vue/Solid bindings + React Suspense,
and visual devtools. The 1.0 tag awaits community feedback. See the [roadmap](./ROADMAP.md).
