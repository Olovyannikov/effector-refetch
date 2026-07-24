---
'effector-refetch': minor
---

`$queryDefaults` — run-time, per-scope query defaults.

A plain store read at dispatch time, so tests and SSR override behavior without
rebuilding queries: `fork({ values: [[$queryDefaults, { timeout: 5_000, retry: 2 }]] })`,
or patch the running app with `setQueryDefaults({ retry: 1 })` (merge semantics).

Supported keys: `concurrency`, `retry`, `staleAfter`, `timeout`. Precedence, highest
first: the query's own config (inline / Store / operators / factory), then
`$queryDefaults`, then built-ins. An explicit value (e.g. `timeout: 0`) always opts
out of the store. Mutations keep their pinned `TAKE_EVERY` default.
