---
'effector-refetch': minor
---

Inline `debounce` and `fallback` options (also standalone operators).

- `debounce: 300` waits before executing a run; a newer run in the same lane
  started during the wait supersedes it BEFORE it hits the network — a true
  debounce for search-as-you-type under TAKE_LATEST. `Store<number>` is
  reactive and fork-correct; `0` disables.
- `fallback: value | ({ error, params }) => value` recovers a FINAL failure
  (after retries) into data: `$data` gets the value, `$status` becomes 'done',
  `finished.done` fires. The value is not written to the cache, and
  aborts/skips are exempt.
