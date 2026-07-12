import { createWatch, type Scope, type Unit } from 'effector';
import { stableStringify } from './utils';
import type { Query } from './types';

export type QueryLogType =
  | 'start'
  | 'run'
  | 'done'
  | 'fail'
  | 'aborted'
  | 'cache-hit'
  | 'cache-miss'
  | 'retry';

export interface QueryLogEntry {
  query: string;
  type: QueryLogType;
  params?: unknown;
  attempt?: number;
  error?: unknown;
  /** Milliseconds from the last `run` with these params to this `done`/`fail`. */
  durationMs?: number;
}

export interface QueryLoggerOptions {
  /** Label for the `query` field. Default: 'query'. */
  name?: string;
  /** Receives each entry. Default: console.log. */
  handler?: (entry: QueryLogEntry) => void;
  /** Clock, overridable in tests. Default: () => Date.now(). */
  now?: () => number;
  /**
   * Observe only this fork's events. Without it the logger is global — events
   * from every scope (and the scope-less app) land in the same log, and
   * `durationMs` can pair runs across scopes when their params collide.
   */
  scope?: Scope;
}

/**
 * Subscribe to a query's lifecycle and emit structured log entries
 * (start → run → done/fail/abort, plus cache hit/miss and retries) with
 * per-run duration. Returns an unsubscribe function.
 *
 * Durations are tracked per params (keyed by their stable JSON): concurrent
 * `TAKE_EVERY` runs with different params don't clobber each other, and a retry
 * overwrites its own key — `durationMs` measures from the last attempt.
 *
 *   const stop = attachQueryLogger(todosQuery, { name: 'todos' });
 */
export function attachQueryLogger(
  query: Query<any, any, any, any>,
  options: QueryLoggerOptions = {},
): () => void {
  const {
    name = 'query',
    handler = (e) => console.log('[effector-refetch]', e),
    now = () => Date.now(),
    scope,
  } = options;
  const { inspect } = query.__;

  const runAt = new Map<string, number>();
  const emit = (entry: QueryLogEntry) => handler(entry);
  const durationOf = (params: unknown): number | undefined => {
    const key = stableStringify(params);
    const at = runAt.get(key);
    runAt.delete(key);
    return at == null ? undefined : now() - at;
  };

  const watch = <T>(unit: Unit<T>, fn: (payload: T) => void) => createWatch({ unit, fn, scope });

  const subs = [
    watch<{ params: unknown }>(inspect.start, ({ params }) => emit({ query: name, type: 'start', params })),
    watch<{ params: unknown; attempt: number }>(inspect.run, ({ params, attempt }) => {
      runAt.set(stableStringify(params), now());
      emit({ query: name, type: 'run', params, attempt });
    }),
    watch<{ params: unknown }>(inspect.cacheHit, ({ params }) =>
      emit({ query: name, type: 'cache-hit', params }),
    ),
    watch<{ params: unknown }>(inspect.cacheMiss, ({ params }) =>
      emit({ query: name, type: 'cache-miss', params }),
    ),
    watch<{ params: unknown; attempt: number; error: unknown }>(inspect.retry, ({ params, attempt, error }) =>
      emit({ query: name, type: 'retry', params, attempt, error }),
    ),
    watch<{ params: unknown }>(inspect.done, ({ params }) =>
      emit({ query: name, type: 'done', params, durationMs: durationOf(params) }),
    ),
    watch<{ params: unknown; error: unknown }>(inspect.fail, ({ params, error }) =>
      emit({ query: name, type: 'fail', params, error, durationMs: durationOf(params) }),
    ),
    watch<{ params: unknown }>(inspect.aborted, ({ params }) =>
      emit({ query: name, type: 'aborted', params }),
    ),
  ];

  return () => {
    subs.forEach((s) => s());
    runAt.clear();
  };
}
