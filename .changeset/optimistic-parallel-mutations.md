---
'effector-refetch': minor
---

`optimisticUpdate` is now safe for parallel mutations (base + layer queue instead of a single
rollback snapshot).

- Each `start` snapshots the pre-mutation data as a shared base (once per in-flight burst) and
  stacks its own optimistic layer; a failure removes **only its own** layer and re-applies the
  remaining ones — previously a second in-flight mutation overwrote the single snapshot, and a
  failure could permanently lose the original data.
- A success materializes its layer into the base; `commit` keeps its current semantics (it
  receives the data with this mutation's own optimistic layer applied).
- New: an **aborted** run also rolls back its layer — an `enabled`-gate skip or a `TAKE_LATEST`
  supersede no longer leaves the optimistic value stuck forever.
- `cancel` / `reset` roll back **all** in-flight layers (previously only until the first settle
  reset the internal flag).
- Layers are matched to settles by their params (stable JSON, FIFO for identical params) and
  re-applied in start order; non-commuting `update` functions under out-of-order settles should
  reconcile via `commit` or `invalidate`.
