---
'effector-refetch': minor
---

Hardening pass — scope/fork-correctness, behaviour fixes, perf and type-safety (no breaking changes).

New / changed behaviour:

- `optimisticUpdate` now rolls back to the pre-mutation value on `cancel` / `reset` while the
  mutation is in flight (previously only on failure). Gated so a no-op cancel/reset can't wipe data.
- Polling (`refetchInterval`) resumes when `enabled` flips back to `true`, instead of only on the
  next settle.
- `refetchOnWindowFocus` / `refetchOnReconnect` accept an optional `scope` so the refetch runs
  fork-correctly (via `allSettled`); without one, behaviour is unchanged.
- `setQueryData`'s `(prev) => next` updater is applied inside the `$data` reducer (new
  `query.__.updateData` seam) — no `getState`, and scope-correct when run in a scope.
- `useSuspenseQuery` observes the settle scope-correctly (`createWatch` + per-scope promise cache);
  client-side behaviour is unchanged.
- `createInfiniteQuery` labels its own units under `name` / `debug` for the inspector.

Fixes:

- `invalidate` is a no-op when `on` or `refetch` is empty (parity with `keepFresh`).

Performance:

- A query gated by a barrier no longer performs a request that was superseded/cancelled while it
  was waiting on the barrier — it is dropped before hitting the network.
- A response contract/schema is now evaluated once per result (was up to three times).

Types:

- `CreateMutationConfig` now declares `contract`, `validate`, and a sourced
  `concurrency` (`Store<ConcurrencyStrategy>`) — all already supported at runtime, now typed
  (this is what `createJsonMutation` and the factory pass). Internal `as never` config casts removed.
