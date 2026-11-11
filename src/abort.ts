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
   * It must be `allSettled`, not `scopeBind`: the latter loses the fork context
   * across the run chain, so the cancel would land outside the scope that owns
   * the in-flight runs.
   */
  scope?: Scope;
}

/**
 * Bridge an outside `AbortSignal` to effector events — the missing half of
 * cancellation, since a query owns the signal it hands its own handler but has no
 * way to hear a router's:
 *
 *   loader: async ({ abortController, params }) => {
 *     const scope = fork();
 *     attachToAbortSignal({ signal: abortController.signal, target: query.cancel, scope });
 *     await allSettled(query.start, { scope, params });
 *     return { values: serialize(scope) };
 *   }
 *
 * Never put the signal in the query's params instead: `$params` is serialized
 * state, so it would reach the SSR payload and the framework's serializer throws.
 *
 * Returns a dispose function that detaches the listener — call it when the work
 * finished on its own and the signal outlives it.
 */
export function attachToAbortSignal(config: AttachToAbortSignalConfig): () => void {
  const { signal, target, scope } = config;
  const targets: ReadonlyArray<EventCallable<void>> = Array.isArray(target) ? target : [target];

  let fired = false;
  const fire = () => {
    // an AbortSignal fires once, but `dispose` + a manual call must not double-fire
    if (fired) return;
    fired = true;
    for (const unit of targets) {
      // fire-and-forget: a rejected run must not surface as an unhandled rejection
      if (scope) void allSettled(unit, { scope }).catch(() => {});
      else unit();
    }
  };

  // an ALREADY aborted signal never emits 'abort' — the listener alone would
  // silently never run, which is the trap this helper exists to remove
  if (signal.aborted) {
    fire();
    return () => {};
  }

  signal.addEventListener('abort', fire, { once: true });
  return () => signal.removeEventListener('abort', fire);
}
