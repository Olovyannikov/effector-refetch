---
'effector-refetch': patch
---

Throwing user callbacks no longer kill the propagation (they ran in pure graph
positions, where a throw could strand `$status` at `pending`):

- `mapParams` / `mapData` throws fail the run — `$status: 'fail'`,
  `finished.fail`, `startAsync` rejects;
- `mapError` throws fall back to the raw error; `fallback` throws demote to the
  plain final failure with the original request error;
- `validate` / contract throws become retryable validation failures;
- a throwing lane `key` degrades to the single lane; throwing `connectQuery` /
  `invalidate` predicates count as `false` and don't disturb other subscribers;
- `getNextPageParam` / `getPreviousPageParam` throws mean "no page in that
  direction" instead of a dead settle.

Bonus: `mapData` / `mapError` now run ONCE per settle, so `$data` and
`finished.done` carry the same object identity (they used to be two separate
`mapData` calls).
