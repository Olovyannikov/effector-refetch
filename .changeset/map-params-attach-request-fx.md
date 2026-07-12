---
'effector-refetch': minor
---

`createRequestFx` effects are now regular `Effect<Params, Result>` units, and queries learned
inline params mapping.

- **`createRequestFx` / `createJsonRequestFx`: honest params.** The per-run `AbortSignal` now
  reaches the handler through a synchronous side channel instead of a `{ params, signal }`
  envelope. The effect is callable directly (`getUserFx({ id: 1 })`) and composable with a
  **plain `attach({ source, mapParams })`** — mapped params, injected stores and real
  cancellation all survive the wrapper (previously a plain `attach` crashed at runtime and
  dropped cancellation). Breaking for code that called the effect with the envelope shape
  manually — call it with plain params instead; `AbortableEffect<Params, Result>` is now
  `Effect<Params, Result> & { __abortable: true }`.
- **`createQuery({ source, mapParams })`** — the `attach` idiom inline: public params
  (+ `source` store values, read fork-correctly per scope) are mapped into the effect's params
  before every run. The public surface (`start` / `$params` / `finished.*` / `mapData` ctx)
  keeps the public params; the effect — and the **cache key** — see the mapped ones, so a
  `source` change can never serve a stale entry. `refetch` / polling re-read the `source`;
  `retry` re-runs with the mapping frozen at start time.
