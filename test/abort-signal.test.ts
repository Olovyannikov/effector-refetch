import { describe, it, expect } from 'vitest';
import { allSettled, fork, scopeBind } from 'effector';
import { attachToAbortSignal, createQuery, createQueryFactory } from '../src';
import { abortableDeferred } from './support/harness';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('attachToAbortSignal', () => {
  it('cancels the query in the given scope when the signal aborts', async () => {
    const { fx, signals } = abortableDeferred<number, string>();
    const query = createQuery({ effect: fx });
    const scope = fork();
    const ac = new AbortController();
    attachToAbortSignal({ signal: ac.signal, target: query.cancel, scope });

    const run = allSettled(query.start, { scope, params: 1 });
    expect(signals[0].aborted).toBe(false);

    ac.abort();
    await tick();

    expect(signals[0].aborted).toBe(true);
    await run;
    expect(scope.getState(query.$pending)).toBe(false);
  });

  it('reports an already-aborted signal, so the caller can skip the work entirely', async () => {
    let calls = 0;
    const query = createQuery({ handler: async (n: number) => `v${n}` });
    const scope = fork();
    const ac = new AbortController();
    ac.abort(); // the client went away before the loader got going

    const { aborted } = attachToAbortSignal({ signal: ac.signal, target: query.cancel, scope });
    expect(aborted).toBe(true);

    // the loader guards on it — nothing runs for a client that is already gone
    if (!aborted) {
      calls++;
      await allSettled(query.start, { scope, params: 1 });
    }
    expect(calls).toBe(0);
    expect(scope.getState(query.$status)).toBe('initial');
  });

  it('reports a live signal as not aborted', () => {
    const query = createQuery({ handler: async (n: number) => n });
    const ac = new AbortController();

    const { aborted } = attachToAbortSignal({ signal: ac.signal, target: query.cancel, scope: fork() });

    expect(aborted).toBe(false);
  });

  it('still cancels a run that is already in flight when attached late', async () => {
    const { fx, signals } = abortableDeferred<number, string>();
    const query = createQuery({ effect: fx });
    const scope = fork();
    const ac = new AbortController();
    ac.abort();

    const run = allSettled(query.start, { scope, params: 1 });
    attachToAbortSignal({ signal: ac.signal, target: query.cancel, scope });
    await tick();

    expect(signals[0].aborted).toBe(true);
    await run;
  });

  it('fans out to several targets', async () => {
    const a = abortableDeferred<number, string>();
    const b = abortableDeferred<number, string>();
    const qa = createQuery({ effect: a.fx });
    const qb = createQuery({ effect: b.fx });
    const scope = fork();
    const ac = new AbortController();
    attachToAbortSignal({ signal: ac.signal, target: [qa.cancel, qb.cancel], scope });

    const runs = Promise.all([
      allSettled(qa.start, { scope, params: 1 }),
      allSettled(qb.start, { scope, params: 2 }),
    ]);
    ac.abort();
    await tick();

    expect(a.signals[0].aborted).toBe(true);
    expect(b.signals[0].aborted).toBe(true);
    await runs;
  });

  it('dispose() detaches — a later abort does nothing', async () => {
    const { fx, signals } = abortableDeferred<number, string>();
    const query = createQuery({ effect: fx });
    const scope = fork();
    const ac = new AbortController();
    const { dispose } = attachToAbortSignal({ signal: ac.signal, target: query.cancel, scope });

    const run = allSettled(query.start, { scope, params: 1 });
    dispose();
    ac.abort();
    await tick();

    expect(signals[0].aborted).toBe(false);
    await allSettled(query.cancel, { scope });
    await run;
  });

  it('cancels only the scope it was bound to', async () => {
    const { fx, signals } = abortableDeferred<number, string>();
    const query = createQuery({ effect: fx });
    const scopeA = fork();
    const scopeB = fork();
    const ac = new AbortController();
    attachToAbortSignal({ signal: ac.signal, target: query.cancel, scope: scopeA });

    const runA = allSettled(query.start, { scope: scopeA, params: 1 });
    const runB = allSettled(query.start, { scope: scopeB, params: 2 });
    expect(signals).toHaveLength(2);

    ac.abort();
    await tick();

    expect(signals[0].aborted).toBe(true); // scopeA's run
    expect(signals[1].aborted).toBe(false); // scopeB untouched
    await runA;
    await allSettled(query.cancel, { scope: scopeB });
    await runB;
  });

  it('works without a scope (client-side, no fork)', async () => {
    const query = createQuery({ handler: async (n: number) => n });
    const ac = new AbortController();
    let cancelled = 0;
    query.cancel.watch(() => cancelled++);
    attachToAbortSignal({ signal: ac.signal, target: query.cancel });

    ac.abort();
    await tick();

    expect(cancelled).toBe(1);
  });
});

describe('factory.cancel', () => {
  it('cancels every query the factory created', async () => {
    const a = abortableDeferred<number, string>();
    const b = abortableDeferred<number, string>();
    const factory = createQueryFactory();
    const qa = factory.createQuery({ effect: a.fx, name: 'a' });
    const qb = factory.createQuery({ effect: b.fx, name: 'b' });
    const scope = fork();

    const runs = Promise.all([
      allSettled(qa.start, { scope, params: 1 }),
      allSettled(qb.start, { scope, params: 2 }),
    ]);
    await allSettled(factory.cancel, { scope });

    expect(a.signals[0].aborted).toBe(true);
    expect(b.signals[0].aborted).toBe(true);
    await runs;
  });

  it('needs no predicate: idle queries are untouched, so cancelling all is free', async () => {
    const a = abortableDeferred<number, string>();
    const b = abortableDeferred<number, string>();
    const factory = createQueryFactory();
    const qa = factory.createQuery({ effect: a.fx, name: 'ran' });
    const qb = factory.createQuery({ effect: b.fx, name: 'idle' });
    const scope = fork();

    const run = allSettled(qa.start, { scope, params: 1 });
    await allSettled(factory.cancel, { scope });
    await run;

    expect(a.signals[0].aborted).toBe(true);
    expect(b.signals).toHaveLength(0); // never started — nothing to cancel
    expect(scope.getState(qb.$status)).toBe('initial');
  });

  it('narrowing is just cancelling the one query', async () => {
    const a = abortableDeferred<number, string>();
    const b = abortableDeferred<number, string>();
    const factory = createQueryFactory();
    const qa = factory.createQuery({ effect: a.fx, name: 'keep' });
    const qb = factory.createQuery({ effect: b.fx, name: 'drop' });
    const scope = fork();

    const runs = Promise.all([
      allSettled(qa.start, { scope, params: 1 }),
      allSettled(qb.start, { scope, params: 2 }),
    ]);
    // fire WITHOUT awaiting: `a` stays in flight on purpose, and allSettled would
    // wait for the whole scope to settle
    scopeBind(qb.cancel, { scope })();
    await tick();

    expect(a.signals[0].aborted).toBe(false);
    expect(b.signals[0].aborted).toBe(true);

    a.resolve(0, 'done');
    await runs;
  });

  it('bridges a loader abort to the whole factory', async () => {
    const a = abortableDeferred<number, string>();
    const factory = createQueryFactory();
    const query = factory.createQuery({ effect: a.fx });
    const scope = fork();
    const ac = new AbortController();
    attachToAbortSignal({ signal: ac.signal, target: factory.cancel, scope });

    const run = allSettled(query.start, { scope, params: 1 });
    ac.abort();
    await tick();

    expect(a.signals[0].aborted).toBe(true);
    await run;
  });
});
