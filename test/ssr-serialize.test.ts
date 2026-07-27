import { describe, it, expect, vi, afterEach } from 'vitest';
import { allSettled, createEffect, fork, serialize } from 'effector';
import { createInfiniteQuery, createQuery } from '../src';

/**
 * SSR store-layer transfer: the engine assigns explicit stable sids to the
 * PUBLIC stores (er/<name>/$data, …), so `serialize(scope)` works without the
 * effector babel/SWC plugin — which never processes a prebuilt node_modules
 * dist. Internal stores are `serialize: 'ignore'`, so serialize stays silent.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SSR: serialize(scope) carries query state', () => {
  it('transfers $data/$status via serialize -> fork({ values }), no effect re-run', async () => {
    let calls = 0;
    const fx = createEffect(async (id: number) => {
      calls++;
      return { id, name: `user-${id}` };
    });
    const query = createQuery({ effect: fx, name: 'ssr-user' });

    // server
    const server = fork();
    await allSettled(query.start, { scope: server, params: 7 });
    const values = serialize(server);

    expect(values['er/ssr-user/$data']).toEqual({ id: 7, name: 'user-7' });
    expect(values['er/ssr-user/$status']).toBe('done');
    expect(values['er/ssr-user/$params']).toBe(7);

    // client — state restored purely from values, the effect never runs again
    const client = fork({ values });
    expect(client.getState(query.$data)).toEqual({ id: 7, name: 'user-7' });
    expect(client.getState(query.$status)).toBe('done');
    expect(client.getState(query.$state).status).toBe('done'); // union derives too
    expect(calls).toBe(1);
  });

  it('serialize(scope) after a run is free of "store should have sid" noise', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fx = createEffect(async (id: number) => id * 2);
    const query = createQuery({ effect: fx, name: 'quiet', retry: 0, cache: false });
    const scope = fork();
    await allSettled(query.start, { scope, params: 1 });

    serialize(scope);
    const sidComplaints = errors.mock.calls.filter((args) =>
      args.some((a) => typeof a === 'string' && a.includes('should have sid')),
    );
    expect(sidComplaints).toEqual([]);
  });

  it('anonymous queries still serialize (counter sids) within one bundle', async () => {
    const fx = createEffect(async () => 'anon');
    const query = createQuery({ effect: fx });
    const scope = fork();
    await allSettled(query.start, { scope, params: undefined });

    const values = serialize(scope);
    const key = Object.keys(values).find((k) => /^er\/q\d+\/\$data$/.test(k));
    expect(key).toBeDefined();
    expect(values[key!]).toBe('anon');
  });

  it('infinite query: $infinite window and $params transfer', async () => {
    const fx = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => ({
      items: [pageParam],
      next: pageParam + 1,
    }));
    const inf = createInfiniteQuery({
      name: 'ssr-feed',
      effect: fx,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => (lastPage as { next: number }).next,
    });

    const server = fork();
    await allSettled(inf.start, { scope: server, params: undefined });
    await allSettled(inf.fetchNext, { scope: server });
    const values = serialize(server);

    const client = fork({ values });
    expect(client.getState(inf.$pages)).toHaveLength(2);
    expect(client.getState(inf.$pages)).toEqual([
      { items: [0], next: 1 },
      { items: [1], next: 2 },
    ]);
  });
});
