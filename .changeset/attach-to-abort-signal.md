---
'effector-refetch': minor
---

External cancellation: `attachToAbortSignal` and `factory.cancel`.

A query owns the `AbortSignal` it hands its own handler, but nothing let an **outside** signal — a router's / framework's `AbortController` — reach it. The intuitive workaround, putting the signal into the query params, breaks SSR serialization (`$params` is serialized state).

- `attachToAbortSignal({ signal, target, scope })` fires `target` (one event or an array, typically `query.cancel`) when the signal aborts, through `allSettled` in the given scope — `scopeBind` loses the fork context across the run chain. It fires immediately for an **already aborted** signal, which a hand-rolled listener silently never does, and returns a dispose function.
- `factory.cancel` aborts the in-flight runs of every query a factory created. No predicate, unlike `invalidate`: cancelling an idle query is already a no-op, and narrowing is just `someQuery.cancel()`.

Docs: the SSR-loader bridge in the cancellation recipe, and a "Cancel a group of queries" section next to the group invalidation one.
