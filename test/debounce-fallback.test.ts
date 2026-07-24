import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createWatch, fork } from 'effector';
import { createQuery, debounce, fallback } from '../src';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('debounce', () => {
  it('rapid starts under TAKE_LATEST run the effect once, with the last params', async () => {
    let calls = 0;
    const seen: string[] = [];
    const fx = createEffect(async (q: string) => {
      calls++;
      seen.push(q);
      return `result:${q}`;
    });
    const query = createQuery({ effect: fx, debounce: 20 });
    const scope = fork();

    const p1 = allSettled(query.start, { scope, params: 'a' });
    const p2 = allSettled(query.start, { scope, params: 'ab' });
    const p3 = allSettled(query.start, { scope, params: 'abc' });
    await Promise.all([p1, p2, p3]);

    expect(calls).toBe(1); // only the last keystroke hit the effect
    expect(seen).toEqual(['abc']);
    expect(scope.getState(query.$data)).toBe('result:abc');
    expect(scope.getState(query.$status)).toBe('done');
  });

  it('cancel during the wait drops the run before the network', async () => {
    let calls = 0;
    const fx = createEffect(async (q: string) => {
      calls++;
      return q;
    });
    const query = createQuery({ effect: fx, debounce: 30 });
    const scope = fork();

    const p = allSettled(query.start, { scope, params: 'a' });
    await allSettled(query.cancel, { scope });
    await p;
    await tick(40); // even after the wait would have elapsed

    expect(calls).toBe(0);
    expect(scope.getState(query.$pending)).toBe(false);
  });

  it('standalone operator form works and 0 disables it', async () => {
    let calls = 0;
    const fx = createEffect(async (q: string) => {
      calls++;
      return q;
    });
    const query = debounce(createQuery({ effect: fx }), 0);
    const scope = fork();
    await allSettled(query.start, { scope, params: 'x' });
    expect(calls).toBe(1);
    expect(scope.getState(query.$data)).toBe('x');
  });
});

describe('fallback', () => {
  it('recovers a final failure into data: status done, finished.done, no finished.fail', async () => {
    const fx = createEffect(async (_: number): Promise<string[]> => {
      throw new Error('boom');
    });
    const query = createQuery({ effect: fx, fallback: [] as string[] });
    const scope = fork();
    const done: unknown[] = [];
    const fail: unknown[] = [];
    createWatch({ unit: query.finished.done, scope, fn: (p) => done.push(p) });
    createWatch({ unit: query.finished.fail, scope, fn: (p) => fail.push(p) });

    await allSettled(query.start, { scope, params: 1 });

    expect(scope.getState(query.$status)).toBe('done');
    expect(scope.getState(query.$data)).toEqual([]);
    expect(scope.getState(query.$error)).toBeNull();
    expect(done).toEqual([{ params: 1, result: [] }]);
    expect(fail).toEqual([]);
  });

  it('function form receives the error and params, applies after retries are exhausted', async () => {
    let calls = 0;
    const fx = createEffect(async (_: number): Promise<string> => {
      calls++;
      throw new Error(`boom${calls}`);
    });
    const query = createQuery({
      effect: fx,
      retry: 2,
      fallback: ({ error, params }) => `recovered:${(error as Error).message}:${params}`,
    });
    const scope = fork();

    await allSettled(query.start, { scope, params: 7 });

    expect(calls).toBe(3); // initial + 2 retries, THEN the fallback
    expect(scope.getState(query.$data)).toBe('recovered:boom3:7');
    expect(scope.getState(query.$status)).toBe('done');
  });

  it('does not apply to aborts: cancel keeps the query un-recovered', async () => {
    const fx = createEffect((_: number) => new Promise<string>((res) => setTimeout(() => res('late'), 50)));
    const query = createQuery({ effect: fx, fallback: 'recovered' });
    const scope = fork();

    const p = allSettled(query.start, { scope, params: 1 });
    await allSettled(query.cancel, { scope });
    await p;

    expect(scope.getState(query.$data)).not.toBe('recovered');
    expect(scope.getState(query.$status)).not.toBe('fail');
  });

  it('the fallback value is not written to the cache', async () => {
    let shouldFail = true;
    let calls = 0;
    const fx = createEffect(async (_: number) => {
      calls++;
      if (shouldFail) throw new Error('boom');
      return 'real';
    });
    const query = createQuery({ effect: fx, cache: true, fallback: 'fb' });
    const scope = fork();

    await allSettled(query.start, { scope, params: 1 });
    expect(scope.getState(query.$data)).toBe('fb');

    // a cached fallback would be served here instead of re-running the effect
    shouldFail = false;
    await allSettled(query.refresh, { scope, params: 1 });
    expect(calls).toBe(2);
    expect(scope.getState(query.$data)).toBe('real');
  });

  it('standalone operator: fallback(query, null) detaches', async () => {
    const fx = createEffect(async (_: number): Promise<string> => {
      throw new Error('boom');
    });
    const query = createQuery({ effect: fx, fallback: 'fb' });
    fallback(query, null);
    const scope = fork();

    await allSettled(query.start, { scope, params: 1 });
    expect(scope.getState(query.$status)).toBe('fail');
  });
});
