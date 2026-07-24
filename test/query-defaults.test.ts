import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { $queryDefaults, createQuery, createRequestFx, setQueryDefaults } from '../src';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('$queryDefaults', () => {
  it('retry: a query without explicit retry uses the default count', async () => {
    let calls = 0;
    const fx = createEffect(async (_: number) => {
      calls++;
      throw new Error('boom');
    });
    const query = createQuery({ effect: fx });
    const scope = fork({ values: [[$queryDefaults, { retry: 2 }]] });

    await allSettled(query.start, { scope, params: 1 });
    expect(calls).toBe(3); // initial + 2 retries
    expect(scope.getState(query.$status)).toBe('fail');
  });

  it('retry: explicit per-query retry wins over the default', async () => {
    let calls = 0;
    const fx = createEffect(async (_: number) => {
      calls++;
      throw new Error('boom');
    });
    const query = createQuery({ effect: fx, retry: 1 });
    const scope = fork({ values: [[$queryDefaults, { retry: 5 }]] });

    await allSettled(query.start, { scope, params: 1 });
    expect(calls).toBe(2); // initial + 1 explicit retry
  });

  it('concurrency: default strategy applies only to queries that did not pick one', async () => {
    function abortable() {
      const signals: AbortSignal[] = [];
      const fx = createRequestFx<number, string>(
        (_p, { signal }) =>
          new Promise<string>((_res, rej) => {
            signals.push(signal);
            signal.addEventListener('abort', () => rej(new Error('aborted')));
          }),
      );
      return { fx, signals };
    }
    const a = abortable();
    const b = abortable();
    const plain = createQuery({ effect: a.fx }); // no strategy -> default applies
    const pinned = createQuery({ effect: b.fx, concurrency: 'TAKE_LATEST' }); // explicit wins
    const scope = fork({ values: [[$queryDefaults, { concurrency: 'TAKE_EVERY' }]] });

    const p1 = allSettled(plain.start, { scope, params: 1 });
    const p2 = allSettled(plain.start, { scope, params: 2 });
    expect(a.signals[0].aborted).toBe(false); // TAKE_EVERY from defaults: no supersede

    const p3 = allSettled(pinned.start, { scope, params: 1 });
    const p4 = allSettled(pinned.start, { scope, params: 2 });
    expect(b.signals[0].aborted).toBe(true); // explicit TAKE_LATEST still supersedes

    // fire both cancels before awaiting: allSettled waits for the WHOLE scope to
    // go idle, so awaiting one cancel while the other query still runs deadlocks
    const c1 = allSettled(plain.cancel, { scope });
    const c2 = allSettled(pinned.cancel, { scope });
    await Promise.all([c1, c2, p1, p2, p3, p4]);
  });

  it('timeout: default deadline fails a slow run; explicit 0 disables it', async () => {
    const slowFx = createEffect((_: number) => new Promise<string>((res) => setTimeout(() => res('ok'), 50)));
    const withDefault = createQuery({ effect: slowFx });
    const optedOut = createQuery({ effect: slowFx, timeout: 0 });
    const scope = fork({ values: [[$queryDefaults, { timeout: 10 }]] });

    await allSettled(withDefault.start, { scope, params: 1 });
    expect(scope.getState(withDefault.$status)).toBe('fail'); // hit the 10ms default deadline

    await allSettled(optedOut.start, { scope, params: 1 });
    expect(scope.getState(optedOut.$status)).toBe('done'); // explicit 0 = off overrides
  });

  it('staleAfter: default freshness window applies to cached queries without one', async () => {
    let calls = 0;
    const fx = createEffect(async (n: number) => {
      calls++;
      return `v${n}-${calls}`;
    });
    const query = createQuery({ effect: fx, cache: true }); // no staleAfter
    const scope = fork({ values: [[$queryDefaults, { staleAfter: 60_000 }]] });

    await allSettled(query.start, { scope, params: 1 });
    await allSettled(query.start, { scope, params: 1 }); // fresh within default window
    expect(calls).toBe(1);
  });

  it('scopes are isolated: each fork sees its own defaults', async () => {
    let calls = 0;
    const fx = createEffect(async (_: number) => {
      calls++;
      throw new Error('boom');
    });
    const query = createQuery({ effect: fx });
    const retrying = fork({ values: [[$queryDefaults, { retry: 1 }]] });
    const bare = fork();

    await allSettled(query.start, { scope: retrying, params: 1 });
    expect(calls).toBe(2);
    await allSettled(query.start, { scope: bare, params: 1 });
    expect(calls).toBe(3); // no retries in the scope without defaults
  });

  it('setQueryDefaults merges patches', async () => {
    const scope = fork();
    await allSettled(setQueryDefaults, { scope, params: { retry: 2 } });
    await allSettled(setQueryDefaults, { scope, params: { timeout: 5_000 } });
    expect(scope.getState($queryDefaults)).toEqual({ retry: 2, timeout: 5_000 });
    await tick();
  });
});
