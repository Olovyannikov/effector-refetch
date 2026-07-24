import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { createQuery } from '../src';
import { abortableDeferred } from './support/harness';

const abortableEffect = () => abortableDeferred<number, string>();

describe('real cancellation (AbortSignal)', () => {
  it('createRequestFx produces an abort-aware effect', () => {
    const { fx } = abortableEffect();
    expect((fx as unknown as { __abortable: boolean }).__abortable).toBe(true);
  });

  it('cancel aborts the in-flight request signal', async () => {
    const { fx, signals } = abortableEffect();
    const query = createQuery({ effect: fx });
    const scope = fork();

    const p = allSettled(query.start, { scope, params: 1 });
    expect(signals.length).toBe(1);
    expect(signals[0].aborted).toBe(false);

    await allSettled(query.cancel, { scope });
    expect(signals[0].aborted).toBe(true);

    await p;
    expect(scope.getState(query.$status)).not.toBe('done');
    expect(scope.getState(query.$pending)).toBe(false);
  });

  it('TAKE_LATEST aborts the superseded request, keeps the latest active', async () => {
    const { fx, signals } = abortableEffect();
    const query = createQuery({ effect: fx, concurrency: 'TAKE_LATEST' });
    const scope = fork();

    const p1 = allSettled(query.start, { scope, params: 1 });
    const p2 = allSettled(query.start, { scope, params: 2 });

    expect(signals.length).toBe(2);
    expect(signals[0].aborted).toBe(true); // superseded
    expect(signals[1].aborted).toBe(false); // latest still running

    await allSettled(query.cancel, { scope });
    await Promise.all([p1, p2]);
    expect(signals[1].aborted).toBe(true);
  });

  it('cancel on an already-settled query is a no-op (does not flip fail -> done)', async () => {
    let shouldFail = false;
    const fx = createEffect(async (n: number) => {
      if (shouldFail) throw new Error('boom');
      return `v${n}`;
    });
    const query = createQuery({ effect: fx });
    const scope = fork();

    // 1) success -> data present, status done
    await allSettled(query.start, { scope, params: 1 });
    expect(scope.getState(query.$status)).toBe('done');
    expect(scope.getState(query.$data)).toBe('v1');

    // 2) failure -> status fail (stale data from step 1 is still around)
    shouldFail = true;
    await allSettled(query.start, { scope, params: 2 });
    expect(scope.getState(query.$status)).toBe('fail');

    // 3) cancel with nothing in flight must NOT settle to done off the stale data
    await allSettled(query.cancel, { scope });
    expect(scope.getState(query.$status)).toBe('fail');
  });

  it('TAKE_EVERY does not abort earlier requests', async () => {
    const { fx, signals } = abortableEffect();
    const query = createQuery({ effect: fx, concurrency: 'TAKE_EVERY' });
    const scope = fork();

    const p1 = allSettled(query.start, { scope, params: 1 });
    const p2 = allSettled(query.start, { scope, params: 2 });

    expect(signals.length).toBe(2);
    expect(signals[0].aborted).toBe(false);
    expect(signals[1].aborted).toBe(false);

    await allSettled(query.cancel, { scope }); // cancel aborts everything in-flight
    await Promise.all([p1, p2]);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(true);
  });
});
