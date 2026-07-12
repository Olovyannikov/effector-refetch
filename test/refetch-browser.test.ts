// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { createQuery, refetchOnReconnect, refetchOnWindowFocus } from '../src';

describe('refetchOnWindowFocus / refetchOnReconnect (no-scope)', () => {
  const teardowns: Array<() => void> = [];
  afterEach(() => {
    teardowns.splice(0).forEach((t) => t());
  });

  it('refetches on window focus once the query has run', async () => {
    let calls = 0;
    const fx = createEffect(async (id: number) => {
      calls++;
      return id;
    });
    const query = createQuery({ effect: fx });
    teardowns.push(refetchOnWindowFocus(query));

    // before any run, focus does nothing
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(calls).toBe(0);

    query.start(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);

    window.dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
  });

  it('refetches when coming back online', async () => {
    let calls = 0;
    const fx = createEffect(async (id: number) => {
      calls++;
      return id;
    });
    const query = createQuery({ effect: fx });
    teardowns.push(refetchOnReconnect(query));

    query.start(5);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);

    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
  });

  it('fires the refetch into the provided scope (fork-correct)', async () => {
    let calls = 0;
    const fx = createEffect(async (id: number) => {
      calls++;
      return id;
    });
    const query = createQuery({ effect: fx });
    const scope = fork();
    teardowns.push(refetchOnWindowFocus(query, scope));

    // run the query in the scope (never globally)
    await allSettled(query.start, { scope, params: 7 });
    expect(calls).toBe(1);
    expect(scope.getState(query.$params)).toBe(7);

    // focus fires the trigger into the scope -> refetch with the scoped last params
    window.dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
    expect(scope.getState(query.$status)).toBe('done');
    expect(query.$status.getState()).toBe('initial'); // global store untouched
  });

  it('re-subscribing does not grow the effector graph (wiring is one per query+event)', () => {
    const query = createQuery({ effect: createEffect(async (id: number) => id) });
    // the wiring is created lazily on the first subscribe — measure after one full cycle
    refetchOnWindowFocus(query)();
    const links = () =>
      (query.$params as unknown as { graphite: { family: { links: unknown[] } } }).graphite.family.links
        .length;
    const before = links();
    for (let i = 0; i < 5; i++) refetchOnWindowFocus(query)();
    expect(links()).toBe(before);
  });

  it('refetches exactly once after unsubscribe/resubscribe cycles', async () => {
    let calls = 0;
    const query = createQuery({
      effect: createEffect(async (id: number) => {
        calls++;
        return id;
      }),
    });
    for (let i = 0; i < 3; i++) refetchOnWindowFocus(query)(); // subscribe + immediately unsubscribe
    teardowns.push(refetchOnWindowFocus(query));

    query.start(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);

    window.dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2); // one active listener -> one refetch
  });

  it('unsubscribe stops listening', async () => {
    let calls = 0;
    const query = createQuery({
      effect: createEffect(async (id: number) => {
        calls++;
        return id;
      }),
    });
    const stop = refetchOnWindowFocus(query);
    query.start(1);
    await new Promise((r) => setTimeout(r, 0));
    stop();
    window.dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
  });
});
