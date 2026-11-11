import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createWatch, fork } from 'effector';
import { createInfiniteQuery } from '../src';

interface Page {
  items: string[];
  next: number | null;
}

const pageOf = (pageParam: number): Page => ({
  items: [`p${pageParam}`],
  next: pageParam < 3 ? pageParam + 1 : null,
});

function makeFeed(accumulate?: boolean) {
  const fx = createEffect(
    async ({ pageParam }: { params: void; pageParam: number }): Promise<Page> => pageOf(pageParam),
  );
  const feed = createInfiniteQuery<void, number, Page, Error>({
    effect: fx,
    initialPageParam: 1,
    getNextPageParam: ({ lastPage }) => lastPage.next,
    getPreviousPageParam: ({ firstPageParam }) => (firstPageParam > 0 ? firstPageParam - 1 : null),
    ...(accumulate === undefined ? {} : { accumulate }),
  });
  return feed;
}

/** Record the `finished.done` stream the way a normalizing consumer would. */
function drain(feed: ReturnType<typeof makeFeed>, scope: ReturnType<typeof fork>) {
  const seen: Array<{ pageParam: number; direction: string; first: string }> = [];
  createWatch({
    unit: feed.finished.done,
    scope,
    fn: ({ page, pageParam, direction }) => seen.push({ pageParam, direction, first: page.items[0] }),
  });
  return seen;
}

describe('infinite query page stream', () => {
  it('finished.done carries the pageParam and the direction of each page', async () => {
    const feed = makeFeed();
    const scope = fork();
    const seen = drain(feed, scope);

    await allSettled(feed.start, { scope });
    await allSettled(feed.fetchNext, { scope });
    await allSettled(feed.fetchPrevious, { scope });

    expect(seen).toEqual([
      { pageParam: 1, direction: 'initial', first: 'p1' },
      { pageParam: 2, direction: 'next', first: 'p2' },
      { pageParam: 0, direction: 'previous', first: 'p0' },
    ]);
  });

  it('a restart reports direction "initial" again', async () => {
    const feed = makeFeed();
    const scope = fork();
    const seen = drain(feed, scope);

    await allSettled(feed.start, { scope });
    await allSettled(feed.fetchNext, { scope });
    await allSettled(feed.start, { scope });

    expect(seen.map((s) => s.direction)).toEqual(['initial', 'next', 'initial']);
  });

  it('accumulate: false keeps only the last page, not the window', async () => {
    const feed = makeFeed(false);
    const scope = fork();

    await allSettled(feed.start, { scope });
    await allSettled(feed.fetchNext, { scope });

    expect(scope.getState(feed.$pages)).toEqual([pageOf(2)]);
    expect(scope.getState(feed.$pageParams)).toEqual([2]);
  });

  it('accumulate: false still advances the cursor through the whole feed', async () => {
    const feed = makeFeed(false);
    const scope = fork();

    await allSettled(feed.start, { scope });
    expect(scope.getState(feed.$hasNextPage)).toBe(true);
    await allSettled(feed.fetchNext, { scope });
    await allSettled(feed.fetchNext, { scope });

    expect(scope.getState(feed.$pages)).toEqual([pageOf(3)]);
    expect(scope.getState(feed.$hasNextPage)).toBe(false);
  });

  it('accumulate: false emits every page through finished.done', async () => {
    const feed = makeFeed(false);
    const scope = fork();
    const seen = drain(feed, scope);

    await allSettled(feed.start, { scope });
    await allSettled(feed.fetchNext, { scope });
    await allSettled(feed.fetchNext, { scope });

    expect(seen.map((s) => s.first)).toEqual(['p1', 'p2', 'p3']);
    expect(seen.map((s) => s.direction)).toEqual(['initial', 'next', 'next']);
  });

  it('accumulate defaults to true — the window still accumulates', async () => {
    const feed = makeFeed();
    const scope = fork();

    await allSettled(feed.start, { scope });
    await allSettled(feed.fetchNext, { scope });

    expect(scope.getState(feed.$pages)).toEqual([pageOf(1), pageOf(2)]);
  });

  it('accumulate: false reloads only the current page on refetchAll', async () => {
    let version = 0;
    const fetched: number[] = [];
    const fx = createEffect(async ({ pageParam }: { params: void; pageParam: number }): Promise<Page> => {
      fetched.push(pageParam);
      return { items: [`p${pageParam}-v${version}`], next: pageParam < 3 ? pageParam + 1 : null };
    });
    const feed = createInfiniteQuery<void, number, Page, Error>({
      effect: fx,
      initialPageParam: 1,
      getNextPageParam: ({ lastPage }) => lastPage.next,
      accumulate: false,
    });
    const scope = fork();
    await allSettled(feed.start, { scope });
    await allSettled(feed.fetchNext, { scope });
    fetched.length = 0;
    version = 1;

    await allSettled(feed.refetchAll, { scope });

    expect(fetched).toEqual([2]);
    expect(scope.getState(feed.$pages)).toEqual([{ items: ['p2-v1'], next: 3 }]);
  });
});
