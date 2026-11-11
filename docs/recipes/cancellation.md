# Cancelling requests

Cancellation here is real: the query owns an `AbortController` per run, so aborting it rejects
the `fetch` inside your handler instead of just ignoring its result. Four things abort a run —
three of them for free:

- **`query.cancel()` / `query.reset()`** — explicit.
- **A supersede** — under `TAKE_LATEST` a newer run in the same lane aborts the older one.
- **`timeout`** — a per-attempt deadline aborts the attempt and fails the run (retryable).
- **An outside signal** — a router abort, a closing dialog, a page being left. This one you
  wire yourself; the rest of this page is mostly about it.

## Where the signal comes from

`createRequestFx` hands your handler the run's signal as its **second argument**:

```ts
import { createQuery, createRequestFx } from 'effector-refetch';

const getUserFx = createRequestFx(async (id: number, { signal }) => {
  const response = await fetch(`/api/users/${id}`, { signal });
  return response.json();
});

const userQuery = createQuery({ effect: getUserFx, name: 'user' });
```

It travels through a synchronous side channel, deliberately **not** inside the params. Two
reasons it must stay out of them:

- `$params` is serialized state — it ships through `serialize(scope)` so a hydrated client
  knows the last params. A signal (or any class instance) in there leaks into the SSR payload
  and the framework's transport throws when it packs it.
- Params ride through `attach` / `mapParams` composition; a signal inside them would be copied
  and reshaped like data, and cancellation would quietly stop working.

So never do this:

```ts
// ✗ breaks SSR serialization, and the query's own signal is right there anyway
createQuery({ effect: createRequestFx(async (p: { id: number; signal: AbortSignal }) => …) });
```

## `cancel` vs `reset` vs `timeout`

|                         | aborts in flight | `$data` | `$status` after        | fires                 |
| ----------------------- | ---------------- | ------- | ---------------------- | --------------------- |
| `cancel()`              | yes, all lanes   | kept    | last **settled** value | `aborted: cancelled`  |
| `reset()`               | yes, all lanes   | cleared | `initial`              | `aborted: cancelled`  |
| `timeout` elapsed       | yes, that run    | kept    | `fail` (retryable)     | `aborted: timeout`¹   |
| `TAKE_LATEST` supersede | yes, older run   | kept    | from the newest run    | `aborted: superseded` |

¹ the signal's reason says `'timeout'`; the run then fails, so `finished.fail` fires too.

A cancelled run never settles: `finished.done` / `finished.fail` / `finished.finally` stay
silent, and only `aborted` tells you it happened. Observe that, not `finished`, if you need to
react to cancellation. Full semantics: [Cancelling](/api/queries#cancelling-cancel-reset).

## From the UI

`cancel` is a plain event, so it goes through `useUnit` like anything else:

```tsx
import { useUnit } from 'effector-react';

function SearchResults() {
  const [cancel, pending] = useUnit([searchQuery.cancel, searchQuery.$pending]);

  return pending ? <button onClick={cancel}>Stop</button> : null;
}
```

The previous results stay on screen after `cancel` — `$data` is untouched and `$status` falls
back to what it was before the cancelled run. Use `reset` when you want the view to go empty.

## Bridging an outside AbortSignal (SSR loaders)

Frameworks hand loaders an `AbortController` that fires when the client goes away or the
navigation is superseded. `attachToAbortSignal` bridges it — one `fork()` is one request, so
cancelling that scope's runs is exactly the granularity an external signal has:

```ts
// TanStack Start
import { createFileRoute } from '@tanstack/react-router';
import { allSettled, fork, serialize } from 'effector';
import { attachToAbortSignal } from 'effector-refetch';

export const Route = createFileRoute('/users/$id')({
  loader: async ({ abortController, params }) => {
    const scope = fork();
    const { aborted, dispose } = attachToAbortSignal({
      signal: abortController.signal,
      target: userQuery.cancel,
      scope,
    });
    // the client may already be gone — starting here would fetch for nobody
    if (aborted) return { values: serialize(scope) };

    await allSettled(userQuery.start, { scope, params: Number(params.id) });
    dispose();
    return { values: serialize(scope) };
  },
  component: UserPage,
});
```

The same shape works in any loader that exposes a signal (Remix/React Router, Vike's
`onBeforeRender`, a Next.js route handler's `request.signal`).

**`aborted` is the part that matters, and the part a hand-rolled listener misses.** An
`AbortSignal` that is already aborted never emits `abort` again, so a listener attached after
the fact waits forever — and since there is no run in flight yet, cancelling achieves nothing
either. The only thing that helps is **not starting the work**, which is what the flag is for.
Skip it and a request whose client is already gone is served in full.

`target` also takes an array, and `dispose` detaches the listener when the work finished on its
own but the signal outlives it:

```ts
const { dispose } = attachToAbortSignal({
  signal: abortController.signal,
  target: [usersQuery.cancel, statsQuery.cancel],
  scope,
});

try {
  await allSettled(pageStarted, { scope, params: deps });
} finally {
  dispose();
}
```

::: warning Pass `scope` whenever your app forks
It is optional only for an app that never calls `fork()`. With a scope in play, a scope-less
event never reaches that scope's state — the bridge looks wired and cancels nothing.
:::

With a [factory](/recipes/defaults), one target covers every query it built — no list to keep
in sync:

```ts
attachToAbortSignal({ signal: abortController.signal, target: api.cancel, scope });
```

::: warning Don't pass the signal as a param
The temptation is `allSettled(query.start, { params: { signal: abortController.signal } })`.
That puts a non-serializable value into `$params`, and the loader throws while serializing its
own return value — the query's `serialize(scope)` happily carries the signal object into the
payload, and the framework's serializer (seroval in TanStack Start) is the one that rejects it.
:::

## On client-side navigation

Leaving a page should usually stop its requests. `attachToRoute` already resets the query when
the route closes (`resetOnClose`, on by default) — note that `reset` **clears the data**, which
is what you want for a detail page you're done with, but not if the user may come straight back:

```ts
import { sample } from 'effector';

// keep the data for an instant back-navigation, just stop the request
sample({ clock: userRoute.closed, target: userQuery.cancel });
```

For a query whose params change as the user types or filters, you don't need any of this:
`TAKE_LATEST` (the default) aborts the superseded request on its own, and `debounce` drops runs
before they reach the network.

## Notes

- `cancel` is **whole-query**: it aborts every in-flight run across all concurrency lanes.
  Lanes partition _supersede_, not cancellation — so "cancel this one row, not its neighbours"
  is not expressible. Give such a feed its own query instead.
- Cancelling rolls back an in-flight [`optimisticUpdate`](/recipes/optimistic), so a patch from
  a cancelled mutation doesn't stick.
- `reset` does not clear `$params` — it holds the last _requested_ params, which
  `invalidate` / `keepFresh` / a tag refetch replay.
- A `Date` (or any class instance) in params survives SSR as a string unless you give it a
  codec — see [`paramsSerialize`](/api/queries#params-across-ssr-paramsserialize), the related
  trap in the same store.
