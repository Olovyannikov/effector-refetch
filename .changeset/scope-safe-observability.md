---
'effector-refetch': patch
---

Scope-safety fixes in observability and bindings.

- `attachQueryLogger`: durations are now tracked per params key instead of one shared slot —
  concurrent (`TAKE_EVERY` / multi-scope) runs no longer clobber each other's `durationMs`.
  New `scope` option restricts the log to one fork (without it the logger stays global).
- `refetchOnWindowFocus` / `refetchOnReconnect`: the effector wiring is created once per
  (query, event) — subscribing on every component mount no longer grows the graph;
  unsubscribe removes only the DOM listener.
- `useSuspenseQuery`: the cached suspense promise is dropped on settle. Previously, if the
  component unmounted before the query settled, a stale resolved promise stayed in the cache
  and the next pending cycle re-threw it — React retried the render in a hot loop.
