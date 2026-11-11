---
'effector-refetch': minor
---

`paramsSerialize` — a codec for `$params` across the SSR boundary.

`$params` is serialized state (a hydrated client replays it for `refetchOnMount` / `invalidate` / `keepFresh` / tag refetches), so anything not JSON-shaped degraded silently: a `Date` came back a `string` with the types still promising a `Date`, and a `cache.key` built from it produced a different key on each side of the boundary — so the entries the server warmed were missed and everything refetched.

```ts
createQuery({
  effect,
  paramsSerialize: {
    write: (p) => ({ from: p.from.toISOString() }),
    read: (j) => ({ from: new Date(j.from) }),
  },
});
```

It passes straight through to effector's own per-store `serialize`, so `'ignore'` works too (farfetched's behaviour — at the cost of a hydrated client no longer knowing what to refetch with). `read` may declare the exact shape `write` produced, and the callbacks never see the empty store. Available on `createQuery`, `createMutation` and `createInfiniteQuery` (public params; page params still ride in `$infinite` and must be JSON-shaped).

Also declares `paramsSerialize` on `CreateMutationConfig`, which the engine already honoured.
