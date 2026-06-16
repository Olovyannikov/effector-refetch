import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createEvent, createStore, fork } from 'effector';
import { createQuery, retry, cache, concurrency, keepFresh, inMemoryCache } from '../src';

// Specifies (and pins) what happens when an operator of the same type is applied
// more than once to a single query — see ROADMAP "1.0 — exit criteria".
describe('applying an operator more than once', () => {
  describe('last-wins (engine setters)', () => {
    it('retry: the last call replaces the previous config', async () => {
      let calls = 0;
      const fx = createEffect(async (): Promise<number> => {
        calls++;
        throw new Error('always');
      });
      const q = createQuery({ effect: fx });
      retry(q, { times: 1, delay: 0 });
      retry(q, { times: 3, delay: 0 }); // wins: 3 retries

      const scope = fork();
      await allSettled(q.start, { scope });
      expect(calls).toBe(4); // 1 initial + 3 retries (not 2 from the first call)
      expect(scope.getState(q.$status)).toBe('fail');
    });

    it('cache: the last adapter replaces the previous one', async () => {
      const first = inMemoryCache();
      const second = inMemoryCache();
      let calls = 0;
      const fx = createEffect(async (id: number) => {
        calls++;
        return id;
      });
      const q = createQuery({ effect: fx });
      cache(q, { adapter: first });
      cache(q, { adapter: second }); // wins

      const scope = fork();
      await allSettled(q.start, { scope, params: 1 });
      expect(calls).toBe(1);
      // the active adapter is `second`; `first` was replaced and never written to
      expect(second.dump?.().length).toBe(1);
      expect(first.dump?.().length).toBe(0);
    });

    it('concurrency: the last strategy wins (TAKE_FIRST drops a concurrent start)', async () => {
      const release: Array<(v: number) => void> = [];
      const fx = createEffect(() => new Promise<number>((res) => release.push(res)));
      const q = createQuery({ effect: fx });
      concurrency(q, { strategy: 'TAKE_EVERY' });
      concurrency(q, { strategy: 'TAKE_FIRST' }); // wins

      const scope = fork();
      const p1 = allSettled(q.start, { scope, params: undefined });
      const p2 = allSettled(q.start, { scope, params: undefined }); // dropped while busy
      release.forEach((r) => r(1));
      await Promise.all([p1, p2]);

      // TAKE_FIRST means only the first run ever executed
      expect(release.length).toBe(1);
    });
  });

  describe('additive (wiring per call)', () => {
    it('keepFresh: every registered source triggers a refetch', async () => {
      let runs = 0;
      const fx = createEffect(async (n: number) => {
        runs++;
        return n;
      });
      const q = createQuery({ effect: fx });

      const setA = createEvent<number>();
      const $a = createStore(0).on(setA, (_s, v) => v);
      const setB = createEvent<number>();
      const $b = createStore(0).on(setB, (_s, v) => v);

      keepFresh(q, { source: $a });
      keepFresh(q, { source: $b }); // additive: both stay live

      const scope = fork();
      await allSettled(q.start, { scope, params: 1 });
      expect(runs).toBe(1);

      await allSettled(setA, { scope, params: 1 });
      expect(runs).toBe(2); // $a change refetched

      await allSettled(setB, { scope, params: 2 });
      expect(runs).toBe(3); // $b change also refetched
    });
  });
});
