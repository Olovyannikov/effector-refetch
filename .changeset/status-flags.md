---
'effector-refetch': minor
---

Farfetched-compatible status flags on queries **and** mutations: `$succeeded`
(`$status === 'done'`), `$failed` (`'fail'`), `$finished` (settled either way). Derived from
`$status`, so they transfer through SSR serialize automatically. Closes another migration gap —
`mutation.$succeeded` now works as-is.
