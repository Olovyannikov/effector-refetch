import { createEvent, createStore, sample, type Effect, type EventCallable, type Store } from 'effector';

export interface Barrier {
  /** Whether the barrier is currently closed (queries wait). */
  $locked: Store<boolean>;
  /** Close the barrier — queries that try to run will wait. */
  lock: EventCallable<void>;
  /** Open the barrier — queued/blocked queries proceed. */
  unlock: EventCallable<void>;
  __: {
    /** Resolves immediately if open, otherwise when the barrier next opens. */
    wait: () => Promise<void>;
  };
}

export interface CreateBarrierConfig {
  /**
   * Run once when the barrier closes (e.g. a token-refresh effect). The barrier
   * re-opens automatically when it settles (success OR failure — no deadlock).
   */
  perform?: Effect<void, any, any>;
}

/**
 * A mutex/barrier for "pausing the environment". Queries gated by it wait while
 * it's locked, then resume in order. The classic use: on a 401, `lock()` to run
 * a token refresh, then `unlock()` lets the queued requests continue.
 *
 *   const authBarrier = createBarrier({ perform: refreshTokenFx });
 *   const { createQuery } = createQueryFactory({ barrier: authBarrier });
 *   sample({ clock: api.finished.fail, filter: ({ error }) => error.status === 401, target: authBarrier.lock });
 *
 * Client-side mechanism: it reads the no-scope store, so it's meant for a single
 * running app (not per-`fork` isolation).
 */
export function createBarrier(config: CreateBarrierConfig = {}): Barrier {
  const $locked = createStore(false, { serialize: 'ignore' });
  const lock = createEvent();
  const unlock = createEvent();

  $locked.on(lock, () => true).on(unlock, () => false);

  if (config.perform) {
    // run `perform` when the barrier transitions to locked (re-locks are no-ops,
    // since the store value doesn't change), then re-open when it settles.
    // $performing gates the unlock: a SHARED perform effect settling from an
    // unrelated call must not unlock a barrier that never started it. (Settles
    // are not attributable per-call, so an unrelated settle arriving WHILE the
    // barrier's own run is in flight still unlocks — use a dedicated effect per
    // barrier when that matters.)
    const $performing = createStore(0, { serialize: 'ignore' });
    const launched = sample({ clock: $locked.updates, filter: (locked) => locked });
    $performing.on(launched, (n) => n + 1);
    sample({ clock: launched, target: config.perform });
    const settledOurs = sample({
      clock: config.perform.finally,
      source: $performing,
      filter: (n) => n > 0,
    });
    $performing.on(settledOurs, (n) => Math.max(0, n - 1));
    sample({ clock: settledOurs, target: unlock });
  }

  const wait = (): Promise<void> => {
    if (!$locked.getState()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const unwatch = $locked.watch((locked) => {
        if (!locked) {
          unwatch();
          resolve();
        }
      });
    });
  };

  return { $locked, lock, unlock, __: { wait } };
}
