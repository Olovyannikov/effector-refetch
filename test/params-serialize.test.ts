import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork, serialize } from 'effector';
import { createInfiniteQuery, createMutation, createQuery, dehydrate, hydrate, inMemoryCache } from '../src';

interface Params {
  from: Date;
}

/** The round trip a real app makes: server scope -> JSON over the wire -> client scope. */
function overTheWire(scope: ReturnType<typeof fork>) {
  return JSON.parse(JSON.stringify(serialize(scope))) as Record<string, unknown>;
}

const dateCodec = {
  write: (p: Params) => ({ from: p.from.toISOString() }),
  read: (j: { from: string }) => ({ from: new Date(j.from) }),
};

describe('paramsSerialize', () => {
  it('round-trips a Date through SSR instead of degrading it to a string', async () => {
    const fx = createEffect(async (_p: Params) => 'ok');
    const query = createQuery({ effect: fx, name: 'dated', paramsSerialize: dateCodec });

    const server = fork();
    await allSettled(query.start, { scope: server, params: { from: new Date('2026-01-02T03:04:05Z') } });
    const client = fork({ values: overTheWire(server) });

    const hydrated = client.getState(query.$params)!;
    expect(hydrated.from).toBeInstanceOf(Date);
    expect(hydrated.from.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('without it, the Date still degrades — the default is unchanged', async () => {
    const fx = createEffect(async (_p: Params) => 'ok');
    const query = createQuery({ effect: fx, name: 'plain' });

    const server = fork();
    await allSettled(query.start, { scope: server, params: { from: new Date('2026-01-02T03:04:05Z') } });
    const client = fork({ values: overTheWire(server) });

    expect(client.getState(query.$params)!.from).not.toBeInstanceOf(Date);
  });

  it('makes the SSR cache handoff actually hit', async () => {
    let calls = 0;
    const fx = createEffect(async (_p: Params) => {
      calls++;
      return 'ok';
    });
    const serverCache = inMemoryCache();
    const make = (adapter: ReturnType<typeof inMemoryCache>) =>
      createQuery({
        effect: fx,
        name: 'dated-cached',
        paramsSerialize: dateCodec,
        cache: { adapter, key: (p: Params) => `from:${String(p.from)}`, staleAfter: 60_000 },
      });
    const query = make(serverCache);

    const server = fork();
    await allSettled(query.start, { scope: server, params: { from: new Date('2026-01-02T03:04:05Z') } });
    const snapshot = await dehydrate(serverCache);
    const wire = overTheWire(server);

    await hydrate(serverCache, snapshot);
    const client = fork({ values: wire });
    calls = 0;
    await allSettled(query.start, { scope: client, params: client.getState(query.$params)! });

    expect(calls).toBe(0); // the entry the server warmed is found, not re-fetched
  });

  it("'ignore' keeps params out of the payload entirely", async () => {
    const fx = createEffect(async (_p: Params) => 'ok');
    const query = createQuery({ effect: fx, name: 'secret', paramsSerialize: 'ignore' });

    const server = fork();
    await allSettled(query.start, { scope: server, params: { from: new Date() } });

    expect(Object.keys(overTheWire(server))).not.toContain('er/secret/$params');
    expect(server.getState(query.$params)).not.toBe(null); // still live in this scope
  });

  it('the codec never sees the empty store', async () => {
    const seen: unknown[] = [];
    const fx = createEffect(async (_p: Params) => 'ok');
    const query = createQuery({
      effect: fx,
      name: 'guarded',
      paramsSerialize: {
        write: (p: Params) => {
          seen.push(p);
          return { from: p.from.toISOString() };
        },
        read: dateCodec.read,
      },
    });

    const empty = fork();
    overTheWire(empty); // never started: $params is null
    expect(seen).toEqual([]);

    const used = fork();
    await allSettled(query.start, { scope: used, params: { from: new Date('2026-01-02T03:04:05Z') } });
    overTheWire(used);
    expect(seen).toHaveLength(1);
  });

  it('works on a mutation', async () => {
    const fx = createEffect(async (_p: Params) => 'ok');
    const mutation = createMutation({ effect: fx, name: 'dated-mut', paramsSerialize: dateCodec });

    const server = fork();
    await allSettled(mutation.start, { scope: server, params: { from: new Date('2026-01-02T03:04:05Z') } });
    const client = fork({ values: overTheWire(server) });

    expect(client.getState(mutation.$params)!.from).toBeInstanceOf(Date);
  });

  it('works on an infinite query', async () => {
    const fx = createEffect(async (_a: { params: Params; pageParam: number }) => ({ items: ['a'] }));
    const feed = createInfiniteQuery<Params, number, { items: string[] }, Error>({
      effect: fx,
      name: 'dated-feed',
      initialPageParam: 0,
      getNextPageParam: () => null,
      paramsSerialize: dateCodec,
    });

    const server = fork();
    await allSettled(feed.start, { scope: server, params: { from: new Date('2026-01-02T03:04:05Z') } });
    const client = fork({ values: overTheWire(server) });

    expect(client.getState(feed.$params)!.from).toBeInstanceOf(Date);
  });
});
