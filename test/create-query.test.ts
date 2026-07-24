import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { createQuery } from '../src';

describe('createQuery — basics', () => {
  it('goes pending -> done and stores data', async () => {
    const fx = createEffect(async (p: number) => p * 2);
    const q = createQuery({ effect: fx });
    const scope = fork();

    await allSettled(q.start, { scope, params: 21 });

    expect(scope.getState(q.$status)).toBe('done');
    expect(scope.getState(q.$data)).toBe(42);
    expect(scope.getState(q.$error)).toBeNull();
    expect(scope.getState(q.$pending)).toBe(false);
    expect(scope.getState(q.$params)).toBe(21);
  });

  it('captures failures', async () => {
    const fx = createEffect(async () => {
      throw new Error('nope');
    });
    const q = createQuery({ effect: fx });
    const scope = fork();

    await allSettled(q.start, { scope });

    expect(scope.getState(q.$status)).toBe('fail');
    expect((scope.getState(q.$error) as Error).message).toBe('nope');
    expect(scope.getState(q.$data)).toBeNull();
  });

  it('mapData transforms the result', async () => {
    const fx = createEffect(async (id: number) => ({ id, name: `n${id}` }));
    const q = createQuery({ effect: fx, mapData: ({ result }) => result.name });
    const scope = fork();

    await allSettled(q.start, { scope, params: 7 });
    expect(scope.getState(q.$data)).toBe('n7');
  });

  it('respects enabled gate (skips, emits aborted)', async () => {
    const fx = createEffect(async () => 1);
    const { createStore } = await import('effector');
    const $enabled = createStore(false);
    const q = createQuery({ effect: fx, enabled: $enabled });
    const scope = fork();

    const seen: unknown[] = [];
    q.aborted.watch((p) => seen.push(p));

    await allSettled(q.start, { scope });
    expect(scope.getState(q.$status)).toBe('initial');
    expect(seen.length).toBe(1);
  });

  it('reset clears state', async () => {
    const fx = createEffect(async (p: number) => p);
    const q = createQuery({ effect: fx });
    const scope = fork();
    await allSettled(q.start, { scope, params: 5 });
    await allSettled(q.reset, { scope });
    expect(scope.getState(q.$status)).toBe('initial');
    expect(scope.getState(q.$data)).toBeNull();
  });

  it('exposes the real underlying effect', () => {
    const fx = createEffect(async () => 1);
    const q = createQuery({ effect: fx });
    expect(q.__.effect).toBe(fx);
  });

  it('labels units for devtools when a name is given', () => {
    const q = createQuery({ effect: createEffect(async () => 1), name: 'todos' });
    expect(q.__.runFx.shortName).toBe('todos.runFx');
    expect(q.$data.shortName).toBe('todos.$data');
    expect(q.start.shortName).toBe('todos.start');
  });

  it('debug labels units even without a name (uses "query")', () => {
    const q = createQuery({ effect: createEffect(async () => 1), debug: true });
    expect(q.__.runFx.shortName).toBe('query.runFx');
    expect(q.$status.shortName).toBe('query.$status');
  });
});

describe('createQuery — farfetched-compatible finished', () => {
  it('success / failure are aliases of done / fail (same events)', () => {
    const q = createQuery({ effect: createEffect(async () => 1) });
    expect(q.finished.success).toBe(q.finished.done);
    expect(q.finished.failure).toBe(q.finished.fail);
  });

  it('finished.success fires with { params, result } on success', async () => {
    const fx = createEffect(async (p: number) => p * 2);
    const q = createQuery({ effect: fx });
    const scope = fork();
    const seen: Array<{ params: number; result: number }> = [];
    q.finished.success.watch((p) => seen.push(p));

    await allSettled(q.start, { scope, params: 21 });
    expect(seen).toEqual([{ params: 21, result: 42 }]);
  });

  it('finished.failure fires with { params, error } on failure', async () => {
    const fx = createEffect(async (_p: number) => {
      throw new Error('boom');
    });
    const q = createQuery({ effect: fx });
    const scope = fork();
    const seen: Array<{ params: number; error: Error }> = [];
    q.finished.failure.watch((p) => seen.push(p as { params: number; error: Error }));

    await allSettled(q.start, { scope, params: 5 });
    expect(seen.length).toBe(1);
    expect(seen[0].params).toBe(5);
    expect(seen[0].error.message).toBe('boom');
  });

  it('finished.skip fires when the enabled gate blocks a run', async () => {
    const { createStore } = await import('effector');
    const fx = createEffect(async (p: number) => p);
    const q = createQuery({ effect: fx, enabled: createStore(false) });
    const scope = fork();
    const skipped: unknown[] = [];
    const aborted: unknown[] = [];
    q.finished.skip.watch((p) => skipped.push(p));
    q.aborted.watch((p) => aborted.push(p));

    await allSettled(q.start, { scope, params: 7 });
    expect(scope.getState(q.$status)).toBe('initial');
    expect(skipped).toEqual([{ params: 7 }]);
    expect(aborted).toEqual([{ params: 7, reason: 'disabled' }]); // aborted stays the broader superset
  });
});
