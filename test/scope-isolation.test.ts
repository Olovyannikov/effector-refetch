import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { createQuery, createRequestFx } from '../src';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function waitUntil(cond: () => boolean) {
  for (let i = 0; i < 20 && !cond(); i++) await tick();
}

/** Abort-aware effect that only settles when its signal aborts (rejects). */
function abortableEffect() {
  const signals: AbortSignal[] = [];
  const fx = createRequestFx<number, string>(
    (_p, { signal }) =>
      new Promise<string>((_res, rej) => {
        signals.push(signal);
        signal.addEventListener('abort', () => rej(new Error('aborted')));
      }),
  );
  return { fx, signals };
}

describe('scope isolation of in-flight runs', () => {
  it("cancel in one scope does not abort another scope's in-flight run", async () => {
    const { fx, signals } = abortableEffect();
    const query = createQuery({ effect: fx });
    const scopeA = fork();
    const scopeB = fork();

    const pA = allSettled(query.start, { scope: scopeA, params: 1 });
    const pB = allSettled(query.start, { scope: scopeB, params: 2 });
    expect(signals.length).toBe(2);

    await allSettled(query.cancel, { scope: scopeA });
    expect(signals[0].aborted).toBe(true); // scope A's own run
    expect(signals[1].aborted).toBe(false); // scope B untouched

    await allSettled(query.cancel, { scope: scopeB });
    await Promise.all([pA, pB]);
  });

  it('TAKE_LATEST supersedes only within its own scope', async () => {
    const { fx, signals } = abortableEffect();
    const query = createQuery({ effect: fx, concurrency: 'TAKE_LATEST' });
    const scopeA = fork();
    const scopeB = fork();

    const pA = allSettled(query.start, { scope: scopeA, params: 1 });
    // a new run in scope B must NOT abort scope A's in-flight request
    const pB = allSettled(query.start, { scope: scopeB, params: 2 });
    expect(signals.length).toBe(2);
    expect(signals[0].aborted).toBe(false);
    expect(signals[1].aborted).toBe(false);

    // superseding within scope B aborts only B's previous run
    const pB2 = allSettled(query.start, { scope: scopeB, params: 3 });
    expect(signals.length).toBe(3);
    expect(signals[0].aborted).toBe(false); // scope A still running
    expect(signals[1].aborted).toBe(true); // superseded in B
    expect(signals[2].aborted).toBe(false);

    await allSettled(query.cancel, { scope: scopeA });
    await allSettled(query.cancel, { scope: scopeB });
    await Promise.all([pA, pB, pB2]);
  });

  it('dedupe does not coalesce identical requests across scopes', async () => {
    let calls = 0;
    const resolvers: Array<(v: string) => void> = [];
    const fx = createEffect((_p: number) => {
      calls++;
      return new Promise<string>((res) => resolvers.push(res));
    });
    const query = createQuery({ effect: fx, concurrency: 'TAKE_EVERY', cache: { dedupe: true } });
    const scopeA = fork();
    const scopeB = fork();

    const pA = allSettled(query.start, { scope: scopeA, params: 1 });
    await waitUntil(() => calls >= 1); // A's request is in flight

    // same key, different scope -> must run its own request, not be dropped
    const pB = allSettled(query.start, { scope: scopeB, params: 1 });
    await waitUntil(() => calls >= 2);
    expect(calls).toBe(2);

    // within one scope the coalescing still applies
    const pA2 = allSettled(query.start, { scope: scopeA, params: 1 });
    await tick();
    expect(calls).toBe(2);

    resolvers.forEach((r, i) => r(`v${i}`));
    await Promise.all([pA, pB, pA2]);
    expect(scopeA.getState(query.$data)).toBe('v0');
    expect(scopeB.getState(query.$data)).toBe('v1');
  });
});
