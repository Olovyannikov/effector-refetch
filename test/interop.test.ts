import { describe, it, expect } from 'vitest';
import { allSettled, fork } from 'effector';
import { createQuery, createRequestFx } from '../src';
import { withTanstackCache, type TanstackQueryClientLike } from '../src/tanstack';
import { apolloHandler, type ApolloClientLike } from '../src/apollo';

/** Fake TanStack QueryClient: caches by stringified key, counts real fetches. */
function fakeQueryClient() {
  const cache = new Map<string, { value: unknown; at: number }>();
  let fetches = 0;
  const client: TanstackQueryClientLike = {
    async fetchQuery({ queryKey, queryFn, staleTime = 0 }) {
      const key = JSON.stringify(queryKey);
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < staleTime) return hit.value as never;
      fetches++;
      const value = await queryFn();
      cache.set(key, { value, at: Date.now() });
      return value as never;
    },
  };
  return { client, stats: () => ({ fetches, entries: cache.size }) };
}

describe('effector-refetch/tanstack', () => {
  it('routes runs through the client and serves fresh entries from its cache', async () => {
    const { client, stats } = fakeQueryClient();
    let handlerCalls = 0;
    const fx = createRequestFx(
      withTanstackCache(
        () => client,
        async (id: number) => {
          handlerCalls++;
          return `user-${id}`;
        },
        { queryKey: (id) => ['user', id], staleTime: 60_000 },
      ),
    );
    const query = createQuery({ effect: fx });
    const scope = fork();

    await allSettled(query.start, { scope, params: 1 });
    await allSettled(query.start, { scope, params: 1 }); // fresh -> served from TanStack cache
    await allSettled(query.start, { scope, params: 2 }); // other key -> real fetch

    expect(scope.getState(query.$data)).toBe('user-2');
    expect(handlerCalls).toBe(2);
    expect(stats()).toEqual({ fetches: 2, entries: 2 });
  });

  it('forwards the run AbortSignal into the wrapped handler', async () => {
    const { client } = fakeQueryClient();
    const signals: AbortSignal[] = [];
    const fx = createRequestFx(
      withTanstackCache(
        () => client,
        (_id: number, ctx) =>
          new Promise<string>((_res, rej) => {
            signals.push(ctx!.signal);
            ctx!.signal.addEventListener('abort', () => rej(new Error('aborted')));
          }),
        { queryKey: (id) => ['slow', id] },
      ),
    );
    const query = createQuery({ effect: fx });
    const scope = fork();

    const p = allSettled(query.start, { scope, params: 1 });
    expect(signals[0].aborted).toBe(false);
    await allSettled(query.cancel, { scope });
    expect(signals[0].aborted).toBe(true);
    await p;
  });

  it('defaults the queryKey to ["effector-refetch", params]', async () => {
    const keys: unknown[] = [];
    const client: TanstackQueryClientLike = {
      async fetchQuery({ queryKey, queryFn }) {
        keys.push(queryKey);
        return queryFn() as never;
      },
    };
    const handler = withTanstackCache(
      () => client,
      async (id: number) => id,
    );
    await handler(7);
    expect(keys).toEqual([['effector-refetch', 7]]);
  });
});

describe('effector-refetch/apollo', () => {
  function fakeApollo(result: unknown) {
    const calls: Array<Record<string, unknown>> = [];
    const client: ApolloClientLike = {
      async query(options) {
        calls.push(options as Record<string, unknown>);
        return { data: result as never };
      },
    };
    return { client, calls };
  }

  it('runs the document through client.query and unwraps data', async () => {
    const { client, calls } = fakeApollo({ user: { name: 'ada' } });
    const DOC = { kind: 'Document' };
    const fx = createRequestFx(
      apolloHandler<number, { user: { name: string } }>(() => client, {
        document: DOC,
        variables: (id) => ({ id }),
        fetchPolicy: 'network-only',
      }),
    );
    const query = createQuery({ effect: fx });
    const scope = fork();

    await allSettled(query.start, { scope, params: 42 });

    expect(scope.getState(query.$data)).toEqual({ user: { name: 'ada' } });
    expect(calls[0].query).toBe(DOC);
    expect(calls[0].variables).toEqual({ id: 42 });
    expect(calls[0].fetchPolicy).toBe('network-only');
    // the run's AbortSignal travels through Apollo's HTTP link fetchOptions
    const ctx = calls[0].context as { fetchOptions: { signal?: AbortSignal } };
    expect(ctx.fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts a per-params document function', async () => {
    const { client, calls } = fakeApollo({ ok: true });
    const handler = apolloHandler<string, { ok: boolean }>(() => client, {
      document: (name: string) => ({ kind: 'Document', name }),
    });
    await handler('a');
    await handler('b');
    expect(calls.map((c) => (c.query as { name: string }).name)).toEqual(['a', 'b']);
  });
});
