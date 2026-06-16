---
'effector-refetch': minor
---

Export the `AbortableEffect` and `QueryEffect` types. `AbortableEffect` is what `createRequestFx`
/ `createJsonRequestFx` return; `QueryEffect` is the `effect` accepted by `createQuery` /
`createMutation` / `createInfiniteQuery`. They were referenced in public signatures but not
exported, so the types couldn't be named — now they can.
