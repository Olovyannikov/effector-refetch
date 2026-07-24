---
'effector-refetch': patch
---

`createInfiniteQuery` with void params no longer throws "undefined is used to
skip updates" on `start` — the `$params` store normalizes `undefined` to `null`,
same as regular queries.
