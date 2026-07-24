---
'effector-refetch': minor
---

Concurrency lanes and typed abort reasons.

- `concurrency` accepts an object form `{ strategy?, key?: (params) => string }`:
  runs whose params map to the same key compete with each other — TAKE_LATEST
  supersede and TAKE_FIRST busy-drop apply within a lane, different lanes are
  independent (refreshing one table row no longer cancels its neighbours).
  `cancel`/`reset` still affect every lane. `$data` stays single per query —
  lanes partition cancellation, not data. The standalone `concurrency()`
  operator takes the same `key`.
- The `aborted` event payload now carries a typed `reason`:
  `'cancelled' | 'superseded' | 'take-first-busy' | 'disabled'` (new
  `AbortReason` export), so subscribers can tell an explicit cancel from a
  supersede without guessing.
