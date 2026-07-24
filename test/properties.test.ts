import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createWatch, fork } from 'effector';
import { createQuery, type AbortReason } from '../src';
import { abortableDeferred } from './support/harness';
import { intBetween, mulberry32 } from './support/prng';

/**
 * Seeded property tests: each round derives its inputs from a PRNG seed and
 * the seed rides in every assertion message, so failures reproduce exactly.
 */

describe('property: TAKE_LATEST', () => {
  it('of a random burst, exactly the last run survives; the rest abort as "superseded"', async () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rand = mulberry32(seed);
      const burst = intBetween(rand, 2, 7);

      const d = abortableDeferred<number, string>();
      const query = createQuery({ effect: d.fx, concurrency: 'TAKE_LATEST' });
      const scope = fork();
      const reasons: AbortReason[] = [];
      createWatch({ unit: query.aborted, scope, fn: ({ reason }) => reasons.push(reason) });

      const runs = Array.from({ length: burst }, (_, i) => allSettled(query.start, { scope, params: i }));
      // all but the last are aborted on the wire already
      for (let i = 0; i < burst - 1; i++) {
        expect(d.signals[i].aborted, `seed ${seed}: run ${i}/${burst} must be aborted`).toBe(true);
      }
      expect(d.signals[burst - 1].aborted, `seed ${seed}: last run must fly`).toBe(false);

      // settle survivors in random order — only the last one lands in $data
      d.resolveAll(`v${burst - 1}`);
      await Promise.all(runs);

      expect(scope.getState(query.$data), `seed ${seed}`).toBe(`v${burst - 1}`);
      expect(reasons, `seed ${seed}`).toEqual(Array(burst - 1).fill('superseded'));
    }
  });

  it('with lanes, "exactly the last survives" holds per lane, never across lanes', async () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rand = mulberry32(seed);
      const lanes = intBetween(rand, 2, 3);
      const total = intBetween(rand, lanes, 8);
      // random lane assignment; ensure every lane occurs at least once
      const laneOf: number[] = Array.from({ length: total }, (_, i) =>
        i < lanes ? i : intBetween(rand, 0, lanes - 1),
      );

      const d = abortableDeferred<{ lane: number; n: number }, string>();
      const query = createQuery({
        effect: d.fx,
        concurrency: { strategy: 'TAKE_LATEST', key: ({ lane }) => String(lane) },
      });
      const scope = fork();

      const runs = laneOf.map((lane, n) => allSettled(query.start, { scope, params: { lane, n } }));

      // per lane: every run but the lane's last is aborted
      const lastOfLane = new Map<number, number>();
      laneOf.forEach((lane, n) => lastOfLane.set(lane, n));
      laneOf.forEach((lane, n) => {
        const shouldSurvive = lastOfLane.get(lane) === n;
        expect(d.signals[n].aborted, `seed ${seed}: run ${n} (lane ${lane}) aborted=${!shouldSurvive}`).toBe(
          !shouldSurvive,
        );
      });

      d.resolveAll('done');
      await Promise.all(runs);
    }
  });
});

describe('property: retry', () => {
  it('attempts === min(succeedAt, times + 1) for random budgets', async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = mulberry32(seed);
      const times = intBetween(rand, 0, 4); // retry budget
      const succeedAt = intBetween(rand, 1, 6); // which attempt would succeed

      let attempts = 0;
      const fx = createEffect(async (_: number) => {
        attempts++;
        if (attempts >= succeedAt) return 'ok';
        throw new Error(`fail#${attempts}`);
      });
      const query = createQuery({ effect: fx, retry: times });
      const scope = fork();

      await allSettled(query.start, { scope, params: 1 });

      const expected = Math.min(succeedAt, times + 1);
      expect(attempts, `seed ${seed}: times=${times} succeedAt=${succeedAt}`).toBe(expected);
      expect(scope.getState(query.$status), `seed ${seed}`).toBe(succeedAt <= times + 1 ? 'done' : 'fail');
    }
  });
});
