import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork, scopeBind } from 'effector';
import { createBarrier, createInfiniteQuery } from '../src';

const tick = () => new Promise((r) => setTimeout(r, 0));

interface Page {
  items: string[];
  next: number | null;
}

class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
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

  it('refetchAll waits again when the barrier closes MID-window', async () => {
    const seen: number[] = [];
    const barrier = createBarrier();
    let lockOnNextPage = false;
    const fetchPage = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => {
      seen.push(pageParam);
      // the first page of the reload closes the barrier (as a 401 handler would).
      // scopeBind: the lock has to land on the scope this run belongs to
      if (lockOnNextPage && pageParam === 0) {
        lockOnNextPage = false;
        scopeBind(barrier.lock, { safe: true })();
      }
      return { items: [`p${pageParam}`], next: pageParam < 1 ? pageParam + 1 : null } as Page;
    });
    const feed = createInfiniteQuery({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
      barrier,
    });

    const scope = fork();
    await allSettled(feed.start, { scope, params: undefined });
    await allSettled(feed.fetchNext, { scope });
    expect(seen).toEqual([0, 1]);

    lockOnNextPage = true;
    const refetchPromise = allSettled(feed.refetchAll, { scope });
    for (let i = 0; i < 5; i++) await tick();
    // page 0 reloaded and closed the barrier; page 1 must NOT have started
    expect(seen).toEqual([0, 1, 0]);

    await allSettled(barrier.unlock, { scope });
    await refetchPromise;
    expect(seen).toEqual([0, 1, 0, 1]);
    expect(scope.getState(feed.$pages)).toHaveLength(2);
  });
});

describe('createInfiniteQuery + retry', () => {
  it('retries a failed page fetch', async () => {
    let calls = 0;
    const fetchPage = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => {
      calls++;
      if (calls < 3) throw new Error('boom');
      return { items: [`p${pageParam}`], next: null } as Page;
    });
    const feed = createInfiniteQuery({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
      retry: 2,
    });

    const scope = fork();
    await allSettled(feed.start, { scope, params: undefined });
    expect(calls).toBe(3);
    expect(scope.getState(feed.$status)).toBe('done');
    expect(scope.getState(feed.$pages)).toEqual([{ items: ['p0'], next: null }]);
  });

  it('honours retry.filter — an unretryable failure fails immediately', async () => {
    let calls = 0;
    const fetchPage = createEffect(async (_req: { params: void; pageParam: number }): Promise<Page> => {
      calls++;
      throw new HttpError(404);
    });
    const feed = createInfiniteQuery<void, number, Page, HttpError>({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
      retry: { times: 3, filter: ({ error }) => error.status === 401 },
    });

    const scope = fork();
    await allSettled(feed.start, { scope, params: undefined });
    expect(calls).toBe(1);
    expect(scope.getState(feed.$status)).toBe('fail');
  });

  it('a retried page fetch waits on the barrier — the 401 refresh flow', async () => {
    let token = 'stale';
    const attempts: number[] = [];

    const refreshFx = createEffect(async () => {
      await tick();
      token = 'fresh';
    });
    const barrier = createBarrier({ perform: refreshFx });

    const fetchPage = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => {
      attempts.push(pageParam);
      if (token === 'stale') {
        // close the barrier where the 401 is observed (an HTTP layer would do this),
        // scope-bound so it lands on the scope running this query
        scopeBind(barrier.lock, { safe: true })();
        throw new HttpError(401);
      }
      return { items: [`p${pageParam}`], next: pageParam < 1 ? pageParam + 1 : null } as Page;
    });

    const feed = createInfiniteQuery<void, number, Page, HttpError>({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
      barrier,
      retry: { times: 1, filter: ({ error }) => error.status === 401 },
    });

    const scope = fork();
    await allSettled(feed.start, { scope, params: undefined });
    for (let i = 0; i < 5; i++) await tick();

    expect(attempts).toEqual([0, 0]); // failed once, retried after the refresh
    expect(token).toBe('fresh');
    expect(scope.getState(feed.$status)).toBe('done');
    expect(scope.getState(feed.$pages)).toEqual([{ items: ['p0'], next: 1 }]);
  });

  it('retry applies to fetchNext as well', async () => {
    let failNext = true;
    const attempts: number[] = [];
    const fetchPage = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => {
      attempts.push(pageParam);
      if (pageParam === 1 && failNext) {
        failNext = false;
        throw new Error('boom');
      }
      return { items: [`p${pageParam}`], next: pageParam < 1 ? pageParam + 1 : null } as Page;
    });
    const feed = createInfiniteQuery({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
      retry: 1,
    });

    const scope = fork();
    await allSettled(feed.start, { scope, params: undefined });
    await allSettled(feed.fetchNext, { scope });
    expect(attempts).toEqual([0, 1, 1]);
    expect(scope.getState(feed.$pages)).toHaveLength(2);
  });

  it('refetchAll retries a failed page of the window', async () => {
    let failOnce = false; // the warm-up loads cleanly; the reload is what fails
    const seen: number[] = [];
    const fetchPage = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => {
      seen.push(pageParam);
      if (pageParam === 1 && failOnce) {
        failOnce = false;
        throw new Error('boom');
      }
      return { items: [`p${pageParam}`], next: pageParam < 1 ? pageParam + 1 : null } as Page;
    });
    const feed = createInfiniteQuery({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
      retry: 1,
    });

    const scope = fork();
    await allSettled(feed.start, { scope, params: undefined });
    await allSettled(feed.fetchNext, { scope });
    expect(seen).toEqual([0, 1]);

    failOnce = true;
    await allSettled(feed.refetchAll, { scope });
    // page 1 fails once inside the reload and is replayed, so the window still lands
    expect(seen).toEqual([0, 1, 0, 1, 1]);
    expect(scope.getState(feed.$status)).toBe('done');
    expect(scope.getState(feed.$pages)).toHaveLength(2);
  });

  it('refetchAll: a 401 mid-window refreshes the token and replays that page', async () => {
    let token = 'fresh';
    const attempts: number[] = [];

    const refreshFx = createEffect(async () => {
      await tick();
      token = 'fresh';
    });
    const barrier = createBarrier({ perform: refreshFx });

    const fetchPage = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => {
      attempts.push(pageParam);
      if (token === 'stale') {
        scopeBind(barrier.lock, { safe: true })();
        throw new HttpError(401);
      }
      return { items: [`p${pageParam}`], next: pageParam < 1 ? pageParam + 1 : null } as Page;
    });

    const feed = createInfiniteQuery<void, number, Page, HttpError>({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
      barrier,
      retry: { times: 1, filter: ({ error }) => error.status === 401 },
    });

    const scope = fork();
    await allSettled(feed.start, { scope, params: undefined });
    await allSettled(feed.fetchNext, { scope });
    expect(attempts).toEqual([0, 1]);

    // the token goes stale right before the reload: page 0 401s, the barrier closes,
    // the refresh runs, and the replay goes out with the fresh token
    token = 'stale';
    await allSettled(feed.refetchAll, { scope });
    expect(attempts).toEqual([0, 1, 0, 0, 1]);
    expect(scope.getState(feed.$status)).toBe('done');
    expect(scope.getState(feed.$pages)).toHaveLength(2);
  });

  it('refetchAll honours retry.filter — an unretryable page fails the reload', async () => {
    const seen: number[] = [];
    let failAll = false;
    const fetchPage = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => {
      seen.push(pageParam);
      if (failAll) throw new HttpError(500);
      return { items: [`p${pageParam}`], next: null } as Page;
    });
    const feed = createInfiniteQuery<void, number, Page, HttpError>({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
      retry: { times: 3, filter: ({ error }) => error.status === 401 },
    });

    const scope = fork();
    await allSettled(feed.start, { scope, params: undefined });
    failAll = true;
    await allSettled(feed.refetchAll, { scope });

    expect(seen).toEqual([0, 0]); // one reload attempt, no replay
    expect(scope.getState(feed.$status)).toBe('fail');
    expect(scope.getState(feed.$pages)).toHaveLength(1); // previous window kept
  });

  it('timeout fails a slow page fetch (and the failure is retryable)', async () => {
    let calls = 0;
    const fetchPage = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => {
      calls++;
      if (calls === 1) await new Promise((r) => setTimeout(r, 60));
      return { items: [`p${pageParam}`], next: null } as Page;
    });
    const feed = createInfiniteQuery({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
      timeout: 10,
      retry: 1,
    });

    const scope = fork();
    await allSettled(feed.start, { scope, params: undefined });
    expect(calls).toBe(2); // first attempt timed out, the retry succeeded
    expect(scope.getState(feed.$status)).toBe('done');
  });
});
