---
'effector-refetch': patch
---

`optimisticUpdate` no longer discards a real fetch that settles while
optimistic layers are in flight: the layer queue re-bases onto the fresh data
(pending layers re-applied on top), so both the settle fold and a rollback
land on the server data instead of a stale snapshot. Also, throwing
`update`/`commit`/`fn` callbacks in `update()`/`optimisticUpdate()` now skip
the failing step instead of killing the propagation.
