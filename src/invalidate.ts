import { createEvent, is, merge, sample, type Effect, type Event } from 'effector';
import type { Mutation, Query } from './types';

type AnyQuery = Query<any, any, any, any>;

/**
 * Cross-module invalidation by tag — no query imports needed at the call site.
 * Fire it with one tag or an array; every query created with a matching `tags`
 * entry purges its cache namespace and — if it has run — refetches with its
 * last params. Tagged infinite queries re-fetch all accumulated pages.
 * Scope-correct: `allSettled(invalidateTag, { scope, params: 'todos' })`.
 *
 *   const todosQuery = createQuery({ effect: fetchTodosFx, tags: ['todos'] });
 *   invalidate({ on: addTodo, refetch: [] }); // or simply:
 *   sample({ clock: addTodo.finished.done, fn: () => 'todos', target: invalidateTag });
 */
export const invalidateTag = createEvent<string | string[]>('invalidateTag');

/** @internal One of the payload tags is declared on the unit. */
export function matchesTag(payload: string | string[], tags: readonly string[]): boolean {
  return (Array.isArray(payload) ? payload : [payload]).some((tag) => tags.includes(tag));
}

/** @internal Wire a query's `tags` config to {@link invalidateTag} (called by `createQuery`). */
export function wireTagInvalidation(query: AnyQuery, tags: readonly string[]): void {
  // refetch with the last params — only if the query has ever run
  sample({
    clock: invalidateTag,
    source: { params: query.$params, status: query.$status },
    filter: ({ status }, payload) => status !== 'initial' && matchesTag(payload, tags),
    fn: ({ params }) => params,
    target: query.refetch,
  });
  // purge the cache namespace unconditionally: prefetch-warmed entries and entries
  // under OTHER params must not survive the invalidation (scope-aware seam)
  sample({
    clock: invalidateTag,
    filter: (payload) => matchesTag(payload, tags),
    fn: () => undefined,
    target: query.__.purgeFx,
  });
}
type Trigger = AnyQuery | Mutation<any, any, any, any> | Event<any> | Effect<any, any, any>;

function toEvent(trigger: Trigger): Event<any> {
  if (trigger && typeof trigger === 'object' && 'finished' in trigger) {
    // Query or Mutation -> fire on successful completion
    return (trigger as { finished: { done: Event<any> } }).finished.done;
  }
  if (is.effect(trigger)) return trigger.done;
  if (is.event(trigger)) return trigger;
  throw new TypeError('invalidate: `on` must be a Query, Mutation, Event or Effect');
}

export interface InvalidateConfig {
  /** What triggers invalidation: a Mutation/Query (its success), an Event or an Effect. */
  on: Trigger | Trigger[];
  /** Queries to re-run (with their last params, bypassing cache freshness). */
  refetch: AnyQuery | AnyQuery[];
  /** Optionally gate on the trigger payload (e.g. mutation `{ params, result }`). */
  filter?: (payload: any) => boolean;
}

/**
 * Refetch queries when something succeeds — typically a mutation.
 *
 *   invalidate({ on: createTodoMutation, refetch: todosQuery });
 *
 * A query is only refetched if it has run at least once (status !== 'initial'),
 * and it re-runs with its last params, bypassing cache freshness.
 */
export function invalidate(config: InvalidateConfig): void {
  const triggers = (Array.isArray(config.on) ? config.on : [config.on]).map(toEvent);
  const queries = Array.isArray(config.refetch) ? config.refetch : [config.refetch];
  if (triggers.length === 0 || queries.length === 0) return; // nothing to wire (parity with keepFresh)
  const clock = triggers.length === 1 ? triggers[0] : merge(triggers);
  const { filter } = config;

  for (const query of queries) {
    sample({
      clock,
      source: { params: query.$params, status: query.$status },
      filter: ({ status }: { params: unknown; status: string }, payload: unknown) =>
        status !== 'initial' && (filter ? filter(payload) : true),
      fn: ({ params }: { params: unknown; status: string }) => params,
      target: query.refetch,
    });
  }
}
