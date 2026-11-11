---
'effector-refetch': minor
---

`createInfiniteQuery`: consume pages as a stream, with an opt-out of accumulation.

- `finished.done` now carries `pageParam` and `direction: 'initial' | 'next' | 'previous'`, so a normalizing consumer knows whether to replace, append or prepend without diffing `$pages`.
- New `accumulate: false` option: the query keeps only the last page (enough to drive the cursors) and every page arrives through `finished.done` — for feeds whose pages belong in an external normalized store. With it, cursor callbacks see that page alone, `maxPages` is moot, and `refetchAll` reloads just the current page.

Both additive; `accumulate` defaults to `true` and the window behaves exactly as before.
