// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { createQuery, createNetworkBarrier } from '../src';

const goOffline = () => window.dispatchEvent(new Event('offline'));
const goOnline = () => window.dispatchEvent(new Event('online'));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('createNetworkBarrier', () => {
  it('pauses runs while offline and resumes on reconnect', async () => {
    const net = createNetworkBarrier();
    expect(net.$online.getState()).toBe(true);

    let calls = 0;
    const fx = createEffect(async (id: number) => {
      calls++;
      return `v${id}`;
    });
    const query = createQuery({ effect: fx, barrier: net });

    // offline -> start -> the run is gated (effect body never entered yet)
    goOffline();
    expect(net.$online.getState()).toBe(false);
    query.start(1);
    await tick(10);
    expect(calls).toBe(0);
    expect(query.$status.getState()).toBe('pending');
    expect(query.$data.getState()).toBe(null);

    // reconnect -> the gated run proceeds
    goOnline();
    for (let i = 0; i < 40 && query.$status.getState() !== 'done'; i++) await tick();
    expect(calls).toBe(1);
    expect(query.$data.getState()).toBe('v1');

    net.stop();
  });

  it('starts locked when navigator is already offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      const net = createNetworkBarrier();
      expect(net.$online.getState()).toBe(false);
      net.stop();
    } finally {
      // remove the instance override so navigator.onLine falls back to the default
      delete (navigator as { onLine?: boolean }).onLine;
    }
  });

  it('stop() detaches the listeners', async () => {
    const net = createNetworkBarrier();
    net.stop();
    goOffline();
    await tick();
    expect(net.$online.getState()).toBe(true); // ignored after stop
  });

  it('with a scope: the DOM listeners lock/unlock inside it', async () => {
    const scope = fork();
    const net = createNetworkBarrier({ scope });

    let calls = 0;
    const fx = createEffect(async (id: number) => {
      calls++;
      return `v${id}`;
    });
    const query = createQuery({ effect: fx, barrier: net });

    goOffline();
    await tick();
    expect(scope.getState(net.$online)).toBe(false);

    const run = allSettled(query.start, { scope, params: 1 });
    await tick(10);
    expect(calls).toBe(0); // gated inside the scope
    expect(scope.getState(query.$pending)).toBe(true);

    goOnline();
    await run;
    expect(calls).toBe(1);
    expect(scope.getState(query.$data)).toBe('v1');

    net.stop();
  });
});
