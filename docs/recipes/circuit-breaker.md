# Circuit breaker

A [barrier](/recipes/auth-barrier) is a mutex you can `lock` and `unlock`; gated queries wait while
it's locked. That's all you need for a **circuit breaker**: after N consecutive failures, trip the
breaker so requests stop hammering a failing backend, wait out a cooldown, then let a trial wave
through — a fresh failure re-opens it, a success closes it.

No new API — it's a barrier plus a failure counter.

```ts
import { createEffect, createStore, sample } from 'effector';
import { createBarrier, applyBarrier } from 'effector-refetch';

const THRESHOLD = 3; // consecutive failures that trip the breaker
const COOLDOWN = 10_000; // ms the circuit stays "open"

// The "open" window: locking runs the cooldown effect, and the barrier re-opens
// automatically when it settles (createBarrier unlocks on `perform.finally`).
const cooldownFx = createEffect(() => new Promise<void>((r) => setTimeout(r, COOLDOWN)));
const breaker = createBarrier({ perform: cooldownFx });

// Count consecutive failures; any success resets to 0 (→ closed).
const $failures = createStore(0)
  .on(api.finished.fail, (n) => n + 1)
  .reset(api.finished.done);

// Trip when the threshold is reached. A re-lock while already open is a no-op
// (the store value doesn't change), so the cooldown isn't restarted mid-window.
sample({ clock: $failures.updates, filter: (n) => n >= THRESHOLD, target: breaker.lock });

applyBarrier(api, breaker); // or: createQuery({ effect, barrier: breaker })
```

## How it behaves

- **Closed** — `$failures < THRESHOLD`, requests run normally.
- **Open** — the threshold trips `breaker.lock`; gated runs **pause** (they `await` the barrier),
  so a struggling backend stops getting hammered. `cooldownFx` runs for `COOLDOWN`, then the barrier
  unlocks.
- **Half-open** — the paused request(s) resume. Because `$failures` is still `≥ THRESHOLD`, a single
  fresh failure immediately re-trips the breaker (another cooldown); the first **success** resets
  the counter and closes it.

`breaker.$locked` is the "open" flag — bind it with `useUnit` to show a "service unavailable, retrying
in a moment" banner.

::: tip Pause vs fail-fast
A textbook breaker _fails fast_ while open; this one **pauses** requests until the cooldown elapses,
then retries them. For a query layer that's usually what you want (no error flash, automatic
recovery). If you need fail-fast, sample `breaker.$locked` into a guard that rejects instead.
:::

## Across several queries

Share one breaker over a group — feed it the merged failures and gate each query:

```ts
import { merge } from 'effector';

const anyFailure = merge([usersQuery.finished.fail, ordersQuery.finished.fail]);
const $failures = createStore(0)
  .on(anyFailure, (n) => n + 1)
  .reset([usersQuery.finished.done, ordersQuery.finished.done]);

[usersQuery, ordersQuery].forEach((q) => applyBarrier(q, breaker));
```

Half-open releases every queued request together (fine for the typical one-in-flight-per-query case);
for a strict single-trial half-open, add your own gate that lets just one request through after the
cooldown. Runnable:
[`examples/circuit-breaker.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/circuit-breaker.ts).
