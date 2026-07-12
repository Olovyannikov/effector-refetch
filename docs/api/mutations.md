# Mutations & invalidation

## createMutation

A mutation is a write-flavored query: the same effect-first engine (status, retry,
concurrency, lifecycle) without cache/refresh/stale, plus a `mutate` alias.
Concurrency defaults to `TAKE_EVERY` so independent writes don't cancel each other.

```ts
import { createMutation } from 'effector-refetch';

const addTodo = createMutation({ effect: addTodoFx, retry: 2 });
addTodo.mutate({ text: 'Buy milk' });
```

Exposes `{ start, mutate, reset, cancel, $data, $error, $status, $pending, $params,
finished, aborted }` and works with `useUnit(mutation)`.

## invalidate

Refetch queries when something succeeds:

```ts
import { invalidate } from 'effector-refetch';

invalidate({ on: addTodo, refetch: todosQuery });
```

- **`on`** — a Mutation/Query (fires on success), an `Event`, or an `Effect`; or an array.
- **`refetch`** — a query or array; each re-runs with its last params, only if it ran before (`status !== 'initial'`), bypassing cache freshness.
- **`filter`** — optional gate on the trigger payload (e.g. `{ params, result }`).

## invalidateTag

Cross-module invalidation without importing the queries at the call site: give queries
`tags`, fire the tag from anywhere:

```ts
import { invalidateTag, createQuery, createInfiniteQuery } from 'effector-refetch';

const todosQuery = createQuery({ effect: fetchTodosFx, cache: true, tags: ['todos'] });
const feedQuery = createInfiniteQuery({ effect: fetchPageFx, tags: ['todos'] /* … */ });

sample({ clock: addTodo.finished.done, fn: () => 'todos', target: invalidateTag });
// or a batch: invalidateTag(['todos', 'stats'])
```

A matching tag makes every tagged query **purge its cache namespace** (prefetch-warmed
entries and entries under other params don't survive) and **refetch with its last params**
(only if it has run). A tagged infinite query re-runs `refetchAll` — the whole accumulated
window. Scope-correct: `allSettled(invalidateTag, { scope, params: 'todos' })`.

## update

Patch a query's `$data` directly from a result — no refetch:

```ts
import { update } from 'effector-refetch';

update({ query: todosQuery, on: addTodo, fn: ({ data, result }) => [...(data ?? []), result] });
```

## optimisticUpdate

Apply immediately on `start`, roll back on failure, optionally reconcile on success:

```ts
import { optimisticUpdate } from 'effector-refetch';

optimisticUpdate({
  query: todosQuery,
  on: addTodo,
  update: ({ data, params }) => [{ id: -1, ...params }, ...(data ?? [])],
  commit: ({ data, result }) => (data ?? []).map((t) => (t.id === -1 ? result : t)),
});
```

Combine optimistic feedback with `invalidate` to reconcile against server truth.
