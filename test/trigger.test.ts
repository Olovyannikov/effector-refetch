import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createEvent, createStore, fork } from 'effector';
import { createQuery, createMutation, keepFresh, isTrigger } from '../src';

describe('@@trigger protocol', () => {
  it('a query implements @@trigger (fired = finished.done)', async () => {
    const fx = createEffect(async (id: number) => `user-${id}`);
    const query = createQuery({ effect: fx });

    expect(isTrigger(query)).toBe(true);
    const trig = query['@@trigger']();
    expect(typeof trig.setup).toBe('function');
    expect(typeof trig.teardown).toBe('function');

    const $fires = createStore(0).on(trig.fired, (n) => n + 1);

    const scope = fork();
    await allSettled(query.start, { scope, params: 1 });
    expect(scope.getState($fires)).toBe(1); // fired on success, fork-correct

    await allSettled(query.start, { scope, params: 2 });
    expect(scope.getState($fires)).toBe(2);
  });

  it('returns the same object on every call (memoized)', () => {
    const query = createQuery({ effect: createEffect(async () => 1) });
    expect(query['@@trigger']()).toBe(query['@@trigger']());
  });

  it('a mutation implements @@trigger too', () => {
    const mutation = createMutation({ effect: createEffect(async (x: number) => x) });
    expect(isTrigger(mutation)).toBe(true);
    expect(typeof mutation['@@trigger']().fired).toBe('function'); // an effector Event is callable
  });

  it('keepFresh({ triggers }) refetches when a mutation succeeds', async () => {
    let runs = 0;
    const getFx = createEffect(async (id: number) => {
      runs++;
      return `value-${runs}-for-${id}`;
    });
    const query = createQuery({ effect: getFx });
    const saveFx = createEffect(async (x: number) => x);
    const mutation = createMutation({ effect: saveFx });

    keepFresh(query, { triggers: [mutation] });

    const scope = fork();
    await allSettled(query.start, { scope, params: 7 });
    expect(runs).toBe(1);

    await allSettled(mutation.start, { scope, params: 99 });
    expect(runs).toBe(2); // the mutation's success refetched the query
    expect(scope.getState(query.$params)).toBe(7); // …with its last params
  });

  it('keepFresh({ triggers }) accepts a plain effector Event', async () => {
    let runs = 0;
    const getFx = createEffect(async (id: number) => {
      runs++;
      return `${id}:${runs}`;
    });
    const query = createQuery({ effect: getFx });
    const ping = createEvent();

    keepFresh(query, { triggers: [ping] });

    const scope = fork();
    await allSettled(query.start, { scope, params: 1 });
    expect(runs).toBe(1);

    await allSettled(ping, { scope, params: undefined });
    expect(runs).toBe(2);
  });

  it('keepFresh consumes an external @@trigger object (e.g. @withease/web-api)', async () => {
    // shape of a withease tracker: a plain object implementing @@trigger
    const fired = createEvent<void>(); // stands in for trackPageVisibility().visible
    const setup = createEvent<void>();
    const teardown = createEvent<void>();
    let setupCalls = 0;
    setup.watch(() => setupCalls++);
    const tracker = { '@@trigger': () => ({ fired, setup, teardown }) };

    let runs = 0;
    const getFx = createEffect(async (id: number) => {
      runs++;
      return id;
    });
    const query = createQuery({ effect: getFx });
    keepFresh(query, { triggers: [tracker] });
    expect(setupCalls).toBeGreaterThan(0); // keepFresh activates the trigger on wiring

    const scope = fork();
    await allSettled(query.start, { scope, params: 1 });
    expect(runs).toBe(1);

    await allSettled(fired, { scope, params: undefined });
    expect(runs).toBe(2); // tracker fired -> refetch with last params
  });

  it('a trigger is a no-op before the query has run', async () => {
    let runs = 0;
    const getFx = createEffect(async () => {
      runs++;
      return runs;
    });
    const query = createQuery({ effect: getFx });
    const ping = createEvent();
    keepFresh(query, { triggers: [ping] });

    const scope = fork();
    await allSettled(ping, { scope, params: undefined }); // never started -> nothing to refetch
    expect(runs).toBe(0);
  });
});
