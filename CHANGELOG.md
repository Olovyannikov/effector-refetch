# effector-refetch

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
