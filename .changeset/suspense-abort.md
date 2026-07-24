---
'effector-refetch': patch
---

`useSuspenseQuery` no longer hangs in the Suspense fallback when a suspended
query is cancelled or reset with no data. The settle watcher now also treats
`aborted`, `cancel`, and `reset` as settles (a cancelled NON-abortable effect's
promise may never settle, so waiting for `finished.finally`/`aborted` alone was
not enough); the retry render auto-restarts an `initial` query.
