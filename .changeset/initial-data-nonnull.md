---
'effector-refetch': minor
---

`createQuery({ initialData })` / `createJsonQuery({ initialData })` now type `$data` as
**non-null** (`Store<Data>` instead of `Store<Data | null>`) — with initial data the store can
never hold `null`, so downstream code needs no `?.` or guards. Matches farfetched's typing and
removes a whole class of errors when migrating. The `Data` type parameter is threaded through
`useQuery` in the React / Vue / Solid bindings and `@@unitShape`, and defaults to
`Mapped | null`, so all existing code compiles unchanged.
