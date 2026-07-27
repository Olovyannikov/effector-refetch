import { createEvent, createStore } from 'effector';
import type { ConcurrencyStrategy } from './types';

/**
 * Runtime query defaults, applied to every query that did NOT set the option
 * explicitly. Precedence (highest first):
 *
 *   1. the query's own config — inline option, `Store` option, or a standalone
 *      operator (incl. `createQueryFactory` defaults);
 *   2. `$queryDefaults`;
 *   3. built-ins (TAKE_LATEST, no retry, staleAfter Infinity, no timeout).
 *
 * Because it's a plain store read at run time, it is fork-correct by
 * construction — override per scope for SSR or tests:
 *
 *   const scope = fork({ values: [[$queryDefaults, { timeout: 5_000, retry: 2 }]] });
 *
 * or patch it in the running app (merge semantics):
 *
 *   setQueryDefaults({ retry: 1 });
 */
export interface QueryDefaults {
  /** Default concurrency strategy for queries that didn't pick one. */
  concurrency?: ConcurrencyStrategy;
  /** Default retry count (delay 0, all failures, intermediate errors suppressed). */
  retry?: number;
  /** Default cache freshness window (ms) for cached queries without `staleAfter`. */
  staleAfter?: number;
  /** Default per-attempt deadline (ms). */
  timeout?: number;
}

export const $queryDefaults = createStore<QueryDefaults>(
  {},
  { name: 'refetch/$queryDefaults', sid: 'er/$queryDefaults' },
);

/** Merge a patch into `$queryDefaults` (pass `undefined` values to keep, use a fresh fork value to clear). */
export const setQueryDefaults = createEvent<QueryDefaults>('refetch/setQueryDefaults');
$queryDefaults.on(setQueryDefaults, (prev, patch) => ({ ...prev, ...patch }));
