---
'effector-refetch': patch
---

Fix refetch triggers for queries without params and SSR serialize noise.

- `keepFresh`, `refetchOnWindowFocus` / `refetchOnReconnect` and `refetchOnMount` (React, Vue, Solid) now treat a query as "has run" by `status !== 'initial'` instead of `params != null`. Effector never stores `undefined`, so a query started without params (void) kept `$params === null` and was never refetched (e.g. on a locale change).
- The internal polling token `$pollId` is `serialize: 'ignore'`, so `serialize(scope)` no longer logs "store should have sid" after a query `reset`.
