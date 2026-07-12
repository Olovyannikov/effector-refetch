---
'effector-refetch': minor
---

`$isInitialLoading` / `$isRefetching` — tell a first load from a background refetch.

- `$isInitialLoading` — a run is in flight and there's no real data yet (a `placeholderData`
  value doesn't count, `initialData` does) — show a skeleton.
- `$isRefetching` — a run is in flight over existing real data (refetch / polling / SWR
  revalidation) — keep the data visible, show a corner spinner.

Exposed on the query, through `@@unitShape` (`useUnit(query)`) and in the React / Vue / Solid
`useQuery` helpers.
