# Optimistic updates

Show a change instantly, roll back on failure, reconcile with the server on success —
then optionally `invalidate` to confirm against server truth (the TanStack pattern).

## Try it live

A todo list over a simulated API (~600 ms delay). Adds show up instantly as a dimmed
optimistic item, then solidify when the server commits. Flip the toggle to make the
server reject writes and watch the rollback; fire several adds quickly — `TAKE_EVERY`
keeps a separate optimistic layer per mutation.

<OptimisticTodosDemo>
<template #code>

```ts
import { createQuery, createMutation, optimisticUpdate } from 'effector-refetch';

interface Todo {
  id: number;
  text: string;
  pending?: boolean; // only on the optimistic temp item
}

const todosQuery = createQuery({ handler: fetchTodos }); // simulated API, ~600ms
const addTodo = createMutation({
  handler: addTodoOnServer,
  concurrency: 'TAKE_EVERY', // parallel adds — each keeps its own optimistic layer
});

optimisticUpdate({
  query: todosQuery,
  on: addTodo,
  // applied instantly on addTodo.mutate(text)
  update: ({ data, params }) => [...(data ?? []), { id: 0, text: params, pending: true }],
  // reconcile the temp item with the server result on success
  commit: ({ data, result }) => (data ?? []).map((t) => (t.pending && t.text === result.text ? result : t)),
  // rollbackOnFailure: true (default) — a failed add removes ONLY its own layer
});

addTodo.mutate('Buy milk'); // appears immediately; commits or rolls back ~600ms later
```

</template>
</OptimisticTodosDemo>

## The pattern

```ts
import { createQuery, createMutation, optimisticUpdate, invalidate } from 'effector-refetch';

const todosQuery = createQuery({ effect: fetchTodosFx });
const addTodo = createMutation({ effect: addTodoFx });

optimisticUpdate({
  query: todosQuery,
  on: addTodo,
  // applied immediately on addTodo.mutate(...)
  update: ({ data, params }) => [{ id: -1, text: params.text, pending: true }, ...(data ?? [])],
  // reconcile the temp item with the server result on success
  commit: ({ data, result }) => (data ?? []).map((t) => (t.id === -1 ? result : t)),
  // rollbackOnFailure defaults to true
});

// reconcile against server truth as well
invalidate({ on: addTodo, refetch: todosQuery });

addTodo.mutate({ text: 'Buy milk' });
```

## How it works

- On `addTodo` **start**, the pre-mutation `$data` is snapshotted as the _base_ (once per
  burst of in-flight mutations) and this mutation's optimistic layer is stacked on top.
- On **failure** — or an **aborted** run (`enabled` gate skip, `TAKE_LATEST` supersede) —
  only _that_ mutation's layer is removed; the remaining in-flight layers are re-applied
  over the base.
- On **success**, the layer is materialized into the base (`commit` reconciles it with the
  server result; without `commit` the optimistic value is kept).
- `cancel` / `reset` roll back **all** in-flight layers at once.

Parallel (`TAKE_EVERY`) mutations are safe: each keeps its own layer, so one failure can't
wipe another's optimistic value or the original data.
Runnable demo: [`examples/optimistic-parallel.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/optimistic-parallel.ts).

::: warning
With out-of-order settles the layers are re-applied in **start order** — if your `update`
functions don't commute, the composition may differ from the server's; reconcile via
`commit` or pair with `invalidate` when exact ordering matters. In-flight layers are
matched to settles by their params (stable JSON), so identical params pair FIFO.
:::
