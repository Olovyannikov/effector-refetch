# vs. farfetched

[farfetched](https://ff.effector.dev) is the most complete data-fetching tool for effector and
the obvious reference point. It's mature, well-designed, and **open-source / not archived**. This
page is an honest comparison — including where farfetched is still ahead — so you can pick the
right tool, not a sales pitch.

The one-line difference: farfetched models a query as its **own event-based abstraction**
(a `RemoteOperation` built from a `handler`); effector-refetch wraps **your real `Effect`** and
exposes friendly inline config. Different philosophy, lots of overlap.

## Where farfetched is still ahead

Be aware of these before switching:

- **Maturity & ecosystem.** Years in production, a larger community, more accumulated recipes and
  edge-case fixes. effector-refetch is young (0.x) by comparison.
- **Sourced parameters everywhere.** In farfetched almost _every_ field of _every_ operator can be a
  `Store`/source. effector-refetch sources the declarative-HTTP fields (`url` / `query` / `body` /
  `headers` in `createJsonQuery` / `createJsonMutation`) plus a curated config set — `enabled`,
  `concurrency`, `retry.times`, `cache.staleAfter`, `refetchInterval`, `timeout` — and expects the
  rest to come from the effect's params (often via `sample`). Closer than it was, but still narrower.
- **A couple of named validation adapters.** farfetched ships dedicated
  `@farfetched/{runtypes,io-ts,superstruct,typed-contracts,zod}`. effector-refetch now matches
  `runtypesContract`, `ioTsContract`, `zodContract`, plus `standardSchemaContract` (covers any
  Standard-Schema lib — valibot, arktype, zod 4, …), `@withease/contracts` (works natively — same
  `Contract` shape, no adapter), and `createContract`. The remaining named gaps are **superstruct**
  and **typed-contracts** (both reachable via Standard Schema where supported).

## Where effector-refetch is different (and often nicer)

- **Effect-first.** The unit of work is your real `Effect` (incl. `attach` factories) — visible in
  devtools, composable, testable on its own. `query.__.effect` is exactly what you passed.
- **Friendly config.** `retry` / `cache` / `concurrency` / `timeout` are inline options on
  `createQuery` **and** standalone operators (`retry()`, `cache()`, `concurrency()`, `timeout()`,
  `keepFresh()`, `applyBarrier()`) — sugar over the same machinery.
- **Real cancellation.** `createRequestFx` gives an `AbortSignal`; `TAKE_LATEST`/`cancel` actually
  abort the in-flight request, not just discard its result.
- **Declarative HTTP for reads _and_ writes.** `createJsonQuery` + `createJsonMutation`, both over a
  reusable request effect (`createJsonRequestFx`) you can drop into any `createQuery`.
- **`@@trigger` both ways.** Every query/mutation _is_ a `@@trigger` (`fired` = `finished.done`), so
  it drives farfetched's `keepFresh({ triggers })` — and our `keepFresh` accepts any `@@trigger`
  (withease web-API triggers, farfetched-compatible triggers) or a plain `Event` in return.
- **Built-in pagination.** `createInfiniteQuery` (bidirectional `fetchNext`/`fetchPrevious`,
  windowing) — farfetched has no built-in equivalent.
- **Built-in offline mode.** Both libraries have a `createBarrier` mutex (e.g. 401 → refresh →
  replay); effector-refetch adds a ready-made `createNetworkBarrier` that pauses queries while the
  browser is offline.
- **Router, structurally.** `attachToRoute({ route, query })` starts/resets a query on route
  open/close — without importing atomic-router (any `{ opened, closed }` shape works).
- **Tooling.** Visual devtools panels for **React, Vue and Solid**, an introspection event stream,
  an `llms.txt` + a Claude Code agent skill.
- **Bindings & Suspense.** `useUnit(query)` plus `useQuery` helpers for React / Vue / Solid, and
  `useSuspenseQuery` for React Suspense.
- **Small, dependency-free core** (~7 kB) under active development toward 1.0.

## Side by side

|                      | farfetched                                                    | effector-refetch                                                                             |
| -------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| unit of work         | internal event-based executor                                 | your real `Effect` — first-class                                                             |
| API style            | operators                                                     | inline options **and** operators                                                             |
| operators            | `retry`/`cache`/`concurrency`/`timeout`/`keepFresh`/`barrier` | same set — inline **and** standalone                                                         |
| sourced config       | sourced **everything**                                        | HTTP fields (`url`/`query`/`body`/`headers`) + curated config + `source`/`mapParams`         |
| validation           | runtypes / io-ts / superstruct / typed-contracts / zod        | runtypes / io-ts / zod / Standard Schema / `@withease/contracts` (native) / `createContract` |
| declarative HTTP     | `createJsonQuery` + `createJsonMutation`                      | `createJsonQuery` + `createJsonMutation` (over `createJsonRequestFx`)                        |
| pagination           | —                                                             | `createInfiniteQuery` (bidirectional)                                                        |
| cancellation         | abort + discard                                               | real `AbortSignal` via `createRequestFx`                                                     |
| barrier / mutex      | `createBarrier` + `applyBarrier` operator                     | `createBarrier` + `applyBarrier` operator                                                    |
| offline mode         | build it on a barrier                                         | built-in `createNetworkBarrier`                                                              |
| `@@trigger` protocol | implements + consumes (`keepFresh` triggers)                  | implements (every query/mutation) + consumes (`keepFresh` triggers)                          |
| router               | `@farfetched/atomic-router`                                   | `attachToRoute` (structural — no router import)                                              |
| devtools             | `@farfetched/dev-tools`                                       | visual panels (React/Vue/Solid) + introspection stream                                       |
| bindings             | `@farfetched/solid` + `useUnit`                               | react / vue / solid + `useQuery` + `useSuspenseQuery`                                        |
| SSR                  | `fork` / `allSettled` (in-memory cache is global)             | `fork` / `allSettled` + scope-isolated cache (`$queryCache`)                                 |
| maturity / ecosystem | **larger, battle-tested**                                     | young, actively developed                                                                    |

## SSR side by side

Both libraries do SSR the effector way — `fork()` per request, `allSettled`, `serialize(scope)`
for store state (`$data` / `$status` restore without a loading flash). The difference is the
**cache layer**:

- **farfetched** resolves an adapter through an internal `__.$instance` store ("to support Fork
  API"), so substituting an adapter instance per fork is technically possible — but you do it
  per adapter, by hand; the default `inMemoryCache` keeps entries in a closure shared by every
  scope, and the adapter contract (`get` / `set` / `purge` / `unset`) can't enumerate entries,
  so there is no built-in server→client cache transfer. Keys are namespaced by the query's sid
  (the effector babel/SWC plugin is required for caching).
- **effector-refetch** has one switch for the whole app: `fork({ values: [[$queryCache,
inMemoryCache()]] })` isolates every query's cache in that scope. Entries are namespaced per
  query (`name` ?? effect sid ?? counter, no plugin required), `dehydrate(cache)` /
  `hydrate(cache, snapshot)` transfer exactly one request's entries with `storedAt` preserved
  (so `staleAfter` ages from the server fetch), and `$queryCache` is excluded from
  `serialize(scope)` automatically. See the [SSR recipe](/recipes/ssr-and-testing).

## Which should you use?

- **Use farfetched** if you want the most mature option today, lean heavily on sourced-everything
  config, or need the superstruct / typed-contracts validation adapters specifically.
- **Use effector-refetch** if you prefer wrapping your own effects, want inline config, real
  cancellation, built-in pagination, declarative reads **and** writes, the barrier/offline
  primitives, structural router integration, cross-framework devtools, or a small core on an
  actively-maintained project.

Already on farfetched and curious? The [migration guide](/guide/migration) + the
`npx effector-refetch-codemod` tool handle most of the mechanical changes.
