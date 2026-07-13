---
'effector-refetch': minor
---

Loading flavors for `createInfiniteQuery`.

- `$isInitialLoading` — a run is in flight with no pages accumulated yet (first load / after
  `start` — pages reset) — show a skeleton.
- `$isFetchingNextPage` / `$isFetchingPreviousPage` — which end of the list is loading, so the
  UI can put the spinner on the right side.
- `$isRefetching` — `refetchAll` is reloading the window over the visible pages.

All derived from existing state; exposed on the query and through `@@unitShape` (`useUnit(feed)`).
