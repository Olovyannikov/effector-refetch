import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork, type Scope } from 'effector';
import { createInfiniteQuery, type InfiniteQuery } from '../src';

interface Page {
  items: string[];
  next: number | null;
  prev: number | null;
}

function makeFeed() {
  const resolvers: Array<(p: Page) => void> = [];
  const fx = createEffect(
    ({ pageParam }: { params: void; pageParam: number }) =>
      new Promise<Page>((res) => {
        resolvers.push((p) => res(p));
        pending.push(pageParam);
      }),
  );
  const pending: number[] = [];
  const feed = createInfiniteQuery<void, number, Page>({
    effect: fx,
    initialPageParam: 0,
    getNextPageParam: ({ lastPage }) => lastPage.next,
    getPreviousPageParam: ({ firstPage }) => firstPage.prev,
  });
  const resolve = (pageParam: number, next: number | null = null, prev: number | null = null) =>
    resolvers.shift()!({ items: [`p${pageParam}`], next, prev });
  return { feed, resolve };
}

function flags(feed: InfiniteQuery<void, number, Page>, scope: Scope) {
  return {
    initial: scope.getState(feed.$isInitialLoading),
    next: scope.getState(feed.$isFetchingNextPage),
    prev: scope.getState(feed.$isFetchingPreviousPage),
    refetch: scope.getState(feed.$isRefetching),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('infinite query loading flags', () => {
  it('distinguishes the first load, next/previous page fetches and refetchAll', async () => {
    const { feed, resolve } = makeFeed();
    const scope = fork();

    // idle
    expect(flags(feed, scope)).toEqual({ initial: false, next: false, prev: false, refetch: false });

    // first load
    const p1 = allSettled(feed.start, { scope, params: undefined });
    expect(flags(feed, scope)).toEqual({ initial: true, next: false, prev: false, refetch: false });
    resolve(0, 1, -1);
    await p1;
    expect(flags(feed, scope)).toEqual({ initial: false, next: false, prev: false, refetch: false });

    // next page over existing data
    const p2 = allSettled(feed.fetchNext, { scope });
    expect(flags(feed, scope)).toEqual({ initial: false, next: true, prev: false, refetch: false });
    resolve(1, null, -1);
    await p2;

    // previous page
    const p3 = allSettled(feed.fetchPrevious, { scope });
    expect(flags(feed, scope)).toEqual({ initial: false, next: false, prev: true, refetch: false });
    resolve(-1, null, null);
    await p3;

    // whole-window reload (pages are re-fetched sequentially)
    const p4 = allSettled(feed.refetchAll, { scope });
    expect(flags(feed, scope)).toEqual({ initial: false, next: false, prev: false, refetch: true });
    resolve(-1);
    await tick();
    resolve(0);
    await tick();
    resolve(1);
    await p4;
    expect(flags(feed, scope)).toEqual({ initial: false, next: false, prev: false, refetch: false });
  });

  it('a start over accumulated pages counts as an initial load again (pages reset)', async () => {
    const { feed, resolve } = makeFeed();
    const scope = fork();

    const p1 = allSettled(feed.start, { scope, params: undefined });
    resolve(0, 1);
    await p1;
    expect(scope.getState(feed.$pages)).toHaveLength(1);

    const p2 = allSettled(feed.start, { scope, params: undefined });
    expect(flags(feed, scope)).toEqual({ initial: true, next: false, prev: false, refetch: false });
    resolve(0);
    await p2;
  });

  it('exposes the flags through @@unitShape', () => {
    const { feed } = makeFeed();
    const shape = feed['@@unitShape']();
    expect(feed.$isInitialLoading).toBeDefined();
    expect(shape.isInitialLoading).toBe(feed.$isInitialLoading);
    expect(shape.isFetchingNextPage).toBe(feed.$isFetchingNextPage);
    expect(shape.isFetchingPreviousPage).toBe(feed.$isFetchingPreviousPage);
    expect(shape.isRefetching).toBe(feed.$isRefetching);
  });
});
