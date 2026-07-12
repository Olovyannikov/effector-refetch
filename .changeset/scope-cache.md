---
'effector-refetch': minor
---

`$queryCache` — scope-isolated cache for multi-tenant SSR.

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
