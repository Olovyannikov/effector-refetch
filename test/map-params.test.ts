import { describe, it, expect } from 'vitest';
import { allSettled, attach, createEffect, createEvent, createStore, fork } from 'effector';
import { createQuery, createRequestFx } from '../src';

describe('createRequestFx composability (signal side channel)', () => {
  it('is directly callable with plain params (no envelope)', async () => {
    const getFx = createRequestFx<{ id: number }, number>(({ id }) => id * 2);
    await expect(getFx({ id: 21 })).resolves.toBe(42);
  });

  it('plain attach({ mapParams }) works and the query still succeeds', async () => {
    const seen: Array<{ id: number }> = [];
    const getFx = createRequestFx<{ id: number }, number>(({ id }) => {
      seen.push({ id });
      return id * 2;
    });
    const attached = attach({
      effect: getFx,
      mapParams: (id: number) => ({ id }),
    });
    const q = createQuery({ effect: attached });
    const scope = fork();

    await allSettled(q.start, { scope, params: 21 });
    expect(seen).toEqual([{ id: 21 }]);
    expect(scope.getState(q.$data)).toBe(42);
  });

  it('plain attach({ source }) injects store values fork-correctly', async () => {
    const $userId = createStore('anon');
    const getFx = createRequestFx<{ q: string; userId: string }, string>(({ q, userId }) => `${q}:${userId}`);
    const attached = attach({
      source: { userId: $userId },
      mapParams: (q: string, { userId }) => ({ q, userId }),
      effect: getFx,
    });
    const query = createQuery({ effect: attached });

    const scopeA = fork({ values: [[$userId, 'alice']] });
    const scopeB = fork({ values: [[$userId, 'bob']] });
    await allSettled(query.start, { scope: scopeA, params: 'search' });
    await allSettled(query.start, { scope: scopeB, params: 'search' });

    expect(scopeA.getState(query.$data)).toBe('search:alice');
    expect(scopeB.getState(query.$data)).toBe('search:bob');
  });

  it('cancellation aborts THROUGH a plain attach wrapper', async () => {
    let abortedFor: number | null = null;
    const getFx = createRequestFx<{ id: number }, number>(
      ({ id }, { signal }) =>
        new Promise<number>((resolve, reject) => {
          const t = setTimeout(() => resolve(id), 50);
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            abortedFor = id;
            reject(new Error('aborted'));
          });
        }),
    );
    const attached = attach({ effect: getFx, mapParams: (id: number) => ({ id }) });
    const q = createQuery({ effect: attached });
    const scope = fork();

    allSettled(q.start, { scope, params: 7 });
    await allSettled(q.cancel, { scope });
    expect(abortedFor).toBe(7);
  });

  it('a direct call outside a query run gets a never-aborted signal', async () => {
    let observed: AbortSignal | null = null;
    const getFx = createRequestFx<void, boolean>((_p, { signal }) => {
      observed = signal;
      return true;
    });
    await getFx();
    expect(observed).not.toBeNull();
    expect(observed!.aborted).toBe(false);
  });
});

describe('createQuery source/mapParams', () => {
  it('maps public params into effect params (plain effect)', async () => {
    const seen: Array<{ id: number; limit: number }> = [];
    const fx = createEffect(async (p: { id: number; limit: number }) => {
      seen.push(p);
      return p.id;
    });
    const q = createQuery({
      effect: fx,
      mapParams: (id: number) => ({ id, limit: 20 }),
    });
    const scope = fork();
    await allSettled(q.start, { scope, params: 3 });

    expect(seen).toEqual([{ id: 3, limit: 20 }]);
    // public surface stays in public params
    expect(scope.getState(q.$params)).toBe(3);
    expect(scope.getState(q.$data)).toBe(3);
  });

  it('injects source values fork-correctly (abortable effect)', async () => {
    const $userId = createStore('anon');
    const getFx = createRequestFx<{ q: string; userId: string }, string>(({ q, userId }) => `${q}:${userId}`);
    const query = createQuery({
      effect: getFx,
      source: { userId: $userId },
      mapParams: (q: string, { userId }) => ({ q, userId }),
    });

    const scopeA = fork({ values: [[$userId, 'alice']] });
    const scopeB = fork({ values: [[$userId, 'bob']] });
    await allSettled(query.start, { scope: scopeA, params: 'search' });
    await allSettled(query.start, { scope: scopeB, params: 'search' });

    expect(scopeA.getState(query.$data)).toBe('search:alice');
    expect(scopeB.getState(query.$data)).toBe('search:bob');
  });

  it('computes the cache key from the MAPPED params: a source change is a different key', async () => {
    const setUserId = createEvent<string>();
    const $userId = createStore('alice');
    $userId.on(setUserId, (_v, v) => v);
    let calls = 0;
    const fx = createEffect(async (p: { q: string; userId: string }) => {
      calls++;
      return `${p.q}:${p.userId}`;
    });
    const query = createQuery({
      effect: fx,
      source: { userId: $userId },
      mapParams: (q: string, { userId }) => ({ q, userId }),
      cache: true,
    });
    const scope = fork();

    await allSettled(query.start, { scope, params: 'search' });
    expect(calls).toBe(1);

    // same public params + same source -> cache hit
    await allSettled(query.start, { scope, params: 'search' });
    expect(calls).toBe(1);
    expect(scope.getState(query.$data)).toBe('search:alice');

    // same public params, DIFFERENT source -> different key, no stale hit
    await allSettled(setUserId, { scope, params: 'bob' });
    await allSettled(query.start, { scope, params: 'search' });
    expect(calls).toBe(2);
    expect(scope.getState(query.$data)).toBe('search:bob');

    // back to the first source value -> the old entry is still valid
    await allSettled(setUserId, { scope, params: 'alice' });
    await allSettled(query.start, { scope, params: 'search' });
    expect(calls).toBe(2);
    expect(scope.getState(query.$data)).toBe('search:alice');
  });

  it('a custom cache.key receives the mapped params', async () => {
    const keys: string[] = [];
    const fx = createEffect(async (p: { id: number; token: string }) => p.id);
    const q = createQuery({
      effect: fx,
      source: createStore('t-1'),
      mapParams: (id: number, token) => ({ id, token }),
      cache: {
        key: (p) => {
          const k = `${p.id}@${p.token}`;
          keys.push(k);
          return k;
        },
      },
    });
    const scope = fork();
    await allSettled(q.start, { scope, params: 5 });
    expect(keys).toContain('5@t-1');
  });

  it('retry re-runs with the mapped params frozen at start time', async () => {
    const $token = createStore('t-1');
    const seen: string[] = [];
    let attempts = 0;
    const fx = createEffect(async (p: { token: string }) => {
      seen.push(p.token);
      attempts++;
      if (attempts < 2) throw new Error('flaky');
      return p.token;
    });
    const q = createQuery({
      effect: fx,
      source: $token,
      mapParams: (_: void, token) => ({ token }),
      retry: 2,
    });
    const scope = fork();
    await allSettled(q.start, { scope, params: undefined });

    expect(seen).toEqual(['t-1', 't-1']);
    expect(scope.getState(q.$status)).toBe('done');
  });

  it('finished events and mapData ctx expose the public params', async () => {
    const fx = createEffect(async (p: { id: number }) => p.id * 2);
    const finishedParams: number[] = [];
    const q = createQuery({
      effect: fx,
      mapParams: (id: number) => ({ id }),
      mapData: ({ result, params }) => ({ result, publicParams: params }),
    });
    q.finished.done.watch(({ params }) => finishedParams.push(params));
    const scope = fork();
    await allSettled(q.start, { scope, params: 4 });

    expect(finishedParams).toEqual([4]);
    expect(scope.getState(q.$data)).toEqual({ result: 8, publicParams: 4 });
  });

  it('TAKE_LATEST still aborts a superseded mapped request', async () => {
    const abortedIds: number[] = [];
    const getFx = createRequestFx<{ id: number }, number>(
      ({ id }, { signal }) =>
        new Promise<number>((resolve, reject) => {
          const t = setTimeout(() => resolve(id), id === 1 ? 50 : 0);
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            abortedIds.push(id);
            reject(new Error('aborted'));
          });
        }),
    );
    const q = createQuery({
      effect: getFx,
      mapParams: (id: number) => ({ id }),
      concurrency: 'TAKE_LATEST',
    });
    const scope = fork();

    allSettled(q.start, { scope, params: 1 });
    await allSettled(q.start, { scope, params: 2 });

    expect(abortedIds).toEqual([1]);
    expect(scope.getState(q.$data)).toBe(2);
  });

  it('refetch re-reads the source (fresh mapping, not the frozen one)', async () => {
    const setToken = createEvent<string>();
    const $token = createStore('t-1');
    $token.on(setToken, (_v, v) => v);
    const seen: string[] = [];
    const fx = createEffect(async (p: { id: number; token: string }) => {
      seen.push(p.token);
      return p.id;
    });
    const q = createQuery({
      effect: fx,
      source: $token,
      mapParams: (id: number, token) => ({ id, token }),
    });
    const scope = fork();

    await allSettled(q.start, { scope, params: 1 });
    await allSettled(setToken, { scope, params: 't-2' });
    await allSettled(q.refetch, { scope, params: 1 });

    expect(seen).toEqual(['t-1', 't-2']);
  });
});
