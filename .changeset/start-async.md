---
'effector-refetch': minor
---

`startAsync` / `mutateAsync` — imperative promise-returning start, plus a
`finished.fail` retry fix.

- `query.startAsync` is a real `Effect<Params, Data>`: `await
userQuery.startAsync(1)` resolves with the run's mapped data and rejects on
  failure or discard (the `AbortReason` rides in the error). `useUnit(query.startAsync)`
  gives a scope-bound promise-returning function for submit handlers;
  `allSettled(query.startAsync, { scope, params })` returns the data in tests.
  Mutations expose the `mutateAsync` alias. Scope-correct by construction:
  calls register unique tokens in a per-scope store and settles are matched in
  the graph.
- Fixed: with retries, `finished.fail` double-fired on the second-to-last
  attempt with the intermediate error — the retry/final/stale decision is now
  computed atomically against one snapshot.
