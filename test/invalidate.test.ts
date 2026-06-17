import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { createMutation, createQuery, invalidate } from '../src';

describe('invalidate', () => {
  it('refetches a query (with last params) when a mutation succeeds', async () => {
    let fetches = 0;
    const listFx = createEffect(async (scopeName: string) => {
      fetches++;
      return { scopeName, n: fetches };
    });
    const todosQuery = createQuery({ effect: listFx });

    const addFx = createEffect(async (text: string) => ({ id: 1, text }));
    const addMutation = createMutation({ effect: addFx });

    invalidate({ on: addMutation, refetch: todosQuery });

    const scope = fork();
    await allSettled(todosQuery.start, { scope, params: 'all' });
    expect(fetches).toBe(1);

    await allSettled(addMutation.mutate, { scope, params: 'new todo' });

    // mutation success -> todosQuery refetched with its last params ('all')
    expect(fetches).toBe(2);
    expect(scope.getState(todosQuery.$data)).toEqual({ scopeName: 'all', n: 2 });
  });

  it('does NOT refetch a query that never ran', async () => {
    let fetches = 0;
    const fx = createEffect(async () => {
      fetches++;
      return fetches;
    });
    const query = createQuery({ effect: fx });
    const mutation = createMutation({ effect: createEffect(async () => 'done') });

    invalidate({ on: mutation, refetch: query });

    const scope = fork();
    await allSettled(mutation.start, { scope });

    expect(scope.getState(query.$status)).toBe('initial');
    expect(fetches).toBe(0);
  });

  it('filter gates invalidation on the trigger payload', async () => {
    let fetches = 0;
    const fx = createEffect(async (q: string) => {
      fetches++;
      return q;
    });
    const query = createQuery({ effect: fx });

    const mFx = createEffect(async (ok: boolean) => ({ ok }));
    const mutation = createMutation({ effect: mFx });

    invalidate({
      on: mutation,
      refetch: query,
      filter: ({ result }) => result.ok === true,
    });

    const scope = fork();
    await allSettled(query.start, { scope, params: 'x' }); // fetches=1
    await allSettled(mutation.mutate, { scope, params: false }); // filtered out
    expect(fetches).toBe(1);
    await allSettled(mutation.mutate, { scope, params: true }); // passes
    expect(fetches).toBe(2);
  });

  it('refetch bypasses cache freshness', async () => {
    let fetches = 0;
    const fx = createEffect(async (q: string) => {
      fetches++;
      return `${q}-${fetches}`;
    });
    const query = createQuery({ effect: fx, cache: true }); // never stale
    const mutation = createMutation({ effect: createEffect(async () => 1) });

    invalidate({ on: mutation, refetch: query });

    const scope = fork();
    await allSettled(query.start, { scope, params: 'a' }); // fetches=1, cached
    await allSettled(query.start, { scope, params: 'a' }); // cache hit, fetches=1
    expect(fetches).toBe(1);

    await allSettled(mutation.start, { scope }); // invalidate -> refetch bypasses cache
    expect(fetches).toBe(2);
    expect(scope.getState(query.$data)).toBe('a-2');
  });

  it('accepts multiple triggers and multiple queries', async () => {
    let aFetch = 0;
    let bFetch = 0;
    const aQuery = createQuery({
      effect: createEffect(async () => {
        aFetch++;
        return aFetch;
      }),
    });
    const bQuery = createQuery({
      effect: createEffect(async () => {
        bFetch++;
        return bFetch;
      }),
    });
    const m1 = createMutation({ effect: createEffect(async () => 1) });
    const m2 = createMutation({ effect: createEffect(async () => 2) });

    invalidate({ on: [m1, m2], refetch: [aQuery, bQuery] });

    const scope = fork();
    await allSettled(aQuery.start, { scope });
    await allSettled(bQuery.start, { scope });
    expect([aFetch, bFetch]).toEqual([1, 1]);

    await allSettled(m1.start, { scope });
    expect([aFetch, bFetch]).toEqual([2, 2]);

    await allSettled(m2.start, { scope });
    expect([aFetch, bFetch]).toEqual([3, 3]);
  });

  it('is a no-op with an empty `on` array (no dead wiring)', async () => {
    let fetches = 0;
    const fx = createEffect(async () => {
      fetches++;
      return fetches;
    });
    const query = createQuery({ effect: fx });

    // empty trigger list: nothing should be wired, and it must not throw
    expect(() => invalidate({ on: [], refetch: query })).not.toThrow();

    const scope = fork();
    await allSettled(query.start, { scope });
    expect(fetches).toBe(1); // still just the initial run
  });
});
