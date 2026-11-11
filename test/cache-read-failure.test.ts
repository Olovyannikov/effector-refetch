import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createWatch, fork } from 'effector';
import { createQuery, inMemoryCache, type CacheAdapter } from '../src';

/** A cache whose reads fail on demand — an IndexedDB / remote adapter having a bad moment. */
function flakyCache() {
  const inner = inMemoryCache();
  let failing = false;
  const adapter = {
    ...inner,
    get: async (key: string) => {
      if (failing) throw new Error('IndexedDB unavailable');
      return inner.get(key);
    },
  } as CacheAdapter;
  return { adapter, fail: (on: boolean) => (failing = on) };
}

describe('a failing cache read', () => {
  it('falls through to the network instead of swallowing the run', async () => {
    let calls = 0;
    const fx = createEffect(async (n: number) => {
      calls++;
      return `v${n}`;
    });
    const cache = flakyCache();
    const query = createQuery({ effect: fx, cache: { adapter: cache.adapter, staleAfter: 60_000 } });
    const scope = fork();
    await allSettled(query.start, { scope, params: 1 });
    calls = 0;

    cache.fail(true);
    await allSettled(query.start, { scope, params: 2 });

    expect(calls).toBe(1);
    expect(scope.getState(query.$data)).toBe('v2');
    expect(scope.getState(query.$status)).toBe('done');
  });

  it('settles the run through the normal lifecycle', async () => {
    const fx = createEffect(async (n: number) => `v${n}`);
    const cache = flakyCache();
    const query = createQuery({ effect: fx, cache: { adapter: cache.adapter, staleAfter: 60_000 } });
    const scope = fork();
    const log: string[] = [];
    createWatch({ unit: query.finished.done, scope, fn: () => log.push('done') });
    createWatch({ unit: query.finished.fail, scope, fn: () => log.push('fail') });
    createWatch({ unit: query.aborted, scope, fn: ({ reason }) => log.push(`aborted:${reason}`) });

    cache.fail(true);
    await allSettled(query.start, { scope, params: 1 });

    expect(log).toEqual(['done']);
  });

  it('is observable on the inspect stream', async () => {
    const fx = createEffect(async (n: number) => `v${n}`);
    const cache = flakyCache();
    const query = createQuery({ effect: fx, cache: { adapter: cache.adapter, staleAfter: 60_000 } });
    const scope = fork();
    const errors: string[] = [];
    createWatch({
      unit: query.__.inspect.cacheError,
      scope,
      fn: ({ error }) => errors.push(error.message),
    });

    cache.fail(true);
    await allSettled(query.start, { scope, params: 1 });

    expect(errors).toEqual(['IndexedDB unavailable']);
  });

  it('a throwing cache.key does not kill the run either', async () => {
    let calls = 0;
    const fx = createEffect(async (p: { at: Date }) => {
      calls++;
      return 'ok';
    });
    const query = createQuery({
      effect: fx,
      cache: { key: (p) => p.at.toISOString(), staleAfter: 60_000 },
    });
    const scope = fork();
    await allSettled(query.start, { scope, params: { at: new Date('2026-01-02T03:04:05Z') } });
    calls = 0;

    // what a hydrated SSR client holds: a string where the type promised a Date
    await allSettled(query.start, {
      scope,
      params: { at: '2026-01-02T03:04:05.000Z' as unknown as Date },
    });

    expect(calls).toBe(1);
    expect(scope.getState(query.$status)).toBe('done');
  });

  it('still writes to the cache after a failed read, so the next read can hit', async () => {
    let calls = 0;
    const fx = createEffect(async (n: number) => {
      calls++;
      return `v${n}`;
    });
    const cache = flakyCache();
    const query = createQuery({ effect: fx, cache: { adapter: cache.adapter, staleAfter: 60_000 } });
    const scope = fork();

    cache.fail(true);
    await allSettled(query.start, { scope, params: 1 });
    expect(calls).toBe(1);

    cache.fail(false); // the adapter recovers
    calls = 0;
    await allSettled(query.start, { scope, params: 1 });

    expect(calls).toBe(0); // served from the entry written during the outage
  });

  it('a healthy cache still hits — no regression', async () => {
    let calls = 0;
    const fx = createEffect(async (n: number) => {
      calls++;
      return `v${n}`;
    });
    const cache = flakyCache();
    const query = createQuery({ effect: fx, cache: { adapter: cache.adapter, staleAfter: 60_000 } });
    const scope = fork();
    await allSettled(query.start, { scope, params: 1 });
    calls = 0;

    await allSettled(query.start, { scope, params: 1 });

    expect(calls).toBe(0);
  });
});
