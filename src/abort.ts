import { allSettled, type EventCallable, type Scope } from 'effector';

export interface AttachToAbortSignalConfig {
  /** The outside signal — a router's / framework's `AbortController.signal`. */
  signal: AbortSignal;
  /**
   * Fired when the signal aborts — typically `query.cancel`, a factory's `cancel`,
   * or any void event of your own.
   */
  target: EventCallable<void> | ReadonlyArray<EventCallable<void>>;
  /**
   * Fire inside this scope. In SSR one `fork()` is one request with one abort
   * controller, which is exactly the granularity an external signal has.
   *
   * Omit it ONLY in an app that never calls `fork()`. With a scope in play, a
   * scope-less event never reaches that scope's state, so the bridge would look
   * wired and quietly cancel nothing.
   */
  scope?: Scope;
}

export interface AbortSignalBridge {
  /** Detach the listener — for when the work finished before the signal did. */
  dispose: () => void;
  /**
   * The signal was ALREADY aborted at attach time. An aborted signal never emits
   * `abort` again, so there is nothing left to wait for: guard on this and skip the
   * work, otherwise a request whose client is already gone is served in full.
   */
  aborted: boolean;
}

/**
 * Bridge an outside `AbortSignal` to effector events — the missing half of
 * cancellation, since a query owns the signal it hands its own handler but has no
 * way to hear a router's:
 *
 *   loader: async ({ abortController, params }) => {
 *     const scope = fork();
 *     const { aborted, dispose } = attachToAbortSignal({
 *       signal: abortController.signal,
 *       target: query.cancel,
 *       scope,
 *     });
 *     // the client may already be gone — starting here would fetch for nobody
 *     if (aborted) return { values: serialize(scope) };
 *
 *     await allSettled(query.start, { scope, params });
 *     dispose();
 *     return { values: serialize(scope) };
 *   }
 *
 * Never put the signal in the query's params instead: `$params` is serialized
 * state, so it would reach the SSR payload and the framework's serializer throws.
 */
export function attachToAbortSignal(config: AttachToAbortSignalConfig): AbortSignalBridge {
  const { signal, target, scope } = config;
  const targets: ReadonlyArray<EventCallable<void>> = Array.isArray(target) ? target : [target];

  let fired = false;
  const fire = () => {
    // an AbortSignal fires once, but `dispose` + a manual call must not double-fire
    if (fired) return;
    fired = true;
    for (const unit of targets) {
      // `allSettled` (not `scopeBind`, which would work too) because it resolves once
      // the scope has settled — the cancel is driven from outside the graph
      // fire-and-forget: a rejected run must not surface as an unhandled rejection
      if (scope) void allSettled(unit, { scope }).catch(() => {});
      else unit();
    }
  };

  // an ALREADY aborted signal never emits 'abort', so a plain listener would wait
  // forever. Firing now covers a run attached to late; `aborted` is what covers the
  // common case — there is no run yet, and the caller must not start one.
  if (signal.aborted) {
    fire();
    return { dispose: () => {}, aborted: true };
  }

  signal.addEventListener('abort', fire, { once: true });
  return { dispose: () => signal.removeEventListener('abort', fire), aborted: false };
}
