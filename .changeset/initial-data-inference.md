---
'effector-refetch': patch
---

Fixed `Mapped` inference in the `initialData` overloads: a bare `initialData: null` (or a
narrower cast) on a nullable-result effect collapsed the store type (`$data: Store<null>`, and a
`!data` guard then narrowed the value to `never`). The overloads are now split by `mapData`
presence — without `mapData` the initial value types against `Result`, with it against the
mapped type — so inference always gets the right candidates. Wrong initial value types are
still rejected.
