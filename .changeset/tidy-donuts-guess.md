---
'effector-refetch': patch
---

Scope-isolated cancellation and dedupe. In-flight `AbortController`s and dedupe
keys used to live in a per-query closure shared by every scope, so under
parallel `fork`s (SSR) one scope's `cancel` / TAKE_LATEST supersede could abort
another scope's in-flight request, and `dedupe` could coalesce requests across
scopes. The run registry now lives in a store: each scope lazily creates its
own container, so cancellation and dedupe never cross scope boundaries.
