---
'effector-refetch': minor
---

External cancellation: `attachToAbortSignal` and `factory.cancel`.

A query owns the `AbortSignal` it hands its own handler, but nothing let an **outside** signal — a router's / framework's `AbortController` — reach it. The intuitive workaround, putting the signal into the query params, breaks SSR serialization (`$params` is serialized state).

- `attachToAbortSignal({ signal, target, scope })` fires `target` (one event or an array, typically `query.cancel`) when the signal aborts, in the given scope. It returns `{ aborted, dispose }`: `aborted` tells you the signal was **already** aborted at attach time — such a signal never emits `abort` again and there is no run to cancel yet, so the only thing that helps is not starting the work. Guard on it in a loader, or a request whose client is already gone is served in full.
- `factory.cancel` aborts the in-flight runs of every query a factory created. No predicate, unlike `invalidate`: cancelling an idle query is already a no-op, and narrowing is just `someQuery.cancel()`.

Docs: the SSR-loader bridge in the cancellation recipe, and a "Cancel a group of queries" section next to the group invalidation one.
