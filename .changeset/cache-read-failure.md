---
'effector-refetch': patch
---

Fix: a failing cache **read** no longer swallows the run.

`lookupFx` performs the cache read, and every downstream branch was clocked on its `doneData` — nothing was wired to its failure. So a rejecting `adapter.get()` (IndexedDB or a remote cache having a bad moment) or a throwing `cache.key` made the run vanish: no network call, no lifecycle event, `$status` left as it was, and `$data` still showing the **previous** params' result — stale data presented as fresh.

A failed read is now treated as a **miss** and falls through to the network, in the main path and in `prefetch`: a cache is an optimization, never the source of truth, so a flaky one should degrade to "slower", not to "the query stops working".

The failure is no longer silent either — `query.__.inspect.cacheError` (`{ params, error }`) reports it, and `attachQueryLogger` emits it as `cache-error`.
