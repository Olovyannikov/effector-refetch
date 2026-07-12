import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { createInfiniteQuery, invalidateTag } from '../src';

interface Page {
  items: string[];
  next: number | null;
}

function makeFeed(tags?: string[]) {
  let version = 0;
  const fetched: number[] = [];
  const fx = createEffect(
    async ({ pageParam }: { params: { tag: string }; pageParam: number }): Promise<Page> => {
      fetched.push(pageParam);
      return { items: [`p${pageParam}-v${version}`], next: pageParam < 2 ? pageParam + 1 : null };
    },
  );
  const feed = createInfiniteQuery<{ tag: string }, number, Page>({
    effect: fx,
    initialPageParam: 0,
    getNextPageParam: ({ lastPage }) => lastPage.next,
    ...(tags ? { tags } : {}),
  });
  return { feed, fetched, bump: () => version++ };
}

async function loadThreePages(feed: ReturnType<typeof makeFeed>['feed'], scope: ReturnType<typeof fork>) {
  await allSettled(feed.start, { scope, params: { tag: 'cats' } });
  await allSettled(feed.fetchNext, { scope });
  await allSettled(feed.fetchNext, { scope });
}

describe('infinite query refetchAll', () => {
  it('re-fetches every accumulated page in order, keeping the window', async () => {
    const { feed, fetched, bump } = makeFeed();
    const scope = fork();
    await loadThreePages(feed, scope);
    expect(scope.getState(feed.$pages).map((p) => p.items[0])).toEqual(['p0-v0', 'p1-v0', 'p2-v0']);
    fetched.length = 0;

    bump(); // server data changed
    await allSettled(feed.refetchAll, { scope });

    expect(fetched).toEqual([0, 1, 2]); // same params, same order
    expect(scope.getState(feed.$pages).map((p) => p.items[0])).toEqual(['p0-v1', 'p1-v1', 'p2-v1']);
    expect(scope.getState(feed.$hasNextPage)).toBe(false); // window preserved, cursor rederived
  });

  it('is a no-op with no accumulated pages', async () => {
    const { feed, fetched } = makeFeed();
    const scope = fork();
    await allSettled(feed.refetchAll, { scope });
    expect(fetched).toEqual([]);
    expect(scope.getState(feed.$pages)).toEqual([]);
  });

  it('a reset during refetchAll discards the stale result', async () => {
    let hang: Promise<void> | null = null;
    let release: () => void = () => {};
    const fx = createEffect(async ({ pageParam }: { params: void; pageParam: number }): Promise<Page> => {
      if (hang) await hang;
      return { items: [`p${pageParam}`], next: pageParam < 1 ? pageParam + 1 : null };
    });
    const feed = createInfiniteQuery<void, number, Page>({
      effect: fx,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
    });
    const scope = fork();
    await allSettled(feed.start, { scope, params: undefined });
    await allSettled(feed.fetchNext, { scope });
    expect(scope.getState(feed.$pages)).toHaveLength(2);

    hang = new Promise<void>((res) => {
      release = res;
    });
    const p = allSettled(feed.refetchAll, { scope });
    const r = allSettled(feed.reset, { scope });
    hang = null; // subsequent pages proceed immediately
    release(); // let the in-flight page resolve late
    await Promise.all([p, r]);

    expect(scope.getState(feed.$pages)).toEqual([]); // reset won, stale result dropped
  });

  it('invalidateTag triggers refetchAll on a tagged infinite query', async () => {
    const { feed, fetched, bump } = makeFeed(['feed']);
    const scope = fork();
    await loadThreePages(feed, scope);
    fetched.length = 0;

    bump();
    await allSettled(invalidateTag, { scope, params: 'feed' });

    expect(fetched).toEqual([0, 1, 2]);
    expect(scope.getState(feed.$pages).map((p) => p.items[0])).toEqual(['p0-v1', 'p1-v1', 'p2-v1']);
  });
});
