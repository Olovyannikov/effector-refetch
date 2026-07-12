import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createEvent, fork, serialize } from 'effector';
import { $queryCache, createQuery, dehydrate, hydrate, inMemoryCache } from '../src';

describe('$queryCache (scope-isolated cache)', () => {
  it('isolates the cache per scope: no cross-scope hits, entries land in own adapters', async () => {
    let calls = 0;
    const fx = createEffect(async (id: number) => {
      calls++;
      return id * 2;
    });
    const query = createQuery({ effect: fx, cache: true, name: 'iso' });

    const cacheA = inMemoryCache();
    const cacheB = inMemoryCache();
    const scopeA = fork({ values: [[$queryCache, cacheA]] });
    const scopeB = fork({ values: [[$queryCache, cacheB]] });

    await allSettled(query.start, { scope: scopeA, params: 1 });
    expect(calls).toBe(1);

    // same params in another scope: its own cache is empty -> fetches again
    await allSettled(query.start, { scope: scopeB, params: 1 });
    expect(calls).toBe(2);

    expect(dehydrate(cacheA)).toHaveLength(1);
    expect(dehydrate(cacheB)).toHaveLength(1);
  });

  it('hits the scope adapter on a repeat start in the same scope', async () => {
    let calls = 0;
    const fx = createEffect(async (id: number) => {
      calls++;
      return id;
    });
    const query = createQuery({ effect: fx, cache: true, name: 'hit' });
    const scope = fork({ values: [[$queryCache, inMemoryCache()]] });

    await allSettled(query.start, { scope, params: 5 });
    await allSettled(query.start, { scope, params: 5 });
    expect(calls).toBe(1);
    expect(scope.getState(query.$data)).toBe(5);
  });

  it('falls back to the per-query adapter when $queryCache is not set', async () => {
    let calls = 0;
    const adapter = inMemoryCache();
    const fx = createEffect(async (id: number) => {
      calls++;
      return id;
    });
    const query = createQuery({ effect: fx, cache: { adapter } });
    const scope = fork();

    await allSettled(query.start, { scope, params: 1 });
    await allSettled(query.start, { scope, params: 1 });
    expect(calls).toBe(1);
    expect(dehydrate(adapter)).toHaveLength(1);
  });

  it('survives a full SSR round-trip: dehydrate on the server, hydrate on the client', async () => {
    let calls = 0;
    const fx = createEffect(async (id: number) => {
      calls++;
      return `todo-${id}`;
    });
    const query = createQuery({ effect: fx, cache: true, name: 'todos' });

    // server
    const serverCache = inMemoryCache();
    const serverScope = fork({ values: [[$queryCache, serverCache]] });
    await allSettled(query.start, { scope: serverScope, params: 7 });
    expect(calls).toBe(1);
    const payload = { cache: dehydrate(serverCache) };

    // client — the documented two-step pattern: fork with serialized values,
    // then point $queryCache at the client adapter (stores are callable)
    const clientCache = inMemoryCache();
    hydrate(clientCache, payload.cache);
    const clientScope = fork();
    await allSettled($queryCache, { scope: clientScope, params: clientCache });
    await allSettled(query.start, { scope: clientScope, params: 7 });
    expect(calls).toBe(1); // served from the hydrated cache
    expect(clientScope.getState(query.$data)).toBe('todo-7');
  });

  it('namespaces keys per query in a shared scope adapter (no collisions)', async () => {
    const userFx = createEffect(async (id: number) => `user-${id}`);
    const postFx = createEffect(async (id: number) => `post-${id}`);
    const userQuery = createQuery({ effect: userFx, cache: true, name: 'user' });
    const postQuery = createQuery({ effect: postFx, cache: true, name: 'post' });

    const cache = inMemoryCache();
    const scope = fork({ values: [[$queryCache, cache]] });

    await allSettled(userQuery.start, { scope, params: 1 });
    await allSettled(postQuery.start, { scope, params: 1 }); // same params, different query

    expect(dehydrate(cache)).toHaveLength(2); // two entries, not one clobbered
    // repeat starts hit their own entries
    expect(scope.getState(userQuery.$data)).toBe('user-1');
    expect(scope.getState(postQuery.$data)).toBe('post-1');
  });

  it('purge clears the scope adapter and leaves other scopes untouched', async () => {
    let calls = 0;
    const purge = createEvent();
    const fx = createEffect(async (id: number) => {
      calls++;
      return id;
    });
    const query = createQuery({ effect: fx, cache: { purge }, name: 'purgeable' });

    const cacheA = inMemoryCache();
    const cacheB = inMemoryCache();
    const scopeA = fork({ values: [[$queryCache, cacheA]] });
    const scopeB = fork({ values: [[$queryCache, cacheB]] });

    await allSettled(query.start, { scope: scopeA, params: 1 });
    await allSettled(query.start, { scope: scopeB, params: 1 });
    expect(calls).toBe(2);

    await allSettled(purge, { scope: scopeA });
    expect(dehydrate(cacheA)).toHaveLength(0);
    expect(dehydrate(cacheB)).toHaveLength(1);

    await allSettled(query.start, { scope: scopeA, params: 1 }); // A purged -> refetch
    expect(calls).toBe(3);
    await allSettled(query.start, { scope: scopeB, params: 1 }); // B untouched -> hit
    expect(calls).toBe(3);
  });

  it('is excluded from serialize(scope)', async () => {
    const fx = createEffect(async (id: number) => id);
    const query = createQuery({ effect: fx, cache: true, name: 'ser' });
    const scope = fork({ values: [[$queryCache, inMemoryCache()]] });
    await allSettled(query.start, { scope, params: 1 });

    const values = serialize(scope);
    const hasAdapter = Object.values(values).some(
      (v) => v != null && typeof v === 'object' && 'get' in (v as object) && 'set' in (v as object),
    );
    expect(hasAdapter).toBe(false);
  });
});
