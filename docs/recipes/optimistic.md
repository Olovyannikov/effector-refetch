# Optimistic updates

Show a change instantly, roll back on failure, reconcile with the server on success —
then optionally `invalidate` to confirm against server truth (the TanStack pattern).

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

::: warning
With out-of-order settles the layers are re-applied in **start order** — if your `update`
functions don't commute, the composition may differ from the server's; reconcile via
`commit` or pair with `invalidate` when exact ordering matters. In-flight layers are
matched to settles by their params (stable JSON), so identical params pair FIFO.
:::
