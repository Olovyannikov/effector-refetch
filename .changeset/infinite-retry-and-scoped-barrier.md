---
'effector-refetch': minor
---

`createInfiniteQuery` now accepts `retry` and `timeout`, forwarded to the page fetch — so
`start` / `fetchNext` / `fetchPrevious` can replay a failed page, and a retried attempt waits at
the `barrier` (the 401 → refresh → retry flow now works for paginated feeds). `refetchAll` still
runs outside the page query and is not retried, but it re-checks the barrier before **every**
page instead of only once, so a refresh starting mid-window holds the remaining pages.

`createBarrier` is fork-isolated: the lock flag and the queue of waiting runs both live in
stores, so concurrent scopes (SSR requests, tests) block and release independently instead of
sharing one no-scope lock. `barrier.__.wait()` is deprecated in favour of the new
`barrier.__.waitFx` effect. Locking from outside effector's call stack (an HTTP layer that saw a 401) now needs `scopeBind(barrier.lock, { safe: true })`, and `createNetworkBarrier` takes an
optional `{ scope }` so its `online`/`offline` listeners lock the right scope.
