import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createEvent, fork } from 'effector';
import { createQuery, createQueryFactory, inMemoryCache, invalidate, invalidateTag } from '../src';

/**
 * A query started without params keeps `$params === null` (the engine's reducer maps the
 * `undefined` payload to `null`), while a normal `start()` passes `undefined`. Those are
 * NOT the same cache key — `stableStringify(null)` is `"null"`, `undefined` is `""` — so a
 * trigger that replays the raw stored value splits the cache in two and the next `start`
 * serves the entry from before the invalidation.
 */
function voidFeed() {
  let calls = 0;
  const adapter = inMemoryCache();
  const fx = createEffect(async () => ++calls);
  return { adapter, fx, calls: () => calls, reset: () => (calls = 0) };
}

describe('void queries: invalidation must not split the cache key', () => {
  it('factory.invalidate refetches under the same key a plain start uses', async () => {
    const feed = voidFeed();
    const factory = createQueryFactory();
    const query = factory.createQuery({
      effect: feed.fx,
      name: 'void-factory',
      cache: { adapter: feed.adapter, staleAfter: 60_000 },
    });
    const scope = fork();

    await allSettled(query.start, { scope });
    expect(scope.getState(query.$data)).toBe(1);

    await allSettled(factory.invalidate, { scope, params: undefined });
    expect(scope.getState(query.$data)).toBe(2);

    // the fresh value must survive the next subscribe/start, not be undone by a stale entry
    await allSettled(query.start, { scope });
    expect(scope.getState(query.$data)).toBe(2);

    const dump = (await feed.adapter.dump!()) as Array<{ key: string }>;
    expect(dump).toHaveLength(1);
  });

  it('invalidateTag refetches under the same key a plain start uses', async () => {
    const feed = voidFeed();
    const query = createQuery({
      effect: feed.fx,
      name: 'void-tag',
      tags: ['settings'],
      cache: { adapter: feed.adapter, staleAfter: 60_000 },
    });
    const scope = fork();

    await allSettled(query.start, { scope });
    await allSettled(invalidateTag, { scope, params: 'settings' });
    expect(scope.getState(query.$data)).toBe(2);

    await allSettled(query.start, { scope });
    expect(scope.getState(query.$data)).toBe(2);
  });

  it('invalidate({ on }) refetches under the same key a plain start uses', async () => {
    const feed = voidFeed();
    const query = createQuery({
      effect: feed.fx,
      name: 'void-on',
      cache: { adapter: feed.adapter, staleAfter: 60_000 },
    });
    const saved = createEvent();
    invalidate({ on: saved, refetch: [query] });
    const scope = fork();

    await allSettled(query.start, { scope });
    await allSettled(saved, { scope });
    expect(scope.getState(query.$data)).toBe(2);

    await allSettled(query.start, { scope });
    expect(scope.getState(query.$data)).toBe(2);
  });

  it('a query WITH params is unaffected — its key is still its own', async () => {
    let calls = 0;
    const adapter = inMemoryCache();
    const fx = createEffect(async (id: number) => `${id}:${++calls}`);
    const factory = createQueryFactory();
    const query = factory.createQuery({
      effect: fx,
      name: 'keyed',
      cache: { adapter, staleAfter: 60_000 },
    });
    const scope = fork();

    await allSettled(query.start, { scope, params: 7 });
    await allSettled(factory.invalidate, { scope, params: undefined });
    expect(scope.getState(query.$data)).toBe('7:2');

    await allSettled(query.start, { scope, params: 7 });
    expect(scope.getState(query.$data)).toBe('7:2');
  });
});
