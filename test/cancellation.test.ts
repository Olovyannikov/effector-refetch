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

describe('abort reason rides on the signal (reatom-inspired)', () => {
  it('cancel: signal.reason is an AbortError with message "cancelled"', async () => {
    const { fx, signals } = abortableEffect();
    const query = createQuery({ effect: fx });
    const scope = fork();

    const p = allSettled(query.start, { scope, params: 1 });
    await allSettled(query.cancel, { scope });
    await p;

    const reason = signals[0].reason as DOMException;
    expect(reason.name).toBe('AbortError'); // fetch/undici treat it as a plain abort
    expect(reason.message).toBe('cancelled');
  });

  it('TAKE_LATEST supersede: signal.reason says "superseded"', async () => {
    const { fx, signals } = abortableEffect();
    const query = createQuery({ effect: fx, concurrency: 'TAKE_LATEST' });
    const scope = fork();

    const p1 = allSettled(query.start, { scope, params: 1 });
    const p2 = allSettled(query.start, { scope, params: 2 });

    expect((signals[0].reason as DOMException).message).toBe('superseded');

    await allSettled(query.cancel, { scope });
    await Promise.all([p1, p2]);
  });

  it('timeout: signal.reason says "timeout"', async () => {
    const { fx, signals } = abortableEffect();
    const query = createQuery({ effect: fx, timeout: 10 });
    const scope = fork();

    await allSettled(query.start, { scope, params: 1 });

    expect(signals[0].aborted).toBe(true);
    expect((signals[0].reason as DOMException).message).toBe('timeout');
    expect(scope.getState(query.$status)).toBe('fail');
  });
});

describe('cancel restores the last SETTLED status (reatom-inspired, #57)', () => {
  it('cancelling a refetch after a FAILURE with stale data stays "fail", not "done"', async () => {
    let mode: 'ok' | 'fail' | 'hang' = 'ok';
    const gates: Array<() => void> = [];
    const fx = createEffect((n: number) => {
      if (mode === 'ok') return Promise.resolve(`v${n}`);
      if (mode === 'fail') return Promise.reject(new Error('boom'));
      return new Promise<string>((_res, rej) => gates.push(() => rej(new Error('aborted'))));
    });
    const query = createQuery({ effect: fx });
    const scope = fork();

    await allSettled(query.start, { scope, params: 1 }); // done, stale data present
    mode = 'fail';
    await allSettled(query.start, { scope, params: 2 }); // fail (data from step 1 kept)
    expect(scope.getState(query.$status)).toBe('fail');
    expect(scope.getState(query.$data)).toBe('v1');

    mode = 'hang';
    const p = allSettled(query.start, { scope, params: 3 }); // pending over stale data
    const pc = allSettled(query.cancel, { scope }); // not awaited yet: the zombie holds the scope
    gates[0]();
    await Promise.all([p, pc]);

    // before the fix: data != null -> 'done', hiding the failure
    expect(scope.getState(query.$status)).toBe('fail');
  });

  it('cancelling the very first run still settles to "initial"', async () => {
    const { fx } = abortableEffect();
    const query = createQuery({ effect: fx });
    const scope = fork();

    const p = allSettled(query.start, { scope, params: 1 });
    await allSettled(query.cancel, { scope });
    await p;

    expect(scope.getState(query.$status)).toBe('initial');
  });

  it('cancelling a refetch after a success stays "done"', async () => {
    let hang = false;
    const gates: Array<() => void> = [];
    const fx = createEffect((n: number) =>
      hang
        ? new Promise<string>((_res, rej) => gates.push(() => rej(new Error('x'))))
        : Promise.resolve(`v${n}`),
    );
    const query = createQuery({ effect: fx });
    const scope = fork();

    await allSettled(query.start, { scope, params: 1 });
    hang = true;
    const p = allSettled(query.refresh, { scope, params: 1 });
    const pc = allSettled(query.cancel, { scope }); // not awaited yet: the zombie holds the scope
    gates[0]();
    await Promise.all([p, pc]);

    expect(scope.getState(query.$status)).toBe('done');
    expect(scope.getState(query.$data)).toBe('v1');
  });
});
