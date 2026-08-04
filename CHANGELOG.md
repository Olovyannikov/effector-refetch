# effector-refetch

## 0.24.0

### Minor Changes

- 82ad4af: The OpenAPI plugin can now generate infinite queries. Opt in with `infinite` and every paginated
  operation gets a `createInfiniteQuery` twin next to its plain query, with the cursor wired into
  the SDK call's query params. Operations are picked by the spec's own pagination flag (hey-api
  marks `page` / `offset` / `cursor` / …), overridable via `match` and `pageParam`.

  The one thing a spec cannot describe — where the next cursor lives in the response — stays
  yours: `getNextPageParam` (and the optional `getPreviousPageParam`) is a `{ module, name }` the
  generated file imports, and every option except `match` / `suffix` also takes a function, so one
  config can serve several pagination styles. First-page values default by cursor name (`page` →
  `1`, `offset` / `start` → `0`, otherwise `null`); a `null` cursor makes the page param nullable
  and the first request goes out without the parameter at all.

## 0.23.0

### Minor Changes

- e7871ce: `refetchAll` now retries the pages of the window reload. It runs its own sequential loop
  outside the page query, so the graph retry never reached it: a 401 mid-window locked the
  barrier and refreshed the token, but nothing replayed the page and the whole reload failed
  with an already-renewed token. The loop now runs the attempts itself, using the same `retry`
  config the page fetches use (times / delay / filter) and waiting on the `barrier` before every
  attempt, so the replay picks up the fresh token. `retry.times` is read through the effect's
  source, so a `Store<number>` stays fork-correct.

  This supersedes the "`refetchAll` … is not retried" note from the previous release.

## 0.22.0

### Minor Changes

- 3de40f3: `createInfiniteQuery` now accepts `retry` and `timeout`, forwarded to the page fetch — so
  `start` / `fetchNext` / `fetchPrevious` can replay a failed page, and a retried attempt waits at
  the `barrier` (the 401 → refresh → retry flow now works for paginated feeds). `refetchAll` still
  runs outside the page query and is not retried, but it re-checks the barrier before **every**
  page instead of only once, so a refresh starting mid-window holds the remaining pages.

  `createBarrier` is fork-isolated: the lock flag and the queue of waiting runs both live in
  stores, so concurrent scopes (SSR requests, tests) block and release independently instead of
  sharing one no-scope lock. `barrier.__.wait()` is deprecated in favour of the new
  `barrier.__.waitFx` effect. Locking from outside effector's call stack (an HTTP layer that saw a 401) now needs `scopeBind(barrier.lock, { safe: true })`, and `createNetworkBarrier` takes an
  optional `{ scope }` so its `online`/`offline` listeners lock the right scope.

## 0.21.0

### Minor Changes

- 6feb6db: Add `barrier` option to `createInfiniteQuery` — gates `start`, `fetchNext`, `fetchPrevious`, and `refetchAll` on a barrier (e.g. token refresh).

## 0.20.0

### Minor Changes

- bc1fa44: Farfetched-compatible status flags on queries **and** mutations: `$succeeded`
  (`$status === 'done'`), `$failed` (`'fail'`), `$finished` (settled either way). Derived from
  `$status`, so they transfer through SSR serialize automatically. Closes another migration gap —
  `mutation.$succeeded` now works as-is.

## 0.19.2

### Patch Changes

- c94e8e9: Hotfix for 0.19.1, which shipped with **empty type declarations** (every `dist/*.d.ts` was a
  bare `export { }` — `Module '"effector-refetch"' has no exported member 'createQuery'`): the
  d.ts rollup silently produces empty stubs on TypeScript 6, which had just become the build
  toolchain. The declarations pipeline is pinned back to TypeScript 5.9 (the fast native TS 7
  typecheck is unaffected), and the build now fails loudly if the rolled-up declarations are
  empty or missing key exports, so this class of release can't ship again.

## 0.19.1

### Patch Changes

- b2fca99: Fixed `Mapped` inference in the `initialData` overloads: a bare `initialData: null` (or a
  narrower cast) on a nullable-result effect collapsed the store type (`$data: Store<null>`, and a
  `!data` guard then narrowed the value to `never`). The overloads are now split by `mapData`
  presence — without `mapData` the initial value types against `Result`, with it against the
  mapped type — so inference always gets the right candidates. Wrong initial value types are
  still rejected.

## 0.19.0

### Minor Changes

- e9e5a22: `superstructContract` and `typedContract` — the last two named farfetched validation adapters
  are now matched (structural, dependency-free, like the rest): a superstruct `Struct` or a
  typed-contracts validator becomes a `Contract` with per-path error messages. The codemod also
  rewrites `@farfetched/superstruct` / `@farfetched/typed-contracts` imports automatically.
- 14d6e65: `createQuery({ initialData })` / `createJsonQuery({ initialData })` now type `$data` as
  **non-null** (`Store<Data>` instead of `Store<Data | null>`) — with initial data the store can
  never hold `null`, so downstream code needs no `?.` or guards. Matches farfetched's typing and
  removes a whole class of errors when migrating. The `Data` type parameter is threaded through
  `useQuery` in the React / Vue / Solid bindings and `@@unitShape`, and defaults to
  `Mapped | null`, so all existing code compiles unchanged.

## 0.18.0

### Minor Changes

- f553957: SSR store-layer transfer works without the effector babel/SWC plugin: public query stores
  (`$data` / `$status` / `$error` / `$params` / `$stale` / `$lastSettled`, infinite queries'
  `$infinite` / `$params`, `$queryDefaults`) now carry explicit stable sids (`er/<name>/$data`),
  so `serialize(scope)` → `fork({ values })` restores state on the client with no loading flash —
  bundler plugins never process a prebuilt `node_modules` dist, so this previously silently
  transferred nothing. Internal machinery stores are marked `serialize: 'ignore'` (no more
  "store should have sid" console noise). Give queries a stable `name` when server and client
  bundles may initialize modules in a different order — sids follow the same namespace as cache
  entries.

## 0.17.0

### Minor Changes

- c2c14b4: `createJsonQuery` / `createJsonMutation` accept inline `mapData` and `validate` (same semantics
  as `createQuery`'s: `mapData` reshapes the validated response before `$data` — with a new
  `Mapped` type parameter — and `validate` composes after the contract). This also closes the main
  structural gap when migrating farfetched's `response: { mapData, validate }` configs; the
  codemod now performs that migration mechanically.
- 01bae77: New `effector-refetch/openapi` subpath: a `@hey-api/openapi-ts` (0.82.x) plugin that generates a
  fully typed `createQuery` for every GET operation and `createMutation` for every other method —
  wired through `createRequestFx` (real AbortSignal forwarded to the SDK call, `throwOnError: true`
  so `$error` sees real errors) with stable `name: '<operationId>'` for cache namespaces and
  devtools. Compatible with apicraft, which pins the same hey-api line.

  ```ts
  // openapi-ts.config.ts
  import { defineConfig } from '@hey-api/openapi-ts';
  import { defineConfig as effectorRefetch } from 'effector-refetch/openapi';

  export default defineConfig({
    input: './openapi.json',
    output: './src/api',
    plugins: ['@hey-api/client-fetch', effectorRefetch()],
  });
  ```

## 0.16.0

### Minor Changes

- b3a1eac: Two cache options from the reatom comparison:
  - `cache: { fillOnAbort: true }` — a superseded in-flight run is allowed to
    finish so its (almost-ready) response still lands in the cache; only its
    connection to `$data`/status is severed. Explicit `cancel`/`reset` aborts
    for real. Validation still gates the write.
  - `cache: { swr: { silent: true } }` — a failed background SWR revalidation
    keeps serving the stale entry silently: `$error`/`$status` stay untouched
    ("stale is better than an error banner"), while `finished.fail` still fires
    so observers and `startAsync` learn the truth.

- 0cd16b6: Inline `debounce` and `fallback` options (also standalone operators).
  - `debounce: 300` waits before executing a run; a newer run in the same lane
    started during the wait supersedes it BEFORE it hits the network — a true
    debounce for search-as-you-type under TAKE_LATEST. `Store<number>` is
    reactive and fork-correct; `0` disables.
  - `fallback: value | ({ error, params }) => value` recovers a FINAL failure
    (after retries) into data: `$data` gets the value, `$status` becomes 'done',
    `finished.done` fires. The value is not written to the cache, and
    aborts/skips are exempt.

- e669654: Interop adapters for incremental migration: `effector-refetch/tanstack` and
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

- aaf9224: Concurrency lanes and typed abort reasons.
  - `concurrency` accepts an object form `{ strategy?, key?: (params) => string }`:
    runs whose params map to the same key compete with each other — TAKE_LATEST
    supersede and TAKE_FIRST busy-drop apply within a lane, different lanes are
    independent (refreshing one table row no longer cancels its neighbours).
    `cancel`/`reset` still affect every lane. `$data` stays single per query —
    lanes partition cancellation, not data. The standalone `concurrency()`
    operator takes the same `key`.
  - The `aborted` event payload now carries a typed `reason`:
    `'cancelled' | 'superseded' | 'take-first-busy' | 'disabled'` (new
    `AbortReason` export), so subscribers can tell an explicit cancel from a
    supersede without guessing.

- fa331f1: `$queryDefaults` — run-time, per-scope query defaults.

  A plain store read at dispatch time, so tests and SSR override behavior without
  rebuilding queries: `fork({ values: [[$queryDefaults, { timeout: 5_000, retry: 2 }]] })`,
  or patch the running app with `setQueryDefaults({ retry: 1 })` (merge semantics).

  Supported keys: `concurrency`, `retry`, `staleAfter`, `timeout`. Precedence, highest
  first: the query's own config (inline / Store / operators / factory), then
  `$queryDefaults`, then built-ins. An explicit value (e.g. `timeout: 0`) always opts
  out of the store. Mutations keep their pinned `TAKE_EVERY` default.

- 3b64890: `QUEUE` concurrency strategy — serialized runs.

  `concurrency: 'QUEUE'` executes runs strictly one after another: the next
  starts only when the previous settles, failures don't break the chain, and
  settles arrive in start order. Combined with a lane `key`, serialization is
  per lane. `cancel`/`reset` flush the waiting runs — they abort with reason
  `'cancelled'` (so `startAsync` rejects instead of hanging). The classic use
  case: mutations whose writes must not interleave —
  `createMutation({ effect: saveFx, concurrency: 'QUEUE' })`.

- dc5b095: `attachToRoute` now works with @effector/router and re-starts on param changes.
  - The route shape is generalized: any object with `opened` / `updated` / `closed`
    fits — both atomic-router's `RouteInstance` and @effector/router's `Route`
    satisfy it structurally, payload extras (`query`, `replace`) ride into
    `mapParams` untouched.
  - New: `restartOnUpdate` (default `true`) — when the open route receives new
    params (`/users/1` -> `/users/2`), the query re-starts. Previously param
    changes were silently ignored; set `restartOnUpdate: false` for the old
    behavior.
  - @effector/router's "opened fires on every open() call" semantics are handled:
    only a closed -> open transition starts via `opened`, param changes go via
    `updated` — no double requests.

- c6c520c: `startAsync` / `mutateAsync` — imperative promise-returning start, plus a
  `finished.fail` retry fix.
  - `query.startAsync` is a real `Effect<Params, Data>`: `await
userQuery.startAsync(1)` resolves with the run's mapped data and rejects on
    failure or discard (the `AbortReason` rides in the error). `useUnit(query.startAsync)`
    gives a scope-bound promise-returning function for submit handlers;
    `allSettled(query.startAsync, { scope, params })` returns the data in tests.
    Mutations expose the `mutateAsync` alias. Scope-correct by construction:
    calls register unique tokens in a per-scope store and settles are matched in
    the graph.
  - Fixed: with retries, `finished.fail` double-fired on the second-to-last
    attempt with the intermediate error — the retry/final/stale decision is now
    computed atomically against one snapshot.

- 50f014e: `$state` — the whole query state as one discriminated union (reatom-inspired).
  Matching on `status` narrows the other fields: `'done'` guarantees non-null
  `data`, `'fail'` guarantees `error`; the loading flags ride along in every
  variant. Available on the query and through `@@unitShape` (`useUnit(query).state`).

### Patch Changes

- 9f3b296: The abort reason now rides on the `AbortSignal` itself (reatom-inspired):
  handlers — and the errors their `fetch` throws — see `signal.reason` as an
  `AbortError` whose message is the reason: `'cancelled'` (cancel/reset),
  `'superseded'` (TAKE_LATEST), or `'timeout'` (the per-attempt deadline).
  `error.name` stays `'AbortError'`, so fetch/undici abort handling is
  unaffected — you just finally know WHY.
- a6f489e: Audit follow-ups (hardening + docs):
  - infinite query: `setData` patches rederive the cursors and trim `pageParams`
    (no more pages↔params desync); a failed `refetchAll` now reaches `$error` /
    `$status` (the window stays intact).
  - barrier: a shared `perform` effect settling from an unrelated call no longer
    unlocks a barrier that never started it.
  - React devtools panel attaches its logger scope-aware (`useProvidedScope`);
    Vue/Solid limitation documented. `refetchOnMount: 'always'` no longer
    double-fires under StrictMode.
  - web-storage cache evicts corrupt (unparseable) entries on read; factory group
    invalidation survives a throwing predicate.
  - docs: browser triggers' JSDoc corrected (`allSettled`, not `scopeBind`);
    polling-hangs-`allSettled` SSR warning in the auto-refetch recipe; the
    AbortSignal side-channel claim softened to synchronous composition;
    `keepFresh` external-trigger scope note; `attachToRoute` hydration note.

- 5fa4bf1: Throwing user callbacks no longer kill the propagation (they ran in pure graph
  positions, where a throw could strand `$status` at `pending`):
  - `mapParams` / `mapData` throws fail the run — `$status: 'fail'`,
    `finished.fail`, `startAsync` rejects;
  - `mapError` throws fall back to the raw error; `fallback` throws demote to the
    plain final failure with the original request error;
  - `validate` / contract throws become retryable validation failures;
  - a throwing lane `key` degrades to the single lane; throwing `connectQuery` /
    `invalidate` predicates count as `false` and don't disturb other subscribers;
  - `getNextPageParam` / `getPreviousPageParam` throws mean "no page in that
    direction" instead of a dead settle.

  Bonus: `mapData` / `mapError` now run ONCE per settle, so `$data` and
  `finished.done` carry the same object identity (they used to be two separate
  `mapData` calls).

- 2c63ca5: `cancel` now restores the last SETTLED status instead of guessing from
  `data != null`: cancelling a refetch that followed a failure (with stale data
  still on screen) stays `'fail'` — it used to flip to `'done'` and hide the
  failure. First-run cancels still settle to `'initial'`, post-success cancels
  to `'done'`.
- 37a5d89: `optimisticUpdate` no longer discards a real fetch that settles while
  optimistic layers are in flight: the layer queue re-bases onto the fresh data
  (pending layers re-applied on top), so both the settle fold and a rollback
  land on the server data instead of a stale snapshot. Also, throwing
  `update`/`commit`/`fn` callbacks in `update()`/`optimisticUpdate()` now skip
  the failing step instead of killing the propagation.
- 483b702: Retry budgets are now per-run, not per-query. The attempts counter rides in
  the run payload (like `runId`), so concurrent runs — lanes, TAKE_EVERY (the
  mutation default) — never share or reset each other's retry counts, and
  `delay(attempt)` receives each run's own attempt number. The debounce wait and
  the retry pause also got separate effects, so a debounce sleep completing no
  longer clears another run's retrying flag.
- 91381f0: `useSuspenseQuery` no longer hangs in the Suspense fallback when a suspended
  query is cancelled or reset with no data. The settle watcher now also treats
  `aborted`, `cancel`, and `reset` as settles (a cancelled NON-abortable effect's
  promise may never settle, so waiting for `finished.finally`/`aborted` alone was
  not enough); the retry render auto-restarts an `initial` query.
- c0e0f83: Scope-isolated cancellation and dedupe. In-flight `AbortController`s and dedupe
  keys used to live in a per-query closure shared by every scope, so under
  parallel `fork`s (SSR) one scope's `cancel` / TAKE_LATEST supersede could abort
  another scope's in-flight request, and `dedupe` could coalesce requests across
  scopes. The run registry now lives in a store: each scope lazily creates its
  own container, so cancellation and dedupe never cross scope boundaries.
- aaf9224: `createInfiniteQuery` with void params no longer throws "undefined is used to
  skip updates" on `start` — the `$params` store normalizes `undefined` to `null`,
  same as regular queries.

## 0.15.0

### Minor Changes

- a00697c: Loading flavors for `createInfiniteQuery`.
  - `$isInitialLoading` — a run is in flight with no pages accumulated yet (first load / after
    `start` — pages reset) — show a skeleton.
  - `$isFetchingNextPage` / `$isFetchingPreviousPage` — which end of the list is loading, so the
    UI can put the spinner on the right side.
  - `$isRefetching` — `refetchAll` is reloading the window over the visible pages.

  All derived from existing state; exposed on the query and through `@@unitShape` (`useUnit(feed)`).

- 051ac81: `$isInitialLoading` / `$isRefetching` — tell a first load from a background refetch.
  - `$isInitialLoading` — a run is in flight and there's no real data yet (a `placeholderData`
    value doesn't count, `initialData` does) — show a skeleton.
  - `$isRefetching` — a run is in flight over existing real data (refetch / polling / SWR
    revalidation) — keep the data visible, show a corner spinner.

  Exposed on the query, through `@@unitShape` (`useUnit(query)`) and in the React / Vue / Solid
  `useQuery` helpers.

- eeeb4eb: `optimisticUpdate` is now safe for parallel mutations (base + layer queue instead of a single
  rollback snapshot).
  - Each `start` snapshots the pre-mutation data as a shared base (once per in-flight burst) and
    stacks its own optimistic layer; a failure removes **only its own** layer and re-applies the
    remaining ones — previously a second in-flight mutation overwrote the single snapshot, and a
    failure could permanently lose the original data.
  - A success materializes its layer into the base; `commit` keeps its current semantics (it
    receives the data with this mutation's own optimistic layer applied).
  - New: an **aborted** run also rolls back its layer — an `enabled`-gate skip or a `TAKE_LATEST`
    supersede no longer leaves the optimistic value stuck forever.
  - `cancel` / `reset` roll back **all** in-flight layers (previously only until the first settle
    reset the internal flag).
  - Layers are matched to settles by their params (stable JSON, FIFO for identical params) and
    re-applied in start order; non-commuting `update` functions under out-of-order settles should
    reconcile via `commit` or `invalidate`.

- 29ab630: `$queryCache` — scope-isolated cache for multi-tenant SSR.
  - `fork({ values: [[$queryCache, inMemoryCache()]] })` gives every query in that scope an
    isolated cache adapter — concurrent SSR requests can no longer see each other's entries;
    `dehydrate(cache)` snapshots exactly one request's data. Default (`null`) keeps the previous
    behavior: each query uses its own configured adapter.
  - Inside a shared scope adapter, entries are namespaced per query (`name` ?? the effect's sid
    ?? a creation counter) — give queries stable `name`s for SSR hydration when module init
    order may differ between bundles.
  - A query's cache `purge` is scope-aware and removes only that query's namespaced entries
    from the scope adapter.
  - `$queryCache` is excluded from `serialize(scope)`.
  - Internal seam change: `query.__.purgeFx` is now an `EventCallable<void>` (was an `Effect`) —
    the `cache()` operator API is unchanged.

- bc1ab80: Tag invalidation and `refetchAll` for infinite queries.
  - **`tags: string[]`** on `createQuery` / `createInfiniteQuery` + a global
    **`invalidateTag(tag | tags[])`** event — cross-module invalidation with no query imports
    at the call site. A matching tag makes a tagged query purge its cache namespace (prefetch
    warm-ups and entries under other params don't survive) and refetch with its last params
    (only if it has run). Graph-wired per query — no registry; scope-correct via
    `allSettled(invalidateTag, { scope, params })`.
  - **`infiniteQuery.refetchAll()`** — re-fetch every accumulated page with its stored
    pageParam, keeping the window (unlike `start`, which resets to the first page). Sequential,
    atomic swap on completion, token-guarded: a `start`/`reset` during the refetch discards the
    stale result. `$pending` covers the refetch; a failure keeps the current window and surfaces
    through `finished.fail`. A tagged infinite query runs `refetchAll` on `invalidateTag`.

### Patch Changes

- 889e241: Scope-safety fixes in observability and bindings.
  - `attachQueryLogger`: durations are now tracked per params key instead of one shared slot —
    concurrent (`TAKE_EVERY` / multi-scope) runs no longer clobber each other's `durationMs`.
    New `scope` option restricts the log to one fork (without it the logger stays global).
  - `refetchOnWindowFocus` / `refetchOnReconnect`: the effector wiring is created once per
    (query, event) — subscribing on every component mount no longer grows the graph;
    unsubscribe removes only the DOM listener.
  - `useSuspenseQuery`: the cached suspense promise is dropped on settle. Previously, if the
    component unmounted before the query settled, a stale resolved promise stayed in the cache
    and the next pending cycle re-threw it — React retried the render in a hot loop.

## 0.14.0

### Minor Changes

- f95ecc2: `createRequestFx` effects are now regular `Effect<Params, Result>` units, and queries learned
  inline params mapping.
  - **`createRequestFx` / `createJsonRequestFx`: honest params.** The per-run `AbortSignal` now
    reaches the handler through a synchronous side channel instead of a `{ params, signal }`
    envelope. The effect is callable directly (`getUserFx({ id: 1 })`) and composable with a
    **plain `attach({ source, mapParams })`** — mapped params, injected stores and real
    cancellation all survive the wrapper (previously a plain `attach` crashed at runtime and
    dropped cancellation). Breaking for code that called the effect with the envelope shape
    manually — call it with plain params instead; `AbortableEffect<Params, Result>` is now
    `Effect<Params, Result> & { __abortable: true }`.
  - **`createQuery({ source, mapParams })`** — the `attach` idiom inline: public params
    (+ `source` store values, read fork-correctly per scope) are mapped into the effect's params
    before every run. The public surface (`start` / `$params` / `finished.*` / `mapData` ctx)
    keeps the public params; the effect — and the **cache key** — see the mapped ones, so a
    `source` change can never serve a stale entry. `refetch` / polling re-read the `source`;
    `retry` re-runs with the mapping frozen at start time.

## 0.13.0

### Minor Changes

- f638330: Export the `AbortableEffect` and `QueryEffect` types. `AbortableEffect` is what `createRequestFx`
  / `createJsonRequestFx` return; `QueryEffect` is the `effect` accepted by `createQuery` /
  `createMutation` / `createInfiniteQuery`. They were referenced in public signatures but not
  exported, so the types couldn't be named — now they can.
- 3f3f0e3: Hardening pass — scope/fork-correctness, behaviour fixes, perf and type-safety (no breaking changes).

  New / changed behaviour:
  - `optimisticUpdate` now rolls back to the pre-mutation value on `cancel` / `reset` while the
    mutation is in flight (previously only on failure). Gated so a no-op cancel/reset can't wipe data.
  - Polling (`refetchInterval`) resumes when `enabled` flips back to `true`, instead of only on the
    next settle.
  - `refetchOnWindowFocus` / `refetchOnReconnect` accept an optional `scope` so the refetch runs
    fork-correctly (via `allSettled`); without one, behaviour is unchanged.
  - `setQueryData`'s `(prev) => next` updater is applied inside the `$data` reducer (new
    `query.__.updateData` seam) — no `getState`, and scope-correct when run in a scope.
  - `useSuspenseQuery` observes the settle scope-correctly (`createWatch` + per-scope promise cache);
    client-side behaviour is unchanged.
  - `createInfiniteQuery` labels its own units under `name` / `debug` for the inspector.

  Fixes:
  - `invalidate` is a no-op when `on` or `refetch` is empty (parity with `keepFresh`).

  Performance:
  - A query gated by a barrier no longer performs a request that was superseded/cancelled while it
    was waiting on the barrier — it is dropped before hitting the network.
  - A response contract/schema is now evaluated once per result (was up to three times).

  Types:
  - `CreateMutationConfig` now declares `contract`, `validate`, and a sourced
    `concurrency` (`Store<ConcurrencyStrategy>`) — all already supported at runtime, now typed
    (this is what `createJsonMutation` and the factory pass). Internal `as never` config casts removed.

## 0.12.0

### Minor Changes

- ac508c1: Error guards for narrowing `$error` / `finished.fail`: `isRequestError`, `isHttpError(e, status?)`
  (matches a code or a predicate), `isTimeoutError`, and `isValidationError`. Typed `is`-predicates
  that replace `instanceof` + `.status` casts — the farfetched-style "error guards" utility.

  ```ts
  import { isHttpError, isTimeoutError } from 'effector-refetch';
  sample({
    clock: api.finished.fail,
    filter: ({ error }) => isHttpError(error, 401),
    target: authBarrier.lock,
  });
  ```

## 0.11.1

### Patch Changes

- 47a6dd1: Fix published TypeScript declarations for `node16`/`nodenext` and CommonJS consumers.
  `@arethetypeswrong/cli` flagged the previous single ESM-flavored `.d.ts` (served for both
  `import` and `require`) as "masquerading as ESM" under CJS, plus internal resolution errors from
  extensionless relative imports. The declarations are now rolled up per entry (no relative imports),
  ship a `.d.cts` for the `require` condition, and the `exports` map carries per-condition `types`.
  With `typesVersions` for subpaths, every entry resolves cleanly under node10 / node16 (CJS + ESM) /
  bundler. Added an `attw --pack` CI gate and an `engines: node >=18` field. No API or runtime change.

## 0.11.0

### Minor Changes

- 621e29a: farfetched-compatible `finished` events. Every query/mutation's `finished` now also exposes
  `success` (alias of `done`), `failure` (alias of `fail`), and `skip` (`{ params }`, fired when the
  `enabled` gate blocks a run). Existing `done`/`fail`/`finally` are unchanged, and the broader
  `aborted` event still fires for every discarded run (skip / cancel / reset / TAKE_LATEST supersede),
  so it stays a superset of `skip`. Lets code written against farfetched's
  `finished.success`/`finished.failure`/`finished.skip` work as-is.

## 0.10.0

### Minor Changes

- 183c26f: `attachToRoute({ route, query, mapParams?, resetOnClose? })` — router integration: start a query
  when a route opens (with its params) and reset it when the route closes. Structural (atomic-router
  isn't imported — any object with `opened`/`closed` works) and pure `sample`, so it's
  scope-correct for SSR. Documented in the Router recipe with an atomic-router example.
- ed78de3: `createJsonRequestFx(request)` — exposes the declarative request **effect** (url / query / body /
  headers, sourced `Store` fields, abort-aware, normalized `RequestError`) that powers
  `createJsonQuery`/`createJsonMutation`. Use it anywhere an effect is expected — `createQuery`,
  `createMutation`, `createInfiniteQuery`, `connectQuery` — instead of hand-writing `createRequestFx`.
  Also adds a consolidated **Operators** docs page + a runnable `examples/operators.ts`.
- 8e21728: `@@trigger` protocol. Every query and mutation now implements
  [`@@trigger`](https://withease.effector.dev/protocols/trigger.html) — `query['@@trigger']()`
  returns `{ fired, setup, teardown }` where `fired` is `finished.done` — so a unit can drive
  farfetched's `keepFresh({ triggers })` (and any protocol consumer). It's scoped/fork-correct:
  `fired` mirrors the unit's own (scoped) success, and `setup`/`teardown` are protocol placeholders
  that don't gate firing.

  `keepFresh` now accepts `triggers` in addition to `source`: `keepFresh(query, { triggers: [mutation, tabFocused] })`
  refetches whenever any `@@trigger` (our queries/mutations, withease web-API triggers,
  farfetched-compatible triggers) or a plain effector `Event` fires. `isTrigger` and the `Trigger`
  type are exported.

## 0.9.0

### Minor Changes

- 04fc66c: `applyBarrier(query, barrier)` operator — gate an already-created query/mutation on a barrier
  (the composable equivalent of the `barrier` config option); pass `null` to detach. Backed by a new
  `__.setBarrier` engine seam, so the barrier is now swappable at runtime.
- 2c1b3f9: Cache dehydrate/hydrate for SSR — `dehydrate(adapter)` snapshots a cache adapter into a
  JSON-serializable array, `hydrate(adapter, snapshot)` restores it (original `storedAt` preserved,
  so `staleAfter` ages from the server's fetch time). `CacheAdapter` gained an optional `dump()`
  (implemented by `inMemoryCache`); adapters that can't enumerate return `[]`. Pairs with effector's
  `serialize`/`fork({ values })` so the client starts warm — no refetch/flicker. New `examples/ssr.ts`
  and an expanded SSR recipe (cache transfer + client persistence via `localStorageCache` or
  `effector-storage`).
- af7479c: `createJsonMutation` — declarative HTTP for writes, the mirror of `createJsonQuery`. Same `request`
  shape (including sourced `Store`/`{ source, fn }` fields), defaults to `POST`, returns a `Mutation`
  (no cache/refresh/stale). The request-effect builder is now shared between the two.
- 2de9fd6: `keepFresh(query, { source })` operator — refetch a query with its last params whenever a `source`
  store (or array of stores) changes, keeping it fresh relative to external state (filters, locale,
  viewer). No-op until the query has run (`status !== 'initial'`) and while it's disabled.
  Dependency-based, complementing the time-based `refetchInterval`.
- 3de7356: `refetchOnMount` for the `useQuery` bindings (React, Vue, Solid) — `useQuery(query, { refetchOnMount: true | 'always' })`
  refetches the query with its last params when the component subscribes (`true` only if stale,
  `'always'` every mount). No-op until the query has run and is enabled. New shared `UseQueryOptions`
  type re-exported from each binding entry.
- b98a55b: `createJsonQuery` request fields can be **sourced from a `Store`** — `url` / `query` / `body` /
  `headers` now accept `(params) => T`, a `Store<T>`, or `{ source: Store, fn: (value, params) => T }`
  (in addition to the previous function form). Store-backed fields are wired through `attach`, so an
  auth token / base URL in state is read **fork-correctly** per scope (SSR-safe), with no global
  mutable client. The non-sourced path is unchanged.
- c047877: `timeout` — a per-attempt deadline. `createQuery({ timeout: 5000 })` (or the standalone
  `timeout(query, 5000)` operator, or a reactive `Store<number>` via the inline option) aborts the
  in-flight request and fails the run with a timeout `RequestError` if it exceeds the deadline. It's
  retryable, so it composes with `retry`, and it's distinct from `refetchInterval` (poll cadence).
  Implemented inside `runFx` via `Promise.race` + the run's AbortController, threaded fork-correctly
  through the run/retry payloads.
- 85d5e2e: More validation adapters: `runtypesContract` (runtypes) and `ioTsContract` (io-ts, reads the Either
  structurally — no fp-ts import), alongside the existing `zodContract` / `standardSchemaContract`.
  Like the others they're structural (the library isn't imported — you pass your validator). Any
  other library (superstruct, typed-contracts, hand-written guards) is a one-line `createContract`.

## 0.8.0

### Minor Changes

- 9e81a57: `update` / `optimisticUpdate` now accept an `InfiniteQuery` — patch a page item in place from a
  mutation (no refetch). For an infinite query the callbacks' `data` is the **array of pages**; map
  over the pages to patch the item. Patches flow through a new `infiniteQuery.__.setData` write seam
  (the panel's `$pages`/`$data` are derived, so they can't be a `sample` target directly). The
  `query` accepted by `update`/`optimisticUpdate` is now the structural `Patchable<QM>` type.

## 0.7.0

### Minor Changes

- f6a0ded: Solid devtools panel — `EffectorQueryDevtools` from `effector-refetch/devtools/solid`, at parity
  with the React and Vue panels (collapsible floating inspector with a query tab list and a
  per-query detail pane: status, params, data, error, live event log). Same props
  (`queries`, `initialIsOpen`, `position`); scope-aware via effector-solid's `<Provider>`. Built
  with `solid-js/h` (no JSX), tree-shaken out of the core bundle.

## 0.6.0

### Minor Changes

- bfa0914: Offline / network mode — `createNetworkBarrier()` (browser). A barrier that locks while the
  browser is offline and unlocks on reconnect: gate queries with it (the `barrier` option or a
  factory default) and their runs pause when the connection drops, then resume automatically when
  it returns. Exposes `$online: Store<boolean>` for UI and `stop()` to detach listeners; pairs with
  `refetchOnReconnect`.

### Patch Changes

- 8cbf62f: Ship a Claude Code Agent Skill (`skills/effector-refetch/SKILL.md`, now included in the published
  package). Copy it into a project's `.claude/skills/` so AI agents know the effect-first API and
  the fork-correct idioms (createQuery/createMutation, bindings, SSR via fork/allSettled, barriers,
  common mistakes). See `skills/README.md` for install.

## 0.5.0

### Minor Changes

- 2dc9292: Solid binding — `useQuery` from `effector-refetch/solid` (via `effector-solid`), at parity with
  the React/Vue bindings. Returns Solid accessors (`data()`, `status()`, `isPending()`, …) plus
  scope-bound triggers (`start`/`refresh`/`refetch`/`reset`/`cancel`); scope-aware via
  effector-solid's `<Provider>`. The binding contains no JSX, so it needs no extra build/test
  plugin. `effector-solid` + `solid-js` are optional peers.
- 15da7ee: React Suspense — `useSuspenseQuery` from `effector-refetch/react`. Returns the data directly
  (never null): auto-starts the query, suspends the nearest `<Suspense>` while loading, throws to
  the nearest Error Boundary on failure, and returns the data when done. Client-side (CSR): reads
  and triggers are scope-aware, the settle signal is observed globally.

## 0.4.0

### Minor Changes

- c341b96: Vue devtools panel — `EffectorQueryDevtools` from `effector-refetch/devtools/vue`, a
  TanStack-style floating inspector at parity with the React panel (live status, params, data,
  error, per-query event log; scope-aware via effector-vue's `EffectorScopePlugin`). Same props
  (`queries`, `initialIsOpen`, `position`). Built as render functions, tree-shaken out of the core
  bundle.

### Patch Changes

- 10d91a1: Fix: `cancel` on an already-settled query is now a no-op. Previously it always re-derived
  `$status` from `$data`, so cancelling after a failure (with stale data from an earlier success
  still present) flipped the status from `fail` back to `done`. Cancel now only settles the status
  while a request is actually in flight (`status === 'pending'`); a finished `done`/`fail` state is
  left untouched.
- d1d2fbb: Deep devtools labelling: `name` (or `debug: true`) now labels every internal seam in the
  effector inspector — `requested`, `proceed`, `toExec`, `lookupFx`, `toRun`, `rawDone`,
  `acceptedDone`, `scheduleRetry`, `failed`, `finalFail`, `$runId`, `$attempts`, the lifecycle
  events, and the poll/prefetch effects — not just the public entry points. Without a name the
  internal units stay anonymous, so production inspector output is unchanged.

## 0.3.0

### Minor Changes

- 62c6108: Automatic refetching (1.1): `refetchInterval` polling option on `createQuery`
  (number or reactive `Store<number>`, paused while disabled, stops on reset,
  fork-correct), plus opt-in browser operators `refetchOnWindowFocus` and
  `refetchOnReconnect`. New "Auto-refetch & polling" recipe, including composing
  with patronum (`interval` / `debounce` / `throttle`).
- 7f51c68: `createBarrier({ perform })` — a mutex to "pause the environment": gated queries (via the
  `barrier` option on `createQuery`/`createMutation` or a factory default) wait while it's
  locked, then resume. With `perform`, locking auto-runs an effect (e.g. token refresh) and
  unlocks when it settles. Enables the classic 401 → refresh → replay-queue flow.

  Also fixes a bug where `cancel` left `$status` stuck on `pending`: cancel now settles the
  status (`done` if there's data, else `initial`) and clears `$pending` immediately, even
  for non-abortable effects whose promise resolves later.

- 4bb0808: Add a `debug` option to `createQuery`/`createMutation` that labels the public and
  inspect units for the effector inspector even without a `name`. New "Inspector &
  logging" recipe covering `@effector/inspector` and `attachQueryLogger`.
- 3efd634: Add a visual devtools panel: `EffectorQueryDevtools` from `effector-refetch/devtools`
  (React). A floating, TanStack-style panel listing queries with live status, params,
  data, error and a per-query event log (built on the introspection stream). Tree-shaken
  out of the core bundle; render it only in development.
- f28e482: Shared defaults + data UX:
  - `createQueryFactory(defaults)` — bake shared policy (retry / cache / concurrency /
    refetchInterval / structuralSharing / enabled / debug) into `createQuery` and
    `createMutation`; per-call options override. The effector-flavored alternative to a
    global QueryClient (e.g. make every query poll in one place).
  - `structuralSharing: true` — preserve referential identity of unchanged parts of the
    result (fewer re-renders). `keepPreviousData` is the default and now documented.

- 50382fe: Cache & client surface (1.3):
  - Factory group invalidation: `createQueryFactory().invalidate(predicate?)` — a
    scope-correct event that refetches every query the factory created (that has run),
    optionally narrowed by a predicate. The effector-flavored `invalidateQueries`.
  - Imperative cache access: `getQueryData(query)` / `setQueryData(query, value | (prev) => next)`
    (backed by a new `query.__.setData` event).

- 2b1929e: Lists & parallelism (1.4):
  - Bidirectional infinite queries: `getPreviousPageParam` enables `fetchPrevious`
    (prepends) with `$hasPreviousPage`, and `maxPages` caps the window (dropping from the
    opposite end).
  - `combineQueries([...])` — aggregate independent queries into combined stores
    (`$data` tuple, `$pending`, `$statuses`, `$errors`, `$isError`, `$isSuccess`); the
    effector-flavored `useQueries`.

- cabaf3d: Data UX (1.2): `placeholderData` (value or `(prev) => …`) with a `$isPlaceholderData`
  store, and `query.prefetch(params)` to warm the cache without touching `$data`/`$status`
  (no-op without a cache, skips when fresh).

## 0.2.0

### Minor Changes

- 683fd0f: Initial public preview. Effect-first query layer for effector:
  - `createQuery` / `createMutation` with inline `retry` / `cache` / `concurrency`, also as standalone composable operators
  - `connectQuery`, `invalidate`, `update`, `optimisticUpdate`
  - reactive (sourced) config, fork-correct
  - real request cancellation via `createRequestFx` (AbortSignal)
  - validation contracts (`zodContract` / `standardSchemaContract`) + `createJsonQuery`
  - `createInfiniteQuery` (pagination)
  - caching: SWR, GC (maxAge/maxEntries), dedupe, persistence with versioning, cache events
  - React & Vue bindings (`useUnit` via `@@unitShape`, plus `useQuery` helpers)
  - introspection: lifecycle event stream + `attachQueryLogger`
