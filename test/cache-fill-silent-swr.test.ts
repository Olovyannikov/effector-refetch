import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createWatch, fork } from 'effector';
import { createQuery } from '../src';
import { abortableDeferred } from './support/harness';

const tick = () => new Promise((r) => setTimeout(r, 0));
// staleness must ACTUALLY elapse: tick() can complete in under 1ms on a fast
// runner, leaving a staleAfter: 1 entry fresh and skipping the revalidation
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('cache: fillOnAbort', () => {
  it('a superseded run is not aborted and its result warms the cache', async () => {
    const d = abortableDeferred<number, string>();
    const query = createQuery({
      effect: d.fx,
      concurrency: 'TAKE_LATEST',
      cache: { fillOnAbort: true },
    });
    const scope = fork();

    const p1 = allSettled(query.start, { scope, params: 1 });
    await tick(); // the cache lookup is async — the effect starts a tick later
    const p2 = allSettled(query.start, { scope, params: 2 }); // supersedes run 1
    await tick();
    expect(d.signals[0].aborted).toBe(false); // fillOnAbort: kept flying

    d.resolve(0, 'almost-finished-v1'); // the superseded run completes anyway
    d.resolve(1, 'v2');
    await Promise.all([p1, p2]);
    expect(scope.getState(query.$data)).toBe('v2'); // current run owns the data

    // run 1's response landed in the cache: same params resolve without the effect
    const callsBefore = d.started.length;
    await allSettled(query.start, { scope, params: 1 });
    expect(d.started.length).toBe(callsBefore); // cache hit, no new call
    expect(scope.getState(query.$data)).toBe('almost-finished-v1');
  });

  it('without fillOnAbort the superseded run is aborted (default behavior)', async () => {
    const d = abortableDeferred<number, string>();
    const query = createQuery({ effect: d.fx, concurrency: 'TAKE_LATEST', cache: true });
    const scope = fork();

    const p1 = allSettled(query.start, { scope, params: 1 });
    await tick();
    const p2 = allSettled(query.start, { scope, params: 2 });
    await tick();
    expect(d.signals[0].aborted).toBe(true);

    d.resolve(1, 'v2');
    await Promise.all([p1, p2]);
  });

  it('explicit cancel still aborts for real even with fillOnAbort', async () => {
    const d = abortableDeferred<number, string>();
    const query = createQuery({ effect: d.fx, cache: { fillOnAbort: true } });
    const scope = fork();

    const p = allSettled(query.start, { scope, params: 1 });
    await tick(); // let the async cache lookup dispatch the run
    const pc = allSettled(query.cancel, { scope });
    await tick();
    expect(d.signals[0].aborted).toBe(true); // cancel means cancel
    await Promise.all([p, pc]);
  });
});

describe('cache: silent SWR', () => {
  it('a failed revalidation keeps serving stale silently; finished.fail still fires', async () => {
    let failNow = false;
    const fx = createEffect(async (n: number) => {
      if (failNow) throw new Error('revalidation down');
      return `v${n}`;
    });
    const query = createQuery({
      effect: fx,
      cache: { staleAfter: 1, swr: { silent: true } },
    });
    const scope = fork();
    const fails: string[] = [];
    createWatch({
      unit: query.finished.fail,
      scope,
      fn: ({ error }) => fails.push((error as Error).message),
    });

    await allSettled(query.start, { scope, params: 1 }); // seed the cache
    await sleep(5); // let staleAfter: 1 elapse for real

    failNow = true;
    await allSettled(query.start, { scope, params: 1 }); // stale serve + failed revalidation

    expect(scope.getState(query.$data)).toBe('v1'); // stale stays on screen
    expect(scope.getState(query.$status)).toBe('done'); // no error state
    expect(scope.getState(query.$error)).toBeNull();
    expect(fails).toEqual(['revalidation down']); // observers still learn the truth
  });

  it('non-silent SWR keeps the current behavior: revalidation failure hits the stores', async () => {
    let failNow = false;
    const fx = createEffect(async (n: number) => {
      if (failNow) throw new Error('boom');
      return `v${n}`;
    });
    const query = createQuery({ effect: fx, cache: { staleAfter: 1, swr: true } });
    const scope = fork();

    await allSettled(query.start, { scope, params: 1 });
    await sleep(5);

    failNow = true;
    await allSettled(query.start, { scope, params: 1 });

    expect(scope.getState(query.$status)).toBe('fail');
    expect((scope.getState(query.$error) as Error).message).toBe('boom');
    expect(scope.getState(query.$data)).toBe('v1'); // stale data still kept
  });

  it('a non-SWR failure with silent config is NOT silenced (only revalidations are)', async () => {
    const fx = createEffect(async (): Promise<string> => {
      throw new Error('plain failure');
    });
    const query = createQuery({ effect: fx, cache: { swr: { silent: true } } });
    const scope = fork();

    await allSettled(query.start, { scope, params: undefined });

    expect(scope.getState(query.$status)).toBe('fail'); // no stale entry -> a real failure
  });
});
