import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { createQuery } from '../src';

function deferredQuery(config: Partial<Parameters<typeof createQuery>[0]> = {}) {
  const ctl: Array<{ res: (v: string) => void; rej: (e: unknown) => void }> = [];
  const fx = createEffect(
    (_p: string) =>
      new Promise<string>((res, rej) => {
        ctl.push({ res, rej });
      }),
  );
  return { query: createQuery({ effect: fx, ...(config as object) }), ctl };
}

describe('$isInitialLoading / $isRefetching', () => {
  it('first load: initial-loading, not refetching; after done: neither', async () => {
    const { query, ctl } = deferredQuery();
    const scope = fork();

    expect(scope.getState(query.$isInitialLoading)).toBe(false); // idle
    const p = allSettled(query.start, { scope, params: 'a' });
    expect(scope.getState(query.$isInitialLoading)).toBe(true);
    expect(scope.getState(query.$isRefetching)).toBe(false);

    ctl[0].res('data');
    await p;
    expect(scope.getState(query.$isInitialLoading)).toBe(false);
    expect(scope.getState(query.$isRefetching)).toBe(false);
  });

  it('refetch over real data: refetching, not initial-loading', async () => {
    const { query, ctl } = deferredQuery();
    const scope = fork();

    const p1 = allSettled(query.start, { scope, params: 'a' });
    ctl[0].res('data');
    await p1;

    const p2 = allSettled(query.refetch, { scope, params: 'a' });
    expect(scope.getState(query.$isInitialLoading)).toBe(false);
    expect(scope.getState(query.$isRefetching)).toBe(true);
    ctl[1].res('data-2');
    await p2;
    expect(scope.getState(query.$isRefetching)).toBe(false);
  });

  it('a retry after failure without data is still an initial load', async () => {
    const { query, ctl } = deferredQuery();
    const scope = fork();

    const p1 = allSettled(query.start, { scope, params: 'a' });
    ctl[0].rej(new Error('boom'));
    await p1;
    expect(scope.getState(query.$status)).toBe('fail');
    expect(scope.getState(query.$isInitialLoading)).toBe(false); // not pending

    const p2 = allSettled(query.start, { scope, params: 'a' });
    expect(scope.getState(query.$isInitialLoading)).toBe(true); // data is still null
    expect(scope.getState(query.$isRefetching)).toBe(false);
    ctl[1].res('data');
    await p2;
  });

  it('placeholderData does not count as real data', async () => {
    const { query, ctl } = deferredQuery({ placeholderData: 'skeleton' as never });
    const scope = fork();

    const p = allSettled(query.start, { scope, params: 'a' });
    expect(scope.getState(query.$data)).toBe('skeleton');
    expect(scope.getState(query.$isInitialLoading)).toBe(true); // placeholder shown, still loading
    expect(scope.getState(query.$isRefetching)).toBe(false);
    ctl[0].res('real');
    await p;
    expect(scope.getState(query.$isInitialLoading)).toBe(false);
  });

  it('initialData counts as real data: the first run is a refetch', async () => {
    const { query, ctl } = deferredQuery({ initialData: 'seeded' as never });
    const scope = fork();

    const p = allSettled(query.start, { scope, params: 'a' });
    expect(scope.getState(query.$isInitialLoading)).toBe(false);
    expect(scope.getState(query.$isRefetching)).toBe(true);
    ctl[0].res('fresh');
    await p;
  });

  it('after reset the next start is an initial load again', async () => {
    const { query, ctl } = deferredQuery();
    const scope = fork();

    const p1 = allSettled(query.start, { scope, params: 'a' });
    ctl[0].res('data');
    await p1;

    await allSettled(query.reset, { scope });
    const p2 = allSettled(query.start, { scope, params: 'a' });
    expect(scope.getState(query.$isInitialLoading)).toBe(true);
    ctl[1].res('data-2');
    await p2;
  });

  it('is exposed through @@unitShape', () => {
    const { query } = deferredQuery();
    const shape = query['@@unitShape']();
    expect(query.$isInitialLoading).toBeDefined();
    expect(query.$isRefetching).toBeDefined();
    expect(shape.isInitialLoading).toBe(query.$isInitialLoading);
    expect(shape.isRefetching).toBe(query.$isRefetching);
  });
});
