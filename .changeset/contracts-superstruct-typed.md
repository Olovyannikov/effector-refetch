---
'effector-refetch': minor
---

`superstructContract` and `typedContract` — the last two named farfetched validation adapters
are now matched (structural, dependency-free, like the rest): a superstruct `Struct` or a
typed-contracts validator becomes a `Contract` with per-path error messages. The codemod also
rewrites `@farfetched/superstruct` / `@farfetched/typed-contracts` imports automatically.
