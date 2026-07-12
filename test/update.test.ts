import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createEvent, createStore, fork } from 'effector';
import { createMutation, createQuery, optimisticUpdate, update } from '../src';

describe('update (patch $data without refetch)', () => {
  it('appends a mutation result to the query data', async () => {
    let listFetches = 0;
    const listFx = createEffect(async () => {
      listFetches++;
      return ['a'];
    });
    const todos = createQuery({ effect: listFx });

    const addFx = createEffect(async (text: string) => text);
    const addTodo = createMutation({ effect: addFx });

    update({
      query: todos,
      on: addTodo,
      fn: ({ data, result }) => [...(data ?? []), result],
    });

    const scope = fork();
    await allSettled(todos.start, { scope });
    expect(scope.getState(todos.$data)).toEqual(['a']);

    await allSettled(addTodo.mutate, { scope, params: 'b' });

    expect(scope.getState(todos.$data)).toEqual(['a', 'b']);
    expect(listFetches).toBe(1); // no refetch
  });

  it('patches a list item by id (normalized list update)', async () => {
    interface Todo {
      id: number;
      done: boolean;
    }
    const todos = createQuery({
      effect: createEffect(
        async (): Promise<Todo[]> => [
          { id: 1, done: false },
          { id: 2, done: false },
        ],
      ),
    });
    const toggle = createMutation({
      effect: createEffect(async (id: number): Promise<Todo> => ({ id, done: true })),
    });

    update({
      query: todos,
      on: toggle,
      fn: ({ data, result: updated }) => (data ?? []).map((t) => (t.id === updated.id ? updated : t)),
    });

    const scope = fork();
    await allSettled(todos.start, { scope });
    await allSettled(toggle.mutate, { scope, params: 2 });

    expect(scope.getState(todos.$data)).toEqual([
      { id: 1, done: false },
      { id: 2, done: true },
    ]);
  });

  it('works with a raw event trigger', async () => {
    const q = createQuery({ effect: createEffect(async () => 0) });
    const bump = createEvent<number>();

    update({ query: q, on: bump, fn: ({ data, payload }) => (data ?? 0) + payload });

    const scope = fork();
    await allSettled(q.start, { scope });
    await allSettled(bump, { scope, params: 5 });
    expect(scope.getState(q.$data)).toBe(5);
  });
});

describe('optimisticUpdate', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  function deferredMutation() {
    const ctl: Array<{ res: (v: string) => void; rej: (e: unknown) => void }> = [];
    const fx = createEffect(
      (_p: string) =>
        new Promise<string>((res, rej) => {
          ctl.push({ res, rej });
        }),
    );
    return { mutation: createMutation({ effect: fx }), ctl };
  }

  it('applies immediately and rolls back on failure', async () => {
    const todos = createQuery({ effect: createEffect(async () => ['a']) });
    const { mutation, ctl } = deferredMutation();

    optimisticUpdate({
      query: todos,
      on: mutation,
      update: ({ data, params }) => [...(data ?? []), params],
    });

    const scope = fork();
    await allSettled(todos.start, { scope });
    expect(scope.getState(todos.$data)).toEqual(['a']);

    const p = allSettled(mutation.mutate, { scope, params: 'optimistic' });
    // applied synchronously, before the effect resolves
    expect(scope.getState(todos.$data)).toEqual(['a', 'optimistic']);

    ctl[0].rej(new Error('server said no'));
    await p;

    // rolled back
    expect(scope.getState(todos.$data)).toEqual(['a']);
    expect(scope.getState(mutation.$status)).toBe('fail');
  });

  it('keeps the optimistic value on success (no commit)', async () => {
    const todos = createQuery({ effect: createEffect(async () => ['a']) });
    const { mutation, ctl } = deferredMutation();

    optimisticUpdate({
      query: todos,
      on: mutation,
      update: ({ data, params }) => [...(data ?? []), params],
    });

    const scope = fork();
    await allSettled(todos.start, { scope });

    const p = allSettled(mutation.mutate, { scope, params: 'x' });
    expect(scope.getState(todos.$data)).toEqual(['a', 'x']);
    ctl[0].res('ignored-server-value');
    await p;

    expect(scope.getState(todos.$data)).toEqual(['a', 'x']);
  });

  it('rolls back on cancel while in flight', async () => {
    const todos = createQuery({ effect: createEffect(async () => ['a']) });
    const { mutation, ctl } = deferredMutation();

    optimisticUpdate({
      query: todos,
      on: mutation,
      update: ({ data, params }) => [...(data ?? []), params],
    });

    const scope = fork();
    await allSettled(todos.start, { scope });

    const p = allSettled(mutation.mutate, { scope, params: 'optimistic' });
    expect(scope.getState(todos.$data)).toEqual(['a', 'optimistic']);

    const c = allSettled(mutation.cancel, { scope });
    // let the dropped run resolve late — it's no longer current, so it must not re-apply
    ctl[0].res('late');
    await Promise.all([p, c]);
    expect(scope.getState(todos.$data)).toEqual(['a']);
  });

  it('rolls back on reset while in flight', async () => {
    const todos = createQuery({ effect: createEffect(async () => ['a']) });
    const { mutation, ctl } = deferredMutation();

    optimisticUpdate({
      query: todos,
      on: mutation,
      update: ({ data, params }) => [...(data ?? []), params],
    });

    const scope = fork();
    await allSettled(todos.start, { scope });
    const p = allSettled(mutation.mutate, { scope, params: 'x' });
    expect(scope.getState(todos.$data)).toEqual(['a', 'x']);

    const r = allSettled(mutation.reset, { scope });
    ctl[0].res('late');
    await Promise.all([p, r]);
    expect(scope.getState(todos.$data)).toEqual(['a']);
  });

  it('does not wipe data when cancel/reset fires with no update in flight', async () => {
    const todos = createQuery({ effect: createEffect(async () => ['a']) });
    const { mutation } = deferredMutation();

    optimisticUpdate({
      query: todos,
      on: mutation,
      update: ({ data, params }) => [...(data ?? []), params],
    });

    const scope = fork();
    await allSettled(todos.start, { scope });
    // cancel/reset before any mutation start: $active is false, the stale (null)
    // rollback snapshot must not clobber the query data
    await allSettled(mutation.cancel, { scope });
    await allSettled(mutation.reset, { scope });
    expect(scope.getState(todos.$data)).toEqual(['a']);
  });

  it('parallel mutations: a failure rolls back ONLY its own layer', async () => {
    const todos = createQuery({ effect: createEffect(async () => ['a']) });
    const { mutation, ctl } = deferredMutation();
    optimisticUpdate({
      query: todos,
      on: mutation,
      update: ({ data, params }) => [...(data ?? []), params],
    });

    const scope = fork();
    await allSettled(todos.start, { scope });

    const pa = allSettled(mutation.mutate, { scope, params: 'A' });
    const pb = allSettled(mutation.mutate, { scope, params: 'B' });
    expect(scope.getState(todos.$data)).toEqual(['a', 'A', 'B']);

    ctl[0].rej(new Error('A failed'));
    await tick(); // allSettled waits for the whole scope, so flush instead
    // only A's layer removed; the original base survives under B
    expect(scope.getState(todos.$data)).toEqual(['a', 'B']);

    ctl[1].res('ok');
    await Promise.all([pa, pb]);
    expect(scope.getState(todos.$data)).toEqual(['a', 'B']);
  });

  it('parallel mutations: a failure after the other one settled keeps its result', async () => {
    const todos = createQuery({ effect: createEffect(async () => ['a']) });
    const { mutation, ctl } = deferredMutation();
    optimisticUpdate({
      query: todos,
      on: mutation,
      update: ({ data, params }) => [...(data ?? []), params],
    });

    const scope = fork();
    await allSettled(todos.start, { scope });

    const pa = allSettled(mutation.mutate, { scope, params: 'A' });
    const pb = allSettled(mutation.mutate, { scope, params: 'B' });

    ctl[0].res('ok');
    await tick(); // A materialized (no commit -> optimistic value kept)
    expect(scope.getState(todos.$data)).toEqual(['a', 'A', 'B']);

    ctl[1].rej(new Error('B failed'));
    await Promise.all([pa, pb]);
    expect(scope.getState(todos.$data)).toEqual(['a', 'A']);
  });

  it('parallel mutations: both fail -> back to the original base', async () => {
    const todos = createQuery({ effect: createEffect(async () => ['a']) });
    const { mutation, ctl } = deferredMutation();
    optimisticUpdate({
      query: todos,
      on: mutation,
      update: ({ data, params }) => [...(data ?? []), params],
    });

    const scope = fork();
    await allSettled(todos.start, { scope });
    const pa = allSettled(mutation.mutate, { scope, params: 'A' });
    const pb = allSettled(mutation.mutate, { scope, params: 'B' });

    ctl[0].rej(new Error('A failed'));
    await tick();
    ctl[1].rej(new Error('B failed'));
    await Promise.all([pa, pb]);
    expect(scope.getState(todos.$data)).toEqual(['a']);
  });

  it('parallel mutations: commit reconciles its own layer, the other stays optimistic', async () => {
    const todos = createQuery({ effect: createEffect(async () => ['a']) });
    const { mutation, ctl } = deferredMutation();
    optimisticUpdate({
      query: todos,
      on: mutation,
      update: ({ data, params }) => [...(data ?? []), `temp:${params}`],
      commit: ({ data, result }) => (data ?? []).map((x) => (x.startsWith('temp:') ? result : x)),
    });

    const scope = fork();
    await allSettled(todos.start, { scope });
    const pa = allSettled(mutation.mutate, { scope, params: 'A' });
    const pb = allSettled(mutation.mutate, { scope, params: 'B' });
    expect(scope.getState(todos.$data)).toEqual(['a', 'temp:A', 'temp:B']);

    ctl[0].res('server:A');
    await tick();
    expect(scope.getState(todos.$data)).toEqual(['a', 'server:A', 'temp:B']);

    ctl[1].res('server:B');
    await Promise.all([pa, pb]);
    expect(scope.getState(todos.$data)).toEqual(['a', 'server:A', 'server:B']);
  });

  it('cancel rolls back all in-flight layers even after an earlier settle', async () => {
    const todos = createQuery({ effect: createEffect(async () => ['a']) });
    const { mutation, ctl } = deferredMutation();
    optimisticUpdate({
      query: todos,
      on: mutation,
      update: ({ data, params }) => [...(data ?? []), params],
    });

    const scope = fork();
    await allSettled(todos.start, { scope });
    const pa = allSettled(mutation.mutate, { scope, params: 'A' });
    ctl[0].res('ok');
    await pa; // A settles -> materialized

    const pb = allSettled(mutation.mutate, { scope, params: 'B' });
    expect(scope.getState(todos.$data)).toEqual(['a', 'A', 'B']);

    const c = allSettled(mutation.cancel, { scope });
    ctl[1].res('late');
    await Promise.all([pb, c]);
    // B (still in flight at cancel) is rolled back; the settled A stays
    expect(scope.getState(todos.$data)).toEqual(['a', 'A']);
  });

  it('rolls back when the run is skipped by the enabled gate', async () => {
    const todos = createQuery({ effect: createEffect(async () => ['a']) });
    const fx = createEffect(async (p: string) => p);
    const mutation = createMutation({ effect: fx, enabled: createStore(false) });
    optimisticUpdate({
      query: todos,
      on: mutation,
      update: ({ data, params }) => [...(data ?? []), params],
    });

    const scope = fork();
    await allSettled(todos.start, { scope });
    await allSettled(mutation.mutate, { scope, params: 'x' });

    // the run never executed (enabled gate) -> the optimistic layer must not stick
    expect(scope.getState(todos.$data)).toEqual(['a']);
  });

  it('rolls back the superseded layer under TAKE_LATEST', async () => {
    const todos = createQuery({ effect: createEffect(async () => ['a']) });
    const ctl: Array<{ res: (v: string) => void; rej: (e: unknown) => void }> = [];
    const fx = createEffect(
      (_p: string) =>
        new Promise<string>((res, rej) => {
          ctl.push({ res, rej });
        }),
    );
    const mutation = createMutation({ effect: fx, concurrency: 'TAKE_LATEST' });
    optimisticUpdate({
      query: todos,
      on: mutation,
      update: ({ data, params }) => [...(data ?? []), params],
    });

    const scope = fork();
    await allSettled(todos.start, { scope });
    const pa = allSettled(mutation.mutate, { scope, params: 'A' });
    const pb = allSettled(mutation.mutate, { scope, params: 'B' }); // supersedes A
    expect(scope.getState(todos.$data)).toContain('B');

    ctl[1].res('ok');
    ctl[0].res('late'); // A is no longer current
    await Promise.all([pa, pb]);
    // A's layer must not survive: it was superseded and never finished
    expect(scope.getState(todos.$data)).toEqual(['a', 'B']);
  });

  it('reconciles with the server result via commit on success', async () => {
    const todos = createQuery({ effect: createEffect(async () => ['a']) });
    const { mutation, ctl } = deferredMutation();

    optimisticUpdate({
      query: todos,
      on: mutation,
      update: ({ data, params }) => [...(data ?? []), `temp:${params}`],
      commit: ({ data, result }) => (data ?? []).map((x) => (x.startsWith('temp:') ? result : x)),
    });

    const scope = fork();
    await allSettled(todos.start, { scope });

    const p = allSettled(mutation.mutate, { scope, params: 'item' });
    expect(scope.getState(todos.$data)).toEqual(['a', 'temp:item']);
    ctl[0].res('server:item');
    await p;

    expect(scope.getState(todos.$data)).toEqual(['a', 'server:item']);
  });
});
