---
'effector-refetch': patch
---

The abort reason now rides on the `AbortSignal` itself (reatom-inspired):
handlers — and the errors their `fetch` throws — see `signal.reason` as an
`AbortError` whose message is the reason: `'cancelled'` (cancel/reset),
`'superseded'` (TAKE_LATEST), or `'timeout'` (the per-attempt deadline).
`error.name` stays `'AbortError'`, so fetch/undici abort handling is
unaffected — you just finally know WHY.
