import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createWatch, fork } from 'effector';
import { createInfiniteQuery } from '../src';

interface Page {
  items: string[];
  next: number | null;
}

/** A feed whose page fetch fails for the page params listed in `failOn`. */
function makeFeed() {
  const failOn = new Set<number>();
  const fx = createEffect(async ({ pageParam }: { params: void; pageParam: number }): Promise<Page> => {
    if (failOn.has(pageParam)) throw new Error(`boom-${pageParam}`);
    return { items: [`p${pageParam}`], next: pageParam < 3 ? pageParam + 1 : null };
  });
  const feed = createInfiniteQuery<void, number, Page, Error>({
    effect: fx,
    initialPageParam: 1,
    getNextPageParam: ({ lastPage }) => lastPage.next,
    getPreviousPageParam: ({ firstPageParam }) => (firstPageParam > 0 ? firstPageParam - 1 : null),
  });
  return { feed, failOn };
}

describe('infinite query per-direction errors', () => {
  it('a failed fetchNext sets $nextPageError and keeps the loaded pages', async () => {
    const { feed, failOn } = makeFeed();
    const scope = fork();
    await allSettled(feed.start, { scope });
    failOn.add(2);

    await allSettled(feed.fetchNext, { scope });

    expect(scope.getState(feed.$nextPageError)?.message).toBe('boom-2');
    expect(scope.getState(feed.$pages)).toEqual([{ items: ['p1'], next: 2 }]);
    expect(scope.getState(feed.$initialError)).toBe(null);
    expect(scope.getState(feed.$previousPageError)).toBe(null);
  });

  it('a failed start sets $initialError, not $nextPageError', async () => {
    const { feed, failOn } = makeFeed();
    const scope = fork();
    failOn.add(1);

    await allSettled(feed.start, { scope });

    expect(scope.getState(feed.$initialError)?.message).toBe('boom-1');
    expect(scope.getState(feed.$nextPageError)).toBe(null);
    expect(scope.getState(feed.$pages)).toEqual([]);
  });

  it('a failed fetchPrevious sets $previousPageError', async () => {
    const { feed, failOn } = makeFeed();
    const scope = fork();
    await allSettled(feed.start, { scope });
    failOn.add(0);

    await allSettled(feed.fetchPrevious, { scope });

    expect(scope.getState(feed.$previousPageError)?.message).toBe('boom-0');
    expect(scope.getState(feed.$nextPageError)).toBe(null);
    expect(scope.getState(feed.$pages)).toEqual([{ items: ['p1'], next: 2 }]);
  });

  it('$nextPageError clears when that direction is retried', async () => {
    const { feed, failOn } = makeFeed();
    const scope = fork();
    await allSettled(feed.start, { scope });
    failOn.add(2);
    await allSettled(feed.fetchNext, { scope });
    expect(scope.getState(feed.$nextPageError)).not.toBe(null);

    failOn.delete(2);
    await allSettled(feed.fetchNext, { scope });

    expect(scope.getState(feed.$nextPageError)).toBe(null);
    expect(scope.getState(feed.$pages)).toHaveLength(2);
  });

  it('a failed fetchNext does not clear a standing $previousPageError', async () => {
    const { feed, failOn } = makeFeed();
    const scope = fork();
    await allSettled(feed.start, { scope });
    failOn.add(0);
    await allSettled(feed.fetchPrevious, { scope });
    failOn.add(2);

    await allSettled(feed.fetchNext, { scope });

    expect(scope.getState(feed.$previousPageError)?.message).toBe('boom-0');
    expect(scope.getState(feed.$nextPageError)?.message).toBe('boom-2');
  });

  it('start and reset clear every direction error', async () => {
    const { feed, failOn } = makeFeed();
    const scope = fork();
    await allSettled(feed.start, { scope });
    failOn.add(2);
    await allSettled(feed.fetchNext, { scope });
    failOn.delete(2);

    await allSettled(feed.start, { scope });
    expect(scope.getState(feed.$nextPageError)).toBe(null);

    failOn.add(2);
    await allSettled(feed.fetchNext, { scope });
    expect(scope.getState(feed.$nextPageError)).not.toBe(null);

    await allSettled(feed.reset, { scope });
    expect(scope.getState(feed.$nextPageError)).toBe(null);
    expect(scope.getState(feed.$initialError)).toBe(null);
  });

  it('finished.fail carries the direction that failed', async () => {
    const { feed, failOn } = makeFeed();
    const scope = fork();
    const seen: string[] = [];
    createWatch({ unit: feed.finished.fail, scope, fn: ({ direction }) => seen.push(direction) });

    failOn.add(1);
    await allSettled(feed.start, { scope });
    failOn.delete(1);
    await allSettled(feed.start, { scope });

    failOn.add(2);
    await allSettled(feed.fetchNext, { scope });
    failOn.delete(2);

    failOn.add(0);
    await allSettled(feed.fetchPrevious, { scope });

    expect(seen).toEqual(['initial', 'next', 'previous']);
  });

  it('exposes the direction errors through @@unitShape', () => {
    const { feed } = makeFeed();
    const shape = feed['@@unitShape']();

    expect(shape.initialError).toBe(feed.$initialError);
    expect(shape.nextPageError).toBe(feed.$nextPageError);
    expect(shape.previousPageError).toBe(feed.$previousPageError);
  });

  it('a failed refetchAll reports direction "refetchAll" and leaves page errors alone', async () => {
    const { feed, failOn } = makeFeed();
    const scope = fork();
    const seen: string[] = [];
    createWatch({ unit: feed.finished.fail, scope, fn: ({ direction }) => seen.push(direction) });
    await allSettled(feed.start, { scope });
    await allSettled(feed.fetchNext, { scope });

    failOn.add(2);
    await allSettled(feed.refetchAll, { scope });

    expect(seen).toEqual(['refetchAll']);
    expect(scope.getState(feed.$nextPageError)).toBe(null);
    expect(scope.getState(feed.$error)?.message).toBe('boom-2');
  });
});
