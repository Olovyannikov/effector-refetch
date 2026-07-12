import { createEvent, sample, type Effect, type Event, type Store } from 'effector';

/**
 * Introspection subsystem: the lifecycle event stream consumed by the devtools
 * panels and `attachQueryLogger`. Pure leaf wiring — it samples core events into
 * dedicated `inspect.*` events and never feeds back into the request graph.
 *
 * Returns the five events it creates; the caller assembles them with the public
 * `finished.*` / `aborted` events into the full `QueryInspect` object.
 */
export interface IntrospectionContext<Params, Error> {
  requested: Event<{ params: Params; mapped: unknown; fresh: boolean }>;
  // Done/Error generics are irrelevant here (used only as a clock for its params);
  // `any` avoids effector's invariant `use` check on the Effect's result type.
  runFx: Effect<{ runId: number; params: Params; mapped: unknown; timeoutMs: number }, any, Error>;
  cacheHit: Event<{ params: Params; result: unknown }>;
  lookupDone: Event<{ fresh: boolean; params: Params; entry: unknown }>;
  scheduleRetry: Event<{ runId: number; params: Params; mapped: unknown; error: Error; timeoutMs: number }>;
  $attempts: Store<number>;
  evName: (suffix: string) => string | undefined;
}

export function setupIntrospection<Params, Error>(ctx: IntrospectionContext<Params, Error>) {
  const { requested, runFx, cacheHit, lookupDone, scheduleRetry, $attempts, evName } = ctx;

  const inspectStart = createEvent<{ params: Params }>(evName('inspect.start'));
  const inspectRun = createEvent<{ params: Params; attempt: number }>(evName('inspect.run'));
  const inspectCacheHit = createEvent<{ params: Params }>(evName('inspect.cacheHit'));
  const inspectCacheMiss = createEvent<{ params: Params }>(evName('inspect.cacheMiss'));
  const inspectRetry = createEvent<{ params: Params; attempt: number; error: Error }>(
    evName('inspect.retry'),
  );

  sample({ clock: requested, fn: ({ params }) => ({ params }), target: inspectStart });
  sample({
    clock: runFx,
    source: $attempts,
    fn: (attempt, run) => ({ params: run.params, attempt }),
    target: inspectRun,
  });
  sample({ clock: cacheHit, fn: ({ params }) => ({ params }), target: inspectCacheHit });
  sample({
    clock: lookupDone,
    filter: ({ fresh }) => !fresh,
    fn: ({ params }) => ({ params }),
    target: inspectCacheMiss,
  });
  sample({
    clock: scheduleRetry,
    source: $attempts,
    fn: (attempt, s) => ({ params: s.params, attempt, error: s.error }),
    target: inspectRetry,
  });

  return { inspectStart, inspectRun, inspectCacheHit, inspectCacheMiss, inspectRetry };
}
