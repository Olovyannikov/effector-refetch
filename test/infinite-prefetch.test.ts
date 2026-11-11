import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork, scopeBind } from 'effector';
import { createBarrier, createInfiniteQuery } from '../src';

const tick = () => new Promise((r) => setTimeout(r, 0));

interface Page {
  items: string[];
  next: number | null;
}

function makeFeed(opts: { barrier?: ReturnType<typeof createBarrier> } = {}) {
  const failOn = new Set<number>();
  const calls: number[] = [];
  const fx = createEffect(async ({ pageParam }: { params: void; pageParam: number }): Promise<Page> => {
    calls.push(pageParam);
    if (failOn.has(pageParam)) throw new Error(`boom-${pageParam}`);
    return { items: [`p${pageParam}`], next: pageParam < 3 ? pageParam + 1 : null };
  });
  const feed = createInfiniteQuery<void, number, Page, Error>({
    effect: fx,
    initialPageParam: 1,
    getNextPageParam: ({ lastPage }) => lastPage.next,
    ...(opts.barrier ? { barrier: opts.barrier } : {}),
  });
  return { feed, failOn, calls };
}

describe('infinite query prefetch', () => {
  it('fills the window in the background, exactly as start would', async () => {
    const { feed } = makeFeed();
    const scope = fork();

    await allSettled(feed.prefetch, { scope });

    expect(scope.getState(feed.$pages)).toEqual([{ items: ['p1'], next: 2 }]);
    expect(scope.getState(feed.$pageParams)).toEqual([1]);
    expect(scope.getState(feed.$hasNextPage)).toBe(true);
    expect(scope.getState(feed.$status)).toBe('done');
  });

  it('leaves the feed usable: fetchNext continues from the prefetched page', async () => {
    const { feed } = makeFeed();
    const scope = fork();
    await allSettled(feed.prefetch, { scope });

    await allSettled(feed.fetchNext, { scope });

    expect(scope.getState(feed.$pages).map((p) => p.items[0])).toEqual(['p1', 'p2']);
  });

  it('a failed prefetch leaves the feed cold — no error, no fail status', async () => {
    const { feed, failOn } = makeFeed();
    const scope = fork();
    failOn.add(1);

    await allSettled(feed.prefetch, { scope });

    expect(scope.getState(feed.$status)).toBe('initial');
    expect(scope.getState(feed.$error)).toBe(null);
    expect(scope.getState(feed.$initialError)).toBe(null);
    expect(scope.getState(feed.$pages)).toEqual([]);
  });

  it('after a failed prefetch, start still behaves like a cold first load', async () => {
    const { feed, failOn } = makeFeed();
    const scope = fork();
    failOn.add(1);
    await allSettled(feed.prefetch, { scope });

    failOn.delete(1);
    await allSettled(feed.start, { scope });

    expect(scope.getState(feed.$status)).toBe('done');
    expect(scope.getState(feed.$pages)).toEqual([{ items: ['p1'], next: 2 }]);
  });

  it('reports itself through $isPrefetching, not $pending', async () => {
    const scope = fork();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const slow = createInfiniteQuery<void, number, Page, Error>({
      effect: createEffect(async ({ pageParam }: { params: void; pageParam: number }) => {
        await blocked;
        return { items: [`p${pageParam}`], next: null } as Page;
      }),
      initialPageParam: 1,
      getNextPageParam: ({ lastPage }) => lastPage.next,
    });

    const p = allSettled(slow.prefetch, { scope });
    await tick();
    expect(scope.getState(slow.$isPrefetching)).toBe(true);
    expect(scope.getState(slow.$pending)).toBe(false);
    expect(scope.getState(slow.$isInitialLoading)).toBe(false);

    release();
    await p;
    expect(scope.getState(slow.$isPrefetching)).toBe(false);
  });

  it('a start while the prefetch is in flight wins — the prefetched page is dropped', async () => {
    let release!: (value: Page) => void;
    const calls: number[] = [];
    const fx = createEffect(async ({ pageParam }: { params: void; pageParam: number }): Promise<Page> => {
      calls.push(pageParam);
      if (calls.length === 1) return new Promise<Page>((resolve) => (release = resolve));
      return { items: [`fresh-${pageParam}`], next: null };
    });
    const feed = createInfiniteQuery<void, number, Page, Error>({
      effect: fx,
      initialPageParam: 1,
      getNextPageParam: ({ lastPage }) => lastPage.next,
    });
    const scope = fork();

    const prefetching = allSettled(feed.prefetch, { scope });
    await tick();
    // fire start WITHOUT awaiting: allSettled would wait for the stuck prefetch too
    scopeBind(feed.start, { scope })();
    await tick();
    expect(scope.getState(feed.$pages)).toEqual([{ items: ['fresh-1'], next: null }]);

    release({ items: ['stale-1'], next: 2 });
    await prefetching;

    expect(scope.getState(feed.$pages)).toEqual([{ items: ['fresh-1'], next: null }]);
  });

  it('is a no-op once the feed has pages', async () => {
    const { feed, calls } = makeFeed();
    const scope = fork();
    await allSettled(feed.start, { scope });
    calls.length = 0;

    await allSettled(feed.prefetch, { scope });

    expect(calls).toEqual([]);
  });

  it('waits for a locked barrier instead of firing through it', async () => {
    const barrier = createBarrier();
    const { feed, calls } = makeFeed({ barrier });
    const scope = fork();

    await allSettled(barrier.lock, { scope });
    const p = allSettled(feed.prefetch, { scope });
    await tick();
    expect(calls).toEqual([]);

    await allSettled(barrier.unlock, { scope });
    await p;
    expect(calls).toEqual([1]);
    expect(scope.getState(feed.$pages)).toEqual([{ items: ['p1'], next: 2 }]);
  });
});
