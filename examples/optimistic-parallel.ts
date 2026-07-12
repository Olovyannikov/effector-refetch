/**
 * Demo: optimistic updates under PARALLEL mutations (the TAKE_EVERY default).
 *
 * Each mutation start stacks its own optimistic layer over a shared base; a
 * failure removes ONLY its own layer — the original data and the neighbours'
 * optimistic values survive. An aborted run (`enabled` gate, TAKE_LATEST
 * supersede) rolls back too; `cancel` / `reset` drop all in-flight layers.
 *
 * Run with: npx tsx examples/optimistic-parallel.ts
 */
import { allSettled, createEffect, fork } from 'effector';
import { createMutation, createQuery, optimisticUpdate } from '../src';

interface Todo {
  id: number;
  text: string;
}

const todosQuery = createQuery({
  effect: createEffect(async (): Promise<Todo[]> => [{ id: 1, text: 'buy milk' }]),
});

// a flaky server: rejects todos containing "fail"
const addTodoFx = createEffect(async (text: string): Promise<Todo> => {
  await new Promise((r) => setTimeout(r, text.length * 10)); // out-of-order settles
  if (text.includes('fail')) throw new Error(`server rejected "${text}"`);
  return { id: Math.trunc(Math.random() * 1000) + 2, text };
});
const addTodo = createMutation({ effect: addTodoFx }); // TAKE_EVERY — parallel writes

optimisticUpdate({
  query: todosQuery,
  on: addTodo,
  update: ({ data, params }) => [...(data ?? []), { id: -1, text: params }], // shown instantly
  commit: ({ data, result }) => (data ?? []).map((t) => (t.id === -1 ? result : t)), // server id
});

async function main() {
  const scope = fork();
  await allSettled(todosQuery.start, { scope });

  // two writes in flight at once; the second one will fail
  const a = allSettled(addTodo.mutate, { scope, params: 'walk the dog' });
  const b = allSettled(addTodo.mutate, { scope, params: 'this will fail' });
  console.log('optimistic:', scope.getState(todosQuery.$data)); // both layers visible

  await Promise.all([a, b]);
  // "this will fail" rolled back ALONE; "walk the dog" kept with its server id —
  // before per-mutation contexts the failure could wipe the original list entirely
  console.log('settled:', scope.getState(todosQuery.$data));
}

main();
