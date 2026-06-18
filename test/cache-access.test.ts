import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { createQuery, createQueryFactory, getQueryData, setQueryData } from '../src';

describe('getQueryData / setQueryData', () => {
  it('reads and writes $data imperatively (no-scope)', async () => {
    const query = createQuery({ effect: createEffect(async (): Promise<number[]> => [1, 2]) });
    expect(getQueryData(query)).toBeNull();

    query.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(getQueryData(query)).toEqual([1, 2]);

    setQueryData(query, (prev) => [...(prev ?? []), 3]);
    expect(getQueryData(query)).toEqual([1, 2, 3]);

    setQueryData(query, [9]);
    expect(getQueryData(query)).toEqual([9]);
  });

  it('updater form is scope-correct via __.updateData (reads scoped prev, no getState)', async () => {
    const query = createQuery({ effect: createEffect(async (): Promise<number[]> => [1]) });
    const scope = fork();
    await allSettled(query.start, { scope }); // scope.$data = [1]
    expect(scope.getState(query.$data)).toEqual([1]);

    // run the updater inside the scope: the reducer reads the *scoped* prev ([1])
    await allSettled(query.__.updateData, { scope, params: (prev) => [...(prev ?? []), 2] });

    expect(scope.getState(query.$data)).toEqual([1, 2]);
    expect(query.$data.getState()).toBeNull(); // global store untouched
  });
});

describe('factory group invalidation', () => {
  it('refetches all ran queries; predicate narrows; scope-correct', async () => {
    let a = 0;
    let b = 0;
    const { createQuery: cq, invalidate, queries } = createQueryFactory();
    const qa = cq({
      effect: createEffect(async () => {
        a++;
        return a;
      }),
    });
    const qb = cq({
      effect: createEffect(async () => {
        b++;
        return b;
      }),
    });

    expect(queries.length).toBe(2);

    const scope = fork();
    await allSettled(qa.start, { scope });
    await allSettled(qb.start, { scope });
    expect([a, b]).toEqual([1, 1]);

    // invalidate all that have run
    await allSettled(invalidate, { scope, params: {} });
    expect([a, b]).toEqual([2, 2]);

    // predicate: only qa
    await allSettled(invalidate, { scope, params: { predicate: (q) => q === qa } });
    expect([a, b]).toEqual([3, 2]);
  });

  it('skips queries that never ran', async () => {
    let calls = 0;
    const { createQuery: cq, invalidate } = createQueryFactory();
    const q = cq({
      effect: createEffect(async () => {
        calls++;
        return 1;
      }),
    });
    const scope = fork();
    await allSettled(invalidate, { scope, params: {} }); // q never started
    expect(calls).toBe(0);
    expect(scope.getState(q.$status)).toBe('initial');
  });
});
