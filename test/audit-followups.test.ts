import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { createBarrier, createInfiniteQuery, localStorageCache } from '../src';

describe('audit follow-ups (#48)', () => {
  it('infinite setData rederives cursors and trims pageParams', async () => {
    const fetchPage = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => ({
      items: [`p${pageParam}`],
      next: pageParam < 5 ? pageParam + 1 : null,
    }));
    const feed = createInfiniteQuery({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
    });
    const scope = fork();
    await allSettled(feed.start, { scope, params: undefined });
    await allSettled(feed.fetchNext, { scope });
    expect(scope.getState(feed.$pageParams)).toEqual([0, 1]);

    // an update()-style patch drops a page (via the same __.setData seam):
    // pageParams must shrink with it and the cursors rederive
    await allSettled(feed.__.setData, { scope, params: [{ items: ['p0'], next: 1 }] });

    expect(scope.getState(feed.$pages)).toHaveLength(1);
    expect(scope.getState(feed.$pageParams)).toEqual([0]); // trimmed alongside
    expect(scope.getState(feed.$hasNextPage)).toBe(true); // rederived from page 0
  });

  it('a failed refetchAll reaches $error and $status', async () => {
    let failAll = false;
    const fetchPage = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => {
      if (failAll) throw new Error('window reload failed');
      return { items: [`p${pageParam}`], next: pageParam < 1 ? pageParam + 1 : null };
    });
    const feed = createInfiniteQuery({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
    });
    const scope = fork();
    await allSettled(feed.start, { scope, params: undefined });
    await allSettled(feed.fetchNext, { scope });
    expect(scope.getState(feed.$status)).toBe('done');

    failAll = true;
    await allSettled(feed.refetchAll, { scope });

    expect(scope.getState(feed.$status)).toBe('fail');
    expect((scope.getState(feed.$error) as Error).message).toBe('window reload failed');
    expect(scope.getState(feed.$pages)).toHaveLength(2); // window kept intact

    // a fresh start clears the refetchAll failure
    failAll = false;
    await allSettled(feed.start, { scope, params: undefined });
    expect(scope.getState(feed.$status)).toBe('done');
    expect(scope.getState(feed.$error)).toBeNull();
  });

  it('a shared perform effect settling while the barrier is idle does not unlock it later spuriously', async () => {
    const performFx = createEffect(async () => 'refreshed');
    const barrier = createBarrier({ perform: performFx });
    const scope = fork();

    // unrelated direct call while the barrier is idle — must NOT touch the lock
    await allSettled(performFx, { scope, params: undefined });
    expect(scope.getState(barrier.$locked)).toBe(false);

    // now lock: the barrier launches perform itself and unlocks on ITS settle
    await allSettled(barrier.lock, { scope });
    expect(scope.getState(barrier.$locked)).toBe(false); // perform ran + unlocked
  });

  it('web-storage cache evicts a corrupt entry on read', () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
    const origLS = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
    try {
      const cache = localStorageCache({ prefix: 't:' });
      store.set('t:bad', '{not json');
      expect(cache.get('bad')).toBeNull();
      expect(store.has('t:bad')).toBe(false); // evicted, not left to poison future reads
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: origLS, configurable: true });
    }
  });
});
