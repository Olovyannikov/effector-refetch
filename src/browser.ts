import { allSettled, createEvent, sample, type EventCallable, type Scope, type Store } from 'effector';
import { createBarrier, type Barrier } from './barrier';
import type { Query } from './types';

type AnyQuery = Query<any, any, any, any>;

const noop = () => {};

function onWindow(event: string, handler: () => void): () => void {
  if (typeof window === 'undefined') return noop;
  window.addEventListener(event, handler);
  return () => window.removeEventListener(event, handler);
}

// One `fired` event + `sample` per (query, window event) — effector graph nodes cannot be
// removed, so per-call wiring would leak when subscribing on every component mount.
// Subscriptions differ only in their DOM listener (and scope), which IS removable.
const wiring = new WeakMap<AnyQuery, Map<string, EventCallable<void>>>();

function firedFor(query: AnyQuery, event: string): EventCallable<void> {
  let byEvent = wiring.get(query);
  if (!byEvent) {
    byEvent = new Map();
    wiring.set(query, byEvent);
  }
  let fired = byEvent.get(event);
  if (!fired) {
    fired = createEvent();
    sample({
      clock: fired,
      source: { params: query.$params, enabled: query.$enabled },
      filter: ({ enabled, params }) => enabled && params !== null,
      fn: ({ params }) => params as never,
      target: query.refetch,
    });
    byEvent.set(event, fired);
  }
  return fired;
}

/**
 * Refetch the query (with its last params) on a window event, if it has run and is
 * enabled. The DOM listener fires a plain event; params/enabled are read declaratively
 * through `sample` `source` (no `getState`). Pass a `scope` to run the trigger in it via
 * `allSettled` — params/enabled are then read from that scope and the refetch runs there
 * (fork-correct). `allSettled` (not `scopeBind`) is used because it holds the fork context
 * across the query's async run chain. Without a scope it targets the no-scope store
 * (ideal for a single-client app). Safe to call on every mount: the effector wiring is
 * created once per (query, event); unsubscribe removes only the DOM listener.
 */
function refetchOnWindowEvent(query: AnyQuery, event: string, scope?: Scope): () => void {
  const fired = firedFor(query, event);
  const trigger = scope ? () => void allSettled(fired, { scope }) : () => fired();
  return onWindow(event, trigger);
}

/**
 * Refetch the query when the window regains focus (browser only). The query must
 * have run at least once and be enabled. Returns an unsubscribe function. Pass a
 * `scope` to make the refetch fork-correct (fires into that scope via `scopeBind`).
 */
export function refetchOnWindowFocus(query: AnyQuery, scope?: Scope): () => void {
  return refetchOnWindowEvent(query, 'focus', scope);
}

/** Refetch the query when the network comes back online (browser only). Pass a `scope` for fork-correctness. */
export function refetchOnReconnect(query: AnyQuery, scope?: Scope): () => void {
  return refetchOnWindowEvent(query, 'online', scope);
}

export interface NetworkBarrier extends Barrier {
  /** `true` while the browser reports a connection. */
  $online: Store<boolean>;
  /** Stop listening to the `online`/`offline` events. */
  stop: () => void;
}

/**
 * A {@link Barrier} that locks while the browser is **offline** and unlocks on
 * reconnect. Gate queries with it (the `barrier` option, or a factory default)
 * so their runs pause when the connection drops and resume automatically when
 * it returns — pair with {@link refetchOnReconnect} to also refresh stale data.
 *
 *   const offline = createNetworkBarrier();
 *   const q = createQuery({ effect: fetchFx, barrier: offline });
 *   // offline.$online drives a banner; offline.stop() on teardown
 *
 * Browser only (reads `navigator.onLine` + window events); on the server it
 * stays open (online). Client-side mechanism — meant for a single running app.
 */
export function createNetworkBarrier(): NetworkBarrier {
  const barrier = createBarrier();
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (!isOnline) barrier.lock();

  const offOffline = onWindow('offline', () => barrier.lock());
  const offOnline = onWindow('online', () => barrier.unlock());

  return {
    ...barrier,
    $online: barrier.$locked.map((locked) => !locked),
    stop: () => {
      offOffline();
      offOnline();
    },
  };
}
