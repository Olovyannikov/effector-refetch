import { createEffect, createStore, sample, type Event, type EventCallable, type Store } from 'effector';
import type { QueryStatus } from '../types';

/**
 * Polling subsystem (`refetchInterval`). After each settle, if the interval is
 * positive and the query is enabled + started, wait then refresh with the last
 * params. A token (`$pollId`) keeps a single live timer (no doubling) and lets
 * `reset` stop it. Disabling pauses polling; re-enabling (`enabled` false -> true)
 * resumes it without needing a fresh `start`.
 *
 * Pure leaf wiring: it observes `finished.*` and drives `refresh`/`reset` — it
 * never feeds back into the core request graph, so it lives outside the engine.
 */
export interface PollingContext<Params> {
  finishedDone: Event<{ params: Params; result: unknown }>;
  finishedFail: Event<{ params: Params; error: unknown }>;
  refresh: EventCallable<Params>;
  reset: Event<void>;
  $intervalMs: Store<number>;
  $enabled: Store<boolean>;
  $params: Store<Params | null>;
  $status: Store<QueryStatus>;
  nm: (suffix: string) => { name: string } | undefined;
  evName: (suffix: string) => string | undefined;
}

export function setupPolling<Params>(ctx: PollingContext<Params>): void {
  const { finishedDone, finishedFail, refresh, reset, $intervalMs, $enabled, $params, $status, nm, evName } =
    ctx;

  const $pollId = createStore(0, nm('$pollId'));
  const pollSleepFx = createEffect<
    { ms: number; payload: { id: number; params: Params | null } },
    { id: number; params: Params | null }
  >({
    name: evName('pollSleepFx'),
    handler: ({ ms, payload }) => new Promise((res) => setTimeout(() => res(payload), ms)),
  });

  // re-enabling (false -> true) resumes polling without waiting for a fresh start/settle.
  // If a request is in flight when this fires, its own finish reschedules and the token
  // ($pollId) supersedes this timer, so there's no doubling.
  const enabledTurnedOn = sample({ clock: $enabled, filter: (en) => en });

  const pollScheduled = sample({
    clock: [finishedDone, finishedFail, enabledTurnedOn],
    source: { id: $pollId, ms: $intervalMs, en: $enabled, params: $params, status: $status },
    filter: ({ ms, en, status }) => ms > 0 && en && status !== 'initial',
    fn: ({ id, ms, params }) => ({ id: id + 1, ms, params }),
  });
  $pollId.on(pollScheduled, (_i, s) => s.id);
  $pollId.on(reset, (i) => i + 1); // invalidate any pending poll
  sample({
    clock: pollScheduled,
    fn: (s) => ({ ms: s.ms, payload: { id: s.id, params: s.params } }),
    target: pollSleepFx,
  });
  sample({
    clock: pollSleepFx.doneData,
    source: { id: $pollId, en: $enabled, ms: $intervalMs },
    filter: ({ id, en, ms }, p) => en && ms > 0 && p.id === id,
    fn: (_s, p) => p.params as Params,
    target: refresh,
  });
}
