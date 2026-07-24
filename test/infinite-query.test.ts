import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { createInfiniteQuery } from '../src';

interface Page {
  items: string[];
  next: number | null;
}

function makeQuery() {
  const fetchPage = createEffect(
    async ({ params, pageParam }: { params: { q: string }; pageParam: number }): Promise<Page> => ({
      items: [`${params.q}-${pageParam}`],
      next: pageParam < 2 ? pageParam + 1 : null,
    }),
  );
  const query = createInfiniteQuery({
    effect: fetchPage,
    initialPageParam: 0,
    getNextPageParam: ({ lastPage }) => lastPage.next,
  });
  return query;
}

describe('createInfiniteQuery', () => {
  it('start loads the first page', async () => {
    const query = makeQuery();
    const scope = fork();
    await allSettled(query.start, { scope, params: { q: 'a' } });

    expect(scope.getState(query.$pages)).toEqual([{ items: ['a-0'], next: 1 }]);
    expect(scope.getState(query.$pageParams)).toEqual([0]);
    expect(scope.getState(query.$hasNextPage)).toBe(true);
    expect(scope.getState(query.$status)).toBe('done');
  });

  it('supports void params (offset-only pagination, no public params)', async () => {
    const fetchPage = createEffect(
      async ({ pageParam }: { params: void; pageParam: number }): Promise<Page> => ({
        items: [`p-${pageParam}`],
        next: pageParam < 1 ? pageParam + 1 : null,
      }),
    );
    const query = createInfiniteQuery({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
    });
    const scope = fork();
    await allSettled(query.start, { scope, params: undefined });
    await allSettled(query.fetchNext, { scope });

    expect(scope.getState(query.$pages).flatMap((p) => p.items)).toEqual(['p-0', 'p-1']);
    expect(scope.getState(query.$status)).toBe('done');
  });

  it('fetchNext appends pages until exhausted', async () => {
    const query = makeQuery();
    const scope = fork();
    await allSettled(query.start, { scope, params: { q: 'a' } });
    await allSettled(query.fetchNext, { scope });
    await allSettled(query.fetchNext, { scope });

    expect(scope.getState(query.$pageParams)).toEqual([0, 1, 2]);
    expect(scope.getState(query.$pages).flatMap((p) => p.items)).toEqual(['a-0', 'a-1', 'a-2']);
    expect(scope.getState(query.$hasNextPage)).toBe(false); // page 2 has next: null
  });

  it('fetchNext is a no-op when there is no next page', async () => {
    let calls = 0;
    const fetchPage = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => {
      calls++;
      return { items: [`p${pageParam}`], next: null as number | null };
    });
    const query = createInfiniteQuery({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
    });
    const scope = fork();
    await allSettled(query.start, { scope, params: undefined });
    expect(calls).toBe(1);
    await allSettled(query.fetchNext, { scope }); // no next -> ignored
    expect(calls).toBe(1);
    expect(scope.getState(query.$hasNextPage)).toBe(false);
  });

  it('start resets accumulated pages; scopes are isolated', async () => {
    const query = makeQuery();

    const a = fork();
    await allSettled(query.start, { scope: a, params: { q: 'a' } });
    await allSettled(query.fetchNext, { scope: a });
    expect(scope_len(a)).toBe(2);

    // a fresh scope starts empty
    const b = fork();
    expect(b.getState(query.$pages)).toEqual([]);
    await allSettled(query.start, { scope: b, params: { q: 'b' } });
    expect(b.getState(query.$pages).flatMap((p) => p.items)).toEqual(['b-0']);

    // restarting in scope a resets to one page
    await allSettled(query.start, { scope: a, params: { q: 'a2' } });
    expect(scope_len(a)).toBe(1);
    expect(a.getState(query.$pages)[0].items).toEqual(['a2-0']);

    function scope_len(s: typeof a) {
      return s.getState(query.$pages).length;
    }
  });

  it('reset clears everything', async () => {
    const query = makeQuery();
    const scope = fork();
    await allSettled(query.start, { scope, params: { q: 'a' } });
    await allSettled(query.reset, { scope });
    expect(scope.getState(query.$pages)).toEqual([]);
    expect(scope.getState(query.$hasNextPage)).toBe(false);
  });
});
