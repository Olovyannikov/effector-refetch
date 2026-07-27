---
'effector-refetch': minor
---

`createJsonQuery` / `createJsonMutation` accept inline `mapData` and `validate` (same semantics
as `createQuery`'s: `mapData` reshapes the validated response before `$data` — with a new
`Mapped` type parameter — and `validate` composes after the contract). This also closes the main
structural gap when migrating farfetched's `response: { mapData, validate }` configs; the
codemod now performs that migration mechanically.
