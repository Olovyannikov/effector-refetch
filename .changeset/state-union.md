---
'effector-refetch': minor
---

`$state` — the whole query state as one discriminated union (reatom-inspired).
Matching on `status` narrows the other fields: `'done'` guarantees non-null
`data`, `'fail'` guarantees `error`; the loading flags ride along in every
variant. Available on the query and through `@@unitShape` (`useUnit(query).state`).
