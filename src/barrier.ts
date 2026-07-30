import {
  attach,
  createEvent,
  createStore,
  sample,
  type Effect,
  type EventCallable,
  type Store,
} from 'effector';

export interface Barrier {
  /** Whether the barrier is currently closed (queries wait). */
  $locked: Store<boolean>;
  /** Close the barrier — queries that try to run will wait. */
  lock: EventCallable<void>;
  /** Open the barrier — queued/blocked queries proceed. */
  unlock: EventCallable<void>;
  __: {
    /**
     * Resolves immediately if open, otherwise when the barrier next opens *in the
     * scope that called it*. It's an effect, so a caller inside another effect's
     * handler stays on that scope (and can `scopeBind` it across an `await`).
     */
    waitFx: Effect<void, void>;
    /** @deprecated call `waitFx` (kept so older callers keep compiling). */
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

/** Per-scope list of pending `waitFx` resolvers (`null` = not created for this scope yet). */
interface Waiters {
  list: Array<() => void>;
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
 * Fork-safe: both the lock flag and the queue of waiting runs live in stores, so
 * concurrent scopes (SSR requests, tests) block and release independently. Locking
 * it from outside effector's call stack — an HTTP layer that saw a 401, an SDK
 * callback — needs `scopeBind(barrier.lock)`, otherwise the call lands on the
 * scope-less app and the scoped queries never see it.
 */
export function createBarrier(config: CreateBarrierConfig = {}): Barrier {
  const $locked = createStore(false, { serialize: 'ignore' });
  const lock = createEvent();
  const unlock = createEvent();

  $locked.on(lock, () => true).on(unlock, () => false);

  // Waiters are a mutable container held in a store, created lazily PER SCOPE: a
  // plain object literal in the initial value would be shared by every fork.
  const $waiters = createStore<Waiters | null>(null, { serialize: 'ignore' });
  const ensureWaiters = createEvent();
  $waiters.on(ensureWaiters, (current) => current ?? { list: [] });

  const waitFx = attach({
    source: { locked: $locked, waiters: $waiters },
    effect: ({ locked, waiters }) => {
      if (!locked) return;
      // `ensureWaiters` below runs in the pure phase of this very call, before the
      // effect reads its source — so the container exists by now
      return new Promise<void>((resolve) => waiters?.list.push(resolve));
    },
  }) as Effect<void, void>;
  // create this scope's container before the effect reads it (pure priority first)
  sample({ clock: waitFx, target: ensureWaiters });

  // barrier opened -> release everyone waiting IN THIS SCOPE
  const releaseFx = attach({
    source: $waiters,
    effect: (waiters) => {
      if (!waiters) return;
      for (const resolve of waiters.list.splice(0, waiters.list.length)) resolve();
    },
  });
  sample({ clock: $locked.updates, filter: (locked) => !locked, target: releaseFx });

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

  return { $locked, lock, unlock, __: { waitFx, wait: () => waitFx() } };
}
