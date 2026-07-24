import { describe, it, expect } from 'vitest';
import { allSettled, createWatch, fork } from 'effector';
import { createQuery, createRequestFx, type AbortReason } from '../src';

/** Abort-aware effect: resolves via `resolvers`, rejects when its signal aborts. */
function laneEffect() {
  const signals: AbortSignal[] = [];
  const resolvers: Array<(v: string) => void> = [];
  const fx = createRequestFx<{ id: number; v?: string }, string>(
    (_p, { signal }) =>
      new Promise<string>((res, rej) => {
        signals.push(signal);
        resolvers.push(res);
        signal.addEventListener('abort', () => rej(new Error('aborted')));
      }),
  );
  return { fx, signals, resolvers };
}

const byId = ({ id }: { id: number }) => String(id);

describe('concurrency lanes', () => {
  it('TAKE_LATEST supersedes only within its lane', async () => {
    const { fx, signals, resolvers } = laneEffect();
    const query = createQuery({
      effect: fx,
      concurrency: { strategy: 'TAKE_LATEST', key: byId },
    });
    const scope = fork();

    const p1 = allSettled(query.start, { scope, params: { id: 1 } });
    const p2 = allSettled(query.start, { scope, params: { id: 2 } }); // other lane
    expect(signals.length).toBe(2);
    expect(signals[0].aborted).toBe(false); // lane 1 untouched by lane 2's start
    expect(signals[1].aborted).toBe(false);

    const p3 = allSettled(query.start, { scope, params: { id: 2 } }); // supersede lane 2
    expect(signals.length).toBe(3);
    expect(signals[0].aborted).toBe(false); // lane 1 still untouched
    expect(signals[1].aborted).toBe(true); // superseded within lane 2
    expect(signals[2].aborted).toBe(false);

    resolvers[0]('one');
    resolvers[2]('two');
    await Promise.all([p1, p2, p3]);
    expect(scope.getState(query.$status)).toBe('done');
  });

  it('a stale settle from another lane does not clobber the winning lane result', async () => {
    const { fx, resolvers } = laneEffect();
    const query = createQuery({
      effect: fx,
      concurrency: { strategy: 'TAKE_LATEST', key: byId },
    });
    const scope = fork();

    const p1 = allSettled(query.start, { scope, params: { id: 1 } });
    const p2 = allSettled(query.start, { scope, params: { id: 2 } });

    resolvers[1]('lane2'); // lane 2 settles first
    resolvers[0]('lane1'); // lane 1 settles later — still current in ITS lane
    await Promise.all([p1, p2]);
    // both lanes were current -> the later settle wins the (single) $data store
    expect(scope.getState(query.$data)).toBe('lane1');
  });

  it('TAKE_FIRST drops only same-lane duplicates while busy', async () => {
    const { fx, signals, resolvers } = laneEffect();
    const query = createQuery({
      effect: fx,
      concurrency: { strategy: 'TAKE_FIRST', key: byId },
    });
    const scope = fork();
    const reasons: AbortReason[] = [];
    createWatch({ unit: query.aborted, scope, fn: ({ reason }) => reasons.push(reason) });

    const p1 = allSettled(query.start, { scope, params: { id: 1 } });
    const p2 = allSettled(query.start, { scope, params: { id: 1 } }); // same lane -> dropped
    const p3 = allSettled(query.start, { scope, params: { id: 2 } }); // other lane -> runs

    expect(signals.length).toBe(2);
    expect(reasons).toEqual(['take-first-busy']);

    resolvers.forEach((r, i) => r(`v${i}`));
    await Promise.all([p1, p2, p3]);
  });

  it('cancel aborts all lanes and pending settles report "cancelled"', async () => {
    const { fx, signals } = laneEffect();
    const query = createQuery({
      effect: fx,
      concurrency: { strategy: 'TAKE_LATEST', key: byId },
    });
    const scope = fork();
    const reasons: AbortReason[] = [];
    createWatch({ unit: query.aborted, scope, fn: ({ reason }) => reasons.push(reason) });

    const p1 = allSettled(query.start, { scope, params: { id: 1 } });
    const p2 = allSettled(query.start, { scope, params: { id: 2 } });
    await allSettled(query.cancel, { scope });

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(true);
    await Promise.all([p1, p2]);
    expect(reasons).toEqual(['cancelled', 'cancelled']);
  });

  it('the standalone concurrency() operator accepts a lane key', async () => {
    const { fx, signals, resolvers } = laneEffect();
    const { concurrency } = await import('../src');
    const query = concurrency(createQuery({ effect: fx }), {
      strategy: 'TAKE_LATEST',
      key: byId,
    });
    const scope = fork();

    const p1 = allSettled(query.start, { scope, params: { id: 1 } });
    const p2 = allSettled(query.start, { scope, params: { id: 2 } });
    expect(signals[0].aborted).toBe(false);

    resolvers.forEach((r, i) => r(`v${i}`));
    await Promise.all([p1, p2]);
  });
});

describe('aborted reasons (no lanes)', () => {
  it('supersede reports "superseded", explicit cancel reports "cancelled"', async () => {
    const { fx, resolvers } = laneEffect();
    const query = createQuery({ effect: fx, concurrency: 'TAKE_LATEST' });
    const scope = fork();
    const reasons: AbortReason[] = [];
    createWatch({ unit: query.aborted, scope, fn: ({ reason }) => reasons.push(reason) });

    // superseded: first run replaced by the second, its abort settles as 'superseded'
    const p1 = allSettled(query.start, { scope, params: { id: 1 } });
    const p2 = allSettled(query.start, { scope, params: { id: 2 } });
    resolvers[1]('winner');
    await Promise.all([p1, p2]);
    expect(reasons).toEqual(['superseded']);

    // cancelled
    const p3 = allSettled(query.start, { scope, params: { id: 3 } });
    await allSettled(query.cancel, { scope });
    await p3;
    expect(reasons).toEqual(['superseded', 'cancelled']);
  });

  it('disabled gate reports "disabled"', async () => {
    const { fx } = laneEffect();
    const { createStore } = await import('effector');
    const $enabled = createStore(false);
    const query = createQuery({ effect: fx, enabled: $enabled });
    const scope = fork();
    const reasons: AbortReason[] = [];
    createWatch({ unit: query.aborted, scope, fn: ({ reason }) => reasons.push(reason) });

    await allSettled(query.start, { scope, params: { id: 1 } });
    expect(reasons).toEqual(['disabled']);
  });
});
