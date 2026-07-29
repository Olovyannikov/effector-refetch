import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { createBarrier, createInfiniteQuery } from '../src';

const tick = () => new Promise((r) => setTimeout(r, 0));

interface Page {
  items: string[];
  next: number | null;
}

function makeInfinite(barrier?: ReturnType<typeof createBarrier>) {
  const fetchPage = createEffect(
    async ({ pageParam }: { params: void; pageParam: number }): Promise<Page> => ({
      items: [`p${pageParam}`],
      next: pageParam < 2 ? pageParam + 1 : null,
    }),
  );
  return createInfiniteQuery({
    effect: fetchPage,
    initialPageParam: 0,
    getNextPageParam: ({ lastPage }) => lastPage.next,
    ...(barrier ? { barrier } : {}),
  });
}

describe('createInfiniteQuery + barrier', () => {
  it('start waits while the barrier is locked, then proceeds on unlock', async () => {
    let calls = 0;
    const fetchPage = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => {
      calls++;
      return { items: [`p${pageParam}`], next: pageParam < 2 ? pageParam + 1 : null } as Page;
    });
    const barrier = createBarrier();
    const feed = createInfiniteQuery({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
      barrier,
    });

    barrier.lock();
    feed.start(undefined);
    // infinite-query has an extra sample hop (start → pageQuery.start → dispatch → barrierWaitFx)
    for (let i = 0; i < 5; i++) await tick();
    expect(calls).toBe(0); // blocked

    barrier.unlock();
    for (let i = 0; i < 5; i++) await tick();
    expect(calls).toBe(1); // released
  });

  it('refetchAll waits on the barrier before reloading the window', async () => {
    let calls = 0;
    const fetchPage = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => {
      calls++;
      return { items: [`p${pageParam}`], next: pageParam < 1 ? pageParam + 1 : null } as Page;
    });
    const barrier = createBarrier();
    const feed = createInfiniteQuery({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
      barrier,
    });

    const scope = fork();
    await allSettled(feed.start, { scope, params: undefined });
    await allSettled(feed.fetchNext, { scope });
    expect(calls).toBe(2);

    // lock the barrier, then trigger refetchAll — it must wait
    await allSettled(barrier.lock, { scope });
    const refetchPromise = allSettled(feed.refetchAll, { scope });
    await tick();
    await tick();
    expect(calls).toBe(2); // still blocked, no new fetches

    await allSettled(barrier.unlock, { scope });
    await refetchPromise;
    expect(calls).toBe(4); // 2 pages re-fetched
  });
});
