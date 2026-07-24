import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { createMutation, createQuery } from '../src';
import { abortableDeferred } from './support/harness';

describe('startAsync', () => {
  it('resolves with the mapped data (in scope, via allSettled)', async () => {
    const fx = createEffect(async (id: number) => ({ id, name: `user-${id}` }));
    const query = createQuery({ effect: fx, mapData: ({ result }) => result.name });
    const scope = fork();

    const outcome = await allSettled(query.startAsync, { scope, params: 7 });
    expect(outcome).toEqual({ status: 'done', value: 'user-7' });
    expect(scope.getState(query.$data)).toBe('user-7');
  });

  it('resolves without a scope too', async () => {
    const fx = createEffect(async (n: number) => n * 2);
    const query = createQuery({ effect: fx });
    await expect(query.startAsync(21)).resolves.toBe(42);
  });

  it('rejects with the run error after retries are exhausted', async () => {
    let calls = 0;
    const fx = createEffect(async (_: number) => {
      calls++;
      throw new Error(`boom${calls}`);
    });
    const query = createQuery({ effect: fx, retry: 1 });
    const scope = fork();

    const outcome = (await allSettled(query.startAsync, { scope, params: 1 })) as unknown as {
      status: string;
      value: Error;
    };
    expect(outcome.status).toBe('fail');
    expect(outcome.value.message).toBe('boom2'); // the final attempt's error
    expect(calls).toBe(2);
  });

  it('rejects a superseded run with the abort reason', async () => {
    const d = abortableDeferred<number, string>();
    const query = createQuery({ effect: d.fx, concurrency: 'TAKE_LATEST' });
    const scope = fork();

    const first = allSettled(query.startAsync, { scope, params: 1 });
    const second = allSettled(query.startAsync, { scope, params: 2 });
    d.resolve(1, 'winner');

    const firstOutcome = (await first) as unknown as { status: string; value: unknown };
    expect(firstOutcome.status).toBe('fail');
    expect(String(firstOutcome.value)).toContain('superseded');
    expect(await second).toEqual({ status: 'done', value: 'winner' });
  });

  it('rejects on cancel with the "cancelled" reason', async () => {
    const d = abortableDeferred<number, string>();
    const query = createQuery({ effect: d.fx });
    const scope = fork();

    const run = allSettled(query.startAsync, { scope, params: 1 });
    await allSettled(query.cancel, { scope });

    const outcome = (await run) as unknown as { status: string; value: unknown };
    expect(outcome.status).toBe('fail');
    expect(String(outcome.value)).toContain('cancelled');
  });

  it('rejects when the enabled gate blocks the run', async () => {
    const { createStore } = await import('effector');
    const fx = createEffect(async (n: number) => n);
    const query = createQuery({ effect: fx, enabled: createStore(false) });
    const scope = fork();

    const outcome = (await allSettled(query.startAsync, { scope, params: 1 })) as unknown as {
      status: string;
      value: unknown;
    };
    expect(outcome.status).toBe('fail');
    expect(String(outcome.value)).toContain('disabled');
  });

  it('mutateAsync is the mutation alias', async () => {
    const fx = createEffect(async (text: string) => ({ ok: true, text }));
    const mutation = createMutation({ effect: fx });
    const scope = fork();

    const outcome = await allSettled(mutation.mutateAsync, { scope, params: 'save' });
    expect(outcome).toEqual({ status: 'done', value: { ok: true, text: 'save' } });
  });

  it('serves cache hits too (finished.done fires for them)', async () => {
    let calls = 0;
    const fx = createEffect(async (n: number) => {
      calls++;
      return `v${n}`;
    });
    const query = createQuery({ effect: fx, cache: true });
    const scope = fork();

    await allSettled(query.startAsync, { scope, params: 1 });
    const second = await allSettled(query.startAsync, { scope, params: 1 });
    expect(second).toEqual({ status: 'done', value: 'v1' });
    expect(calls).toBe(1); // second call resolved from the cache
  });
});

describe('finished.fail with retries (regression)', () => {
  it('fires exactly once — with the final error, not the intermediate ones', async () => {
    const { createWatch } = await import('effector');
    let calls = 0;
    const fx = createEffect(async (_: number) => {
      calls++;
      throw new Error(`boom${calls}`);
    });
    const query = createQuery({ effect: fx, retry: 2 });
    const scope = fork();
    const fails: string[] = [];
    createWatch({
      unit: query.finished.fail,
      scope,
      fn: ({ error }) => fails.push((error as Error).message),
    });

    await allSettled(query.start, { scope, params: 1 });

    expect(calls).toBe(3);
    // before the atomic fail-verdict, the second-to-last attempt double-fired
    // finished.fail with its intermediate error (boom2 here)
    expect(fails).toEqual(['boom3']);
  });
});
