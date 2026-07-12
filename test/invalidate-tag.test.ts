import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { $queryCache, createQuery, inMemoryCache, invalidateTag, dehydrate } from '../src';

describe('invalidateTag', () => {
  it('refetches tagged queries with their last params, leaves untagged ones alone', async () => {
    let todos = 0;
    let users = 0;
    const todosQuery = createQuery({
      effect: createEffect(async (list: string) => {
        todos++;
        return `${list}:${todos}`;
      }),
      tags: ['todos'],
    });
    const usersQuery = createQuery({
      effect: createEffect(async () => {
        users++;
        return users;
      }),
    });

    const scope = fork();
    await allSettled(todosQuery.start, { scope, params: 'inbox' });
    await allSettled(usersQuery.start, { scope });
    expect(todos).toBe(1);
    expect(users).toBe(1);

    await allSettled(invalidateTag, { scope, params: 'todos' });
    expect(todos).toBe(2); // refetched with last params
    expect(scope.getState(todosQuery.$data)).toBe('inbox:2');
    expect(users).toBe(1); // untagged: untouched
  });

  it('matches any tag from an array payload and any of the query tags', async () => {
    let calls = 0;
    const q = createQuery({
      effect: createEffect(async () => ++calls),
      tags: ['todos', 'lists'],
    });
    const scope = fork();
    await allSettled(q.start, { scope });
    expect(calls).toBe(1);

    await allSettled(invalidateTag, { scope, params: ['users', 'lists'] }); // 'lists' matches
    expect(calls).toBe(2);

    await allSettled(invalidateTag, { scope, params: 'unrelated' });
    expect(calls).toBe(2);
  });

  it('does not refetch a query that never ran, but purges its cache (prefetch warm-up)', async () => {
    let calls = 0;
    const q = createQuery({
      effect: createEffect(async (id: number) => {
        calls++;
        return id;
      }),
      cache: true,
      tags: ['todos'],
      name: 'warm',
    });
    const cache = inMemoryCache();
    const scope = fork({ values: [[$queryCache, cache]] });

    await allSettled(q.prefetch, { scope, params: 1 }); // warms the cache, $status stays 'initial'
    expect(calls).toBe(1);
    expect(dehydrate(cache)).toHaveLength(1);
    expect(scope.getState(q.$status)).toBe('initial');

    await allSettled(invalidateTag, { scope, params: 'todos' });
    expect(calls).toBe(1); // never ran -> no refetch
    expect(dehydrate(cache)).toHaveLength(0); // but the warmed entry is gone

    await allSettled(q.start, { scope, params: 1 });
    expect(calls).toBe(2); // cache purged -> a real fetch
  });

  it('is scope-correct: invalidating in one fork does not touch another', async () => {
    let calls = 0;
    const q = createQuery({
      effect: createEffect(async () => ++calls),
      tags: ['todos'],
    });
    const scopeA = fork();
    const scopeB = fork();
    await allSettled(q.start, { scope: scopeA });
    await allSettled(q.start, { scope: scopeB });
    expect(calls).toBe(2);

    await allSettled(invalidateTag, { scope: scopeA, params: 'todos' });
    expect(calls).toBe(3); // only scope A refetched
    expect(scope_state(scopeA)).not.toBe(scope_state(scopeB));

    function scope_state(s: typeof scopeA) {
      return s.getState(q.$data);
    }
  });
});
