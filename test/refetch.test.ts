import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createEvent, createStore, fork } from 'effector';
import { createQuery } from '../src';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('refetchInterval (polling)', () => {
  it('refetches on an interval, and reset stops it', async () => {
    let calls = 0;
    const fx = createEffect(async (p: number) => {
      calls++;
      return p;
    });
    const query = createQuery({ effect: fx, refetchInterval: 30 });
    const scope = fork();

    // a polling query never "settles", so don't await start — let it run
    const started = allSettled(query.start, { scope, params: 1 });
    await wait(120); // initial + several polls
    expect(calls).toBeGreaterThanOrEqual(2);

    await allSettled(query.reset, { scope }); // stop polling
    await started; // resolves once the pending poll is invalidated
    const after = calls;
    await wait(80);
    expect(calls).toBe(after); // no further polls
  });

  it('pauses while disabled and resumes when re-enabled', async () => {
    let calls = 0;
    const fx = createEffect(async () => {
      calls++;
      return 1;
    });
    const setEnabled = createEvent<boolean>();
    const $enabled = createStore(true).on(setEnabled, (_s, v) => v);
    const query = createQuery({ effect: fx, refetchInterval: 30, enabled: $enabled });

    const scope = fork();
    const started = allSettled(query.start, { scope });
    await wait(100);
    expect(calls).toBeGreaterThanOrEqual(2);

    // disable -> polling pauses
    await allSettled(setEnabled, { scope, params: false });
    await wait(80);
    const paused = calls;
    await wait(80);
    expect(calls).toBe(paused); // no polls while disabled

    // re-enable -> polling resumes without a fresh start.
    // Don't await: like start, a resumed polling loop never settles until reset.
    const resumed = allSettled(setEnabled, { scope, params: true });
    await wait(100);
    expect(calls).toBeGreaterThan(paused);

    await allSettled(query.reset, { scope });
    await Promise.all([started, resumed]);
  });

  it('does not poll when interval is 0 (default)', async () => {
    let calls = 0;
    const fx = createEffect(async () => {
      calls++;
      return 1;
    });
    const query = createQuery({ effect: fx });
    const scope = fork();
    await allSettled(query.start, { scope });
    await wait(60);
    expect(calls).toBe(1);
  });

  it('polling is isolated per scope', async () => {
    let calls = 0;
    const fx = createEffect(async () => {
      calls++;
      return 1;
    });
    const query = createQuery({ effect: fx, refetchInterval: 30 });

    const a = fork();
    const startedA = allSettled(query.start, { scope: a });
    await wait(100);
    const polled = calls;
    expect(polled).toBeGreaterThanOrEqual(2);

    // a fresh scope that never started should not poll
    fork();
    await wait(60);
    expect(calls).toBeGreaterThanOrEqual(polled + 1); // only scope a keeps polling

    await allSettled(query.reset, { scope: a });
    await startedA;
  });
});
