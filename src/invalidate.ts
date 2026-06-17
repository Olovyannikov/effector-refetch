import { is, merge, sample, type Effect, type Event } from 'effector';
import type { Mutation, Query } from './types';

type AnyQuery = Query<any, any, any, any>;
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
