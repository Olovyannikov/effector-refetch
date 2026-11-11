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
navigation is superseded. Wire it to `cancel` — one `fork()` is one request, so cancelling the
scope's runs is exactly the right granularity:

```ts
// TanStack Start
import { createFileRoute } from '@tanstack/react-router';
import { allSettled, fork, serialize } from 'effector';

export const Route = createFileRoute('/users/$id')({
  loader: async ({ abortController, params }) => {
    const scope = fork();

    abortController.signal.addEventListener('abort', () => {
      allSettled(userQuery.cancel, { scope });
    });

    await allSettled(userQuery.start, { scope, params: Number(params.id) });
    return { values: serialize(scope) };
  },
  component: UserPage,
});
```

The same shape works in any loader that exposes a signal (Remix/React Router, Vike's
`onBeforeRender`, a Next.js route handler's `request.signal`).

With several queries in one loader, give the scope a single abort event instead of listing
`cancel`s at the call site:

```ts
import { createEvent, sample } from 'effector';

export const requestAborted = createEvent();

sample({ clock: requestAborted, target: [usersQuery.cancel, statsQuery.cancel] });
```

```ts
abortController.signal.addEventListener('abort', () => {
  allSettled(requestAborted, { scope });
});
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
  Lanes partition _supersede_, not cancellation — so a shared "cancel this one row" is not
  expressible today. That gap is tracked in
  [#95](https://github.com/Olovyannikov/effector-refetch/issues/95).
- Cancelling rolls back an in-flight [`optimisticUpdate`](/recipes/optimistic), so a patch from
  a cancelled mutation doesn't stick.
- `reset` does not clear `$params` — it holds the last _requested_ params, which
  `invalidate` / `keepFresh` / a tag refetch replay.
- A `Date` (or any class instance) in params survives SSR as a string, which is a related trap
  in the same store: [#96](https://github.com/Olovyannikov/effector-refetch/issues/96).
