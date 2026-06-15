/**
 * Circuit breaker on top of a barrier. After THRESHOLD consecutive failures the
 * breaker "opens": gated runs pause for a cooldown (instead of hammering a failing
 * backend), then a trial wave runs — a fresh failure re-opens it, a success closes
 * it. No new API: a barrier + a failure counter.
 *
 * Run: npx tsx examples/circuit-breaker.ts
 */
import { allSettled, createEffect, createStore, fork, sample } from 'effector';
import { applyBarrier, createBarrier, createQuery } from '../src';

const THRESHOLD = 3;
const COOLDOWN = 300; // ms (small for the demo)

// Flaky backend: fails the first 4 calls, then succeeds.
let attempt = 0;
const fetchItemFx = createEffect(async (id: number) => {
  attempt += 1;
  if (attempt <= 4) throw new Error(`boom #${attempt}`);
  return { id, name: `item-${id}` };
});

export const itemQuery = createQuery({ effect: fetchItemFx });

// The "open" window: locking runs the cooldown, then the barrier auto-reopens.
const cooldownFx = createEffect(() => new Promise<void>((r) => setTimeout(r, COOLDOWN)));
const breaker = createBarrier({ perform: cooldownFx });

const $failures = createStore(0)
  .on(itemQuery.finished.fail, (n) => n + 1)
  .reset(itemQuery.finished.done);

sample({ clock: $failures.updates, filter: (n) => n >= THRESHOLD, target: breaker.lock });

applyBarrier(itemQuery, breaker);

async function main() {
  const scope = fork();
  // Note: `allSettled` waits for the whole computation — including `cooldownFx` —
  // so by the time each call resolves the cooldown has already elapsed and the
  // barrier has re-opened (`open=false` at the checkpoints). The trip still
  // happened: `failures` reaching THRESHOLD is what ran the cooldown.
  const tick = (label: string) =>
    console.log(
      `${label}: status=${scope.getState(itemQuery.$status)}`,
      `failures=${scope.getState($failures)}`,
      `open=${scope.getState(breaker.$locked)}`,
    );

  // three failures trip the breaker
  for (let i = 0; i < THRESHOLD; i++) await allSettled(itemQuery.start, { scope, params: 1 });
  tick('after threshold');

  // these runs pause for the cooldown, then retry (half-open); the last one succeeds
  for (let i = 0; i < 3; i++) await allSettled(itemQuery.start, { scope, params: 1 });
  tick('after recovery');
  console.log('data:', scope.getState(itemQuery.$data));
}

main().catch((e) => console.error('demo failed:', e));
