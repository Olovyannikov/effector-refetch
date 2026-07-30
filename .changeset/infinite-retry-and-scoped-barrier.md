---
'effector-refetch': minor
---

`createInfiniteQuery` now accepts `retry` and `timeout`, forwarded to the page fetch — so
`start` / `fetchNext` / `fetchPrevious` can replay a failed page, and a retried attempt waits at
the `barrier` (the 401 → refresh → retry flow now works for paginated feeds). `refetchAll` runs
outside the page query, so its reload loop applies the same `retry` itself and waits on the
barrier before **every** attempt: a 401 mid-window refreshes the token and replays that page
instead of failing the whole reload.

`createBarrier` is fork-isolated: the lock flag and the queue of waiting runs both live in
stores, so concurrent scopes (SSR requests, tests) block and release independently instead of
sharing one no-scope lock. `barrier.__.wait()` is deprecated in favour of the new
`barrier.__.waitFx` effect. Locking from outside effector's call stack (an HTTP layer that saw a 401) now needs `scopeBind(barrier.lock, { safe: true })`, and `createNetworkBarrier` takes an
optional `{ scope }` so its `online`/`offline` listeners lock the right scope.
