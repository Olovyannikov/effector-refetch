import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createWatch, fork } from 'effector';
import { connectQuery, createQuery, invalidate, createMutation } from '../src';

describe('throwing user callbacks are contained (audit #46)', () => {
  it('mapParams throw -> finished.fail, not a dead propagation', async () => {
    const fx = createEffect(async (n: number) => n);
    const query = createQuery({
      effect: fx,
      mapParams: () => {
        throw new Error('bad mapParams');
      },
    });
    const scope = fork();
    const fails: string[] = [];
    createWatch({
      unit: query.finished.fail,
      scope,
      fn: ({ error }) => fails.push((error as Error).message),
    });

    await allSettled(query.start, { scope, params: 1 });

    expect(scope.getState(query.$status)).toBe('fail');
    expect(fails).toEqual(['bad mapParams']);
  });

  it('mapParams throw rejects startAsync (no hang)', async () => {
    const fx = createEffect(async (n: number) => n);
    const query = createQuery({
      effect: fx,
      mapParams: () => {
        throw new Error('bad mapParams');
      },
    });
    const scope = fork();
    const outcome = (await allSettled(query.startAsync, { scope, params: 1 })) as unknown as {
      status: string;
      value: Error;
    };
    expect(outcome.status).toBe('fail');
    expect(outcome.value.message).toBe('bad mapParams');
  });

  it('mapData throw -> final failure with the thrown error; $data untouched', async () => {
    const fx = createEffect(async (n: number) => n);
    const query = createQuery({
      effect: fx,
      initialData: 'initial',
      mapData: () => {
        throw new Error('bad mapData');
      },
    });
    const scope = fork();

    await allSettled(query.start, { scope, params: 1 });

    expect(scope.getState(query.$status)).toBe('fail');
    expect((scope.getState(query.$error) as Error).message).toBe('bad mapData');
    expect(scope.getState(query.$data)).toBe('initial');
  });

  it('$data and finished.done carry the SAME mapped object (identity regression)', async () => {
    const fx = createEffect(async (n: number) => ({ n }));
    const query = createQuery({ effect: fx, mapData: ({ result }) => ({ wrapped: result.n }) });
    const scope = fork();
    const seen: unknown[] = [];
    createWatch({ unit: query.finished.done, scope, fn: ({ result }) => seen.push(result) });

    await allSettled(query.start, { scope, params: 1 });

    expect(seen[0]).toBe(scope.getState(query.$data)); // identity, not just equality
  });

  it('mapError throw -> the raw error survives', async () => {
    const fx = createEffect(async (): Promise<number> => {
      throw new Error('original');
    });
    const query = createQuery({
      effect: fx,
      mapError: () => {
        throw new Error('bad mapError');
      },
    });
    const scope = fork();

    await allSettled(query.start, { scope, params: undefined });

    expect(scope.getState(query.$status)).toBe('fail');
    expect((scope.getState(query.$error) as Error).message).toBe('original');
  });

  it('fallback throw -> plain final failure with the original request error', async () => {
    const fx = createEffect(async (): Promise<string> => {
      throw new Error('request failed');
    });
    const query = createQuery({
      effect: fx,
      fallback: () => {
        throw new Error('bad fallback');
      },
    });
    const scope = fork();

    await allSettled(query.start, { scope, params: undefined });

    expect(scope.getState(query.$status)).toBe('fail');
    expect((scope.getState(query.$error) as Error).message).toBe('request failed');
  });

  it('validate throw -> retryable validation failure', async () => {
    let calls = 0;
    const fx = createEffect(async () => {
      calls++;
      return 'data';
    });
    const query = createQuery({
      effect: fx,
      retry: 1,
      validate: () => {
        throw new Error('bad validate');
      },
    });
    const scope = fork();

    await allSettled(query.start, { scope, params: undefined });

    expect(calls).toBe(2); // the thrown validate counted as a retryable failure
    expect(scope.getState(query.$status)).toBe('fail');
  });

  it('lane key throw -> degrades to the single lane, the run still completes', async () => {
    const fx = createEffect(async (n: number) => `v${n}`);
    const query = createQuery({
      effect: fx,
      concurrency: {
        strategy: 'TAKE_LATEST',
        key: () => {
          throw new Error('bad key');
        },
      },
    });
    const scope = fork();

    await allSettled(query.start, { scope, params: 1 });
    expect(scope.getState(query.$data)).toBe('v1');
    expect(scope.getState(query.$status)).toBe('done');
  });

  it('connectQuery fn throw -> the source query is unaffected, the target just never starts', async () => {
    const sourceFx = createEffect(async (n: number) => n);
    const targetFx = createEffect(async (n: number) => n);
    const sourceQuery = createQuery({ effect: sourceFx });
    const targetQuery = createQuery({ effect: targetFx });
    connectQuery({
      source: sourceQuery,
      fn: () => {
        throw new Error('bad connect');
      },
      target: targetQuery,
    });
    const scope = fork();

    await allSettled(sourceQuery.start, { scope, params: 1 });

    expect(scope.getState(sourceQuery.$status)).toBe('done'); // source settled fine
    expect(scope.getState(sourceQuery.$data)).toBe(1);
    expect(scope.getState(targetQuery.$status)).toBe('initial'); // target dropped
  });

  it('invalidate predicate throw -> treated as false, trigger propagation survives', async () => {
    const fx = createEffect(async (n: number) => n);
    const query = createQuery({ effect: fx });
    const writeFx = createEffect(async (s: string) => s);
    const mutation = createMutation({ effect: writeFx });
    invalidate({
      on: mutation,
      refetch: query,
      filter: () => {
        throw new Error('bad predicate');
      },
    });
    const scope = fork();

    await allSettled(query.start, { scope, params: 1 });
    await allSettled(mutation.mutate, { scope, params: 'w' });

    expect(scope.getState(mutation.$status)).toBe('done'); // mutation unharmed
    expect(scope.getState(query.$params)).toBe(1); // no refetch storm, no crash
  });
});
