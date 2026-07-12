// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createRoot } from 'solid-js';
import { createEffect } from 'effector';
import { createQuery } from '../src';
import { useQuery } from '../src/solid';

/** Wait until `predicate` holds (signals flush on the microtask/macrotask queue). */
async function until(predicate: () => boolean) {
  for (let i = 0; i < 40 && !predicate(); i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe('useQuery — Solid binding', () => {
  it('exposes reactive accessors and a bound start trigger', async () => {
    const fx = createEffect(async (id: number) => `user-${id}`);
    const query = createQuery({ effect: fx });

    await new Promise<void>((resolve, reject) => {
      createRoot(async (dispose) => {
        try {
          const q = useQuery(query);

          // initial
          expect(q.status()).toBe('initial');
          expect(q.isInitial()).toBe(true);
          expect(q.data()).toBe(null);
          expect(q.pending()).toBe(false);
          expect(q.isInitialLoading()).toBe(false);
          expect(q.isRefetching()).toBe(false);

          // start -> pending -> done, accessors track it
          q.start(3);
          await until(() => q.status() === 'done');

          expect(q.status()).toBe('done');
          expect(q.isDone()).toBe(true);
          expect(q.isPending()).toBe(false);
          expect(q.data()).toBe('user-3');
          expect(q.params()).toBe(3);
          expect(q.isInitialLoading()).toBe(false);
          expect(q.isRefetching()).toBe(false);

          dispose();
          resolve();
        } catch (e) {
          dispose();
          reject(e);
        }
      });
    });
  });

  it('reflects failures and resets', async () => {
    const fx = createEffect(async (): Promise<number> => {
      throw new Error('boom');
    });
    const query = createQuery({ effect: fx });

    await new Promise<void>((resolve, reject) => {
      createRoot(async (dispose) => {
        try {
          const q = useQuery(query);
          q.start();
          await until(() => q.status() === 'fail');
          expect(q.isFail()).toBe(true);
          expect((q.error() as Error)?.message).toBe('boom');

          q.reset();
          await until(() => q.status() === 'initial');
          expect(q.status()).toBe('initial');
          expect(q.error()).toBe(null);

          dispose();
          resolve();
        } catch (e) {
          dispose();
          reject(e);
        }
      });
    });
  });
});
