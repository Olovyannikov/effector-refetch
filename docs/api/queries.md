# Queries

```ts
import { createQuery } from 'effector-refetch';

const query = createQuery({
  effect, // Effect<Params, Result, Error> (or `handler`)
  initialData,
  enabled, // Store<boolean>
  mapData,
  mapError,
  contract,
  validate, // see HTTP & validation
  retry, // number | { times, delay?, filter?, suppressIntermediateErrors? }
  cache, // true | { adapter?, staleAfter?, key?, purge?, swr?, dedupe? }
  concurrency, // 'TAKE_LATEST' (default) | 'TAKE_FIRST' | 'TAKE_EVERY'
  name, // devtools label
});
```

## Options

- **`effect`** — your `Effect<Params, Result, Error>`. `handler: async params => …` is sugar.
- **`concurrency`** — how overlapping runs behave:
  - `TAKE_LATEST` (default) — new run supersedes & aborts the previous.
  - `TAKE_FIRST` — ignore new runs while one is in flight.
  - `TAKE_EVERY` — every run applies (last result wins `$data`).
  - `QUEUE` — runs execute strictly one after another (per lane); failures don't break the chain.
  - Object form `{ strategy?, key?: (params) => string }` adds **concurrency lanes**: runs
    whose params map to the same key compete with each other, different lanes are
    independent (refreshing one row doesn't cancel its neighbours). `cancel`/`reset` still
    affect all lanes; `$data` stays single — lanes partition cancellation, not data.
- **`retry`** — `number` or `{ times, delay?, filter?, suppressIntermediateErrors? }`. Each retry is a real effect call. Helpers: `linearDelay`, `exponentialDelay`.
- **`cache`** — `true` or a config (see [caching](#caching)).
- **`enabled`** — `Store<boolean>` gate; while `false`, `start`/`refresh` are skipped.
- **`refetchInterval`** — poll every N ms (`number` or `Store<number>`, 0 = off). See [Auto-refetch & polling](/recipes/auto-refetch).
- **`timeout`** — per-attempt deadline in ms (`number` or `Store<number>`, 0 = off): if a run exceeds it, the in-flight request is aborted and the run **fails** (retryable, so it composes with `retry`). Distinct from `refetchInterval` (how _often_ to poll) — `timeout` is how _long_ one attempt may take.
- **`debounce`** — wait N ms before a run executes (`number` or `Store<number>`, 0 = off); a newer run in the same lane started during the wait supersedes it before the network — true search-as-you-type debounce under TAKE_LATEST.
- **`fallback`** — recover a final failure (after retries) into data: a value or `({ error, params }) => value`; `$status` becomes `done`, `finished.done` fires, the cache is not written; aborts/skips exempt.
- **`structuralSharing`** — preserve referential identity of unchanged parts of the result (fewer re-renders).
- **`placeholderData`** — a value or `(prev) => …` shown while there's no real data; `$isPlaceholderData` is `true` until the first real result. Unlike `initialData`, it's not treated as cached.
- **`mapData` / `mapError`** — normalize result / error before the stores.
- **`source` / `mapParams`** — map public params (+ `source` store values, read fork-correctly) into the effect's params before every run (see [Params mapping](#params-mapping-source-mapparams)).
- **`tags`** — invalidation tags: a matching [`invalidateTag(...)`](/api/mutations#invalidatetag) purges the query's cache namespace and refetches it with its last params.

`$pending` is true for **any** in-flight run. To tell a first load from a background
refetch: `$isInitialLoading` — in flight with no real data yet (placeholder doesn't count;
`initialData` does) — show a skeleton; `$isRefetching` — in flight over existing data
(refetch / polling / SWR revalidation) — keep the data visible, show a corner spinner.
Runnable demo: [`examples/loading-flags.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/loading-flags.ts).

`query.prefetch(params)` warms the cache for `params` **without** touching `$data`/`$status`
(no-op without a cache, skips when already fresh) — e.g. prefetch the next page on hover.

::: tip keepPreviousData by default
`$data` isn't cleared on a new `start` — it keeps the previous result until the new one
arrives. So when params change, the old data stays visible while the new fetch runs
(TanStack's `keepPreviousData`), out of the box. Use `reset()` to clear explicitly.
:::

Share these across many queries with a [factory](/recipes/defaults).

::: tip Throwing callbacks are contained
User callbacks run inside effector's pure computation graph, so a throw is converted
instead of killing the tick: `mapParams` / `mapData` fail the run (`finished.fail`),
`mapError` falls back to the raw error, `fallback` demotes to the plain failure,
`validate` becomes a retryable validation failure; a throwing lane `key` degrades to the
single lane, and throwing `connectQuery` / `invalidate` predicates count as `false`.
:::

## Imperative start: `startAsync`

`query.startAsync` is a real `Effect<Params, Data>` — start a run and `await` its outcome:

```ts
const user = await userQuery.startAsync(1); // resolves with mapped data
// rejects with the run error, or an Error mentioning the AbortReason on discard
```

- **React/Vue/Solid**: `useUnit(query.startAsync)` returns a scope-bound promise-returning
  function — perfect for submit handlers.
- **Tests/SSR**: `(await allSettled(query.startAsync, { scope, params })).value` is the data.
- Mutations expose `mutateAsync` as the alias: `await createTodo.mutateAsync(text)`.
- Calls are matched to settles by params (deep equality, oldest first): two scopes running
  IDENTICAL params at the same instant may swap results — prefer `allSettled` +
  `scope.getState` where that matters.

## Lifecycle events

```ts
query.finished.done; //    { params, result } — a run succeeded
query.finished.fail; //    { params, error }  — a run failed
query.finished.finally; // { params, status: 'done' | 'fail' }
query.aborted; //          { params, reason } — cancel / reset / TAKE_LATEST supersede / skip
```

For **farfetched compatibility**, `finished` also exposes:

```ts
query.finished.success; // alias of finished.done   (same event)
query.finished.failure; // alias of finished.fail   (same event)
query.finished.skip; //    { params } — the `enabled` gate blocked a run
```

`finished.skip` fires only on the `enabled`-gate skip (the query didn't execute). The broader
`aborted` event still fires for **every** discarded run — skip, `cancel`, `reset`, and a
`TAKE_LATEST` supersede — so it stays a superset of `skip`. (Unlike farfetched, `finished.finally`
fires on `done`/`fail` only, not on skip — observe skips via `finished.skip` / `aborted`.)

The same reason also rides on the run's `AbortSignal`: handlers (and the errors their
`fetch` throws) see `signal.reason` as an `AbortError` whose message is the reason —
`'cancelled'`, `'superseded'`, or `'timeout'` for the deadline race.

`aborted` carries a typed `reason` telling **why** the run was discarded:
`'cancelled'` (explicit `cancel`/`reset`), `'superseded'` (a newer run in the same lane
replaced it), `'take-first-busy'` (TAKE_FIRST dropped it while its lane was busy),
`'disabled'` (the `enabled` gate was off).

## Operators

`concurrency` / `retry` / `cache` are also standalone, composable operators — the inline
options are sugar over them. Apply them directly, even after creation:

```ts
import { createQuery, concurrency, retry, cache, timeout } from 'effector-refetch';

const search = createQuery({ effect: searchFx });
concurrency(search, { strategy: 'TAKE_LATEST' });
retry(search, { times: 3, delay: exponentialDelay(200) });
cache(search, { staleAfter: 30_000, purge: loggedOut });
timeout(search, 5000); // abort + fail a run that takes over 5s
```

## Caching

`cache: { adapter?, staleAfter?, key?, purge?, swr?, dedupe? }`

- **`swr: true`** — serve a stale entry immediately, revalidate in the background (`$stale` flips `true` → `false`).
- **`dedupe: true`** — coalesce identical in-flight requests (by key) into one effect run.
- Adapters: `inMemoryCache({ maxAge?, maxEntries?, onHit?, onMiss?, onExpired?, onEvicted? })` (LRU GC + events), `localStorageCache({ version?, maxAge? })` / `sessionStorageCache(...)` (bump `version` to invalidate old data), `voidCache`.
- **`$queryCache`** — scope-level adapter override: `fork({ values: [[$queryCache, inMemoryCache()]] })` gives every query in that scope an isolated cache (multi-tenant SSR). See the [SSR recipe](/recipes/ssr-and-testing#isolating-the-cache-per-request-querycache).

## Params mapping (`source` / `mapParams`)

The `attach({ source, mapParams })` idiom as an inline option — bake static params or
app-wide state (a user id, a token) into every run, so callers pass only what varies.
A [plain `attach` works too](/api/http#composing-with-attach) (abort-awareness included);
the inline option additionally keys the **cache** by the mapped params and saves you a
separate effect declaration:

```ts
const $userId = createStore('user-123');

const postsQuery = createQuery({
  effect: getPostsFx, // Effect<{ search: string; userId: string; limit: number }, Post[]>
  source: { userId: $userId }, // a Store or an object of Stores, read fork-correctly
  mapParams: (search: string, { userId }) => ({ search, userId, limit: 20 }),
  cache: true,
});

postsQuery.start('effector'); // the effect receives { search, userId, limit }
```

- The query's **public surface** (`start` / `$params` / `finished.*` / `mapData` ctx) keeps the
  public params (`'effector'`); the effect sees the mapped ones.
- The **cache key** (and `cache.key`) is computed from the **mapped** params — a `source`
  change is a different key, so another user can never be served the previous user's entry.
- `refetch` / polling / `keepFresh` re-read the `source` at run time; `retry` re-runs with the
  mapping frozen at start time (a retry is the same request).
- `mapParams` must be **pure** — it runs inside a sample `fn`.

## Sourced (reactive) config

Inline `concurrency`, `retry.times`, `cache.staleAfter` (and `enabled`) accept a `Store`
instead of a constant — read reactively and **fork-correctly** (each scope sees its own value):

```ts
const $retries = createStore(0);
createQuery({ effect: fx, retry: { times: $retries, delay: exponentialDelay(200) } });
```

## connectQuery

```ts
connectQuery({ source, fn, target, filter? });           // single source
connectQuery({ source: { a, b }, fn, target, filter? }); // multiple (waits for all done)
```

`fn` receives `{ result, params }` per source and returns `{ params }` for the target.
