---
'effector-refetch': minor
---

Tag invalidation and `refetchAll` for infinite queries.

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
