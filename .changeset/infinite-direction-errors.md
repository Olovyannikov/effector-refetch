---
'effector-refetch': minor
---

`createInfiniteQuery`: per-direction errors, so a failed `fetchNext` no longer looks like a failed feed.

- New stores `$initialError` / `$nextPageError` / `$previousPageError` (also on `@@unitShape`). Each holds the last failure of that direction, clears when that direction is retried and on `start` / `reset`, and never clears another direction's error. A failed `refetchAll` touches none of them.
- `finished.fail` now carries `direction: 'initial' | 'next' | 'previous' | 'refetchAll'`.
- `$error` / `$status` keep their current aggregate meaning — additive, nothing breaks.
