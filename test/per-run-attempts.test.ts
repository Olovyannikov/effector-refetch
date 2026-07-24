import { describe, it, expect } from 'vitest';
import { allSettled, fork } from 'effector';
import { createQuery, createMutation } from '../src';
import { deferredEffect } from './support/harness';

// two macrotasks: the failure lands in a microtask first, THEN the 0ms retry
// sleep is scheduled — a single setTimeout(0) would fire before it
const tick = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

describe('per-run retry budgets (audit #45 regression)', () => {
  it("a new concurrent run does not reset another run's retry count (TAKE_EVERY)", async () => {
    const d = deferredEffect<string, string>();
    const query = createQuery({ effect: d.fx, retry: 1, concurrency: 'TAKE_EVERY' });
    const scope = fork();

    const pA = allSettled(query.start, { scope, params: 'A' });
    // B starts while A is in flight — with the old shared $attempts store, B's tag
    // reset the counter to 0 and A would have retried beyond its budget
    const pB = allSettled(query.start, { scope, params: 'B' });
    expect(d.started).toEqual(['A', 'B']);

    d.reject(0); // A attempt 1 fails -> exactly one retry allowed
    await tick(); // retry sleep (0ms) elapses
    expect(d.started).toEqual(['A', 'B', 'A']);

    d.reject(2); // A retry fails -> budget exhausted, FINAL
    d.resolve(1, 'b-ok'); // B settles fine
    await Promise.all([pA, pB]);

    expect(d.started).toEqual(['A', 'B', 'A']); // no third A attempt
    expect(scope.getState(query.$data)).toBe('b-ok'); // B's settle (last) won the store
  });

  it('per-lane retries are independent under lane keys', async () => {
    const d = deferredEffect<{ lane: string }, string>();
    const query = createQuery({
      effect: d.fx,
      retry: 2,
      concurrency: { strategy: 'TAKE_LATEST', key: ({ lane }) => lane },
    });
    const scope = fork();

    const pA = allSettled(query.start, { scope, params: { lane: 'a' } });
    const pB = allSettled(query.start, { scope, params: { lane: 'b' } });

    d.reject(0); // lane a, attempt 1
    await tick();
    d.reject(1); // lane b, attempt 1
    await tick();
    // each lane retried once so far, independently
    const lanesStarted = d.started.map((p) => p.lane);
    expect(lanesStarted).toEqual(['a', 'b', 'a', 'b']);

    d.resolveAll('done');
    await Promise.all([pA, pB]);
  });

  it('mutations (TAKE_EVERY default) retry each write independently', async () => {
    const d = deferredEffect<number, string>();
    const mutation = createMutation({ effect: d.fx, retry: 1 });
    const scope = fork();

    const p1 = allSettled(mutation.mutate, { scope, params: 1 });
    const p2 = allSettled(mutation.mutate, { scope, params: 2 });

    d.reject(0); // write 1 fails -> its own retry
    d.reject(1); // write 2 fails -> its own retry
    await tick();
    expect(d.started).toEqual([1, 2, 1, 2]);

    d.reject(2); // write 1 retry fails -> final (budget 1)
    d.reject(3); // write 2 retry fails -> final
    await Promise.all([p1, p2]);
    expect(d.started).toEqual([1, 2, 1, 2]); // no over-budget attempts
  });
});
