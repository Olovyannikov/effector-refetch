import { createEvent, sample, type Store } from 'effector';
import { createBarrier, type Barrier } from './barrier';
import type { Query } from './types';

type AnyQuery = Query<any, any, any, any>;

const noop = () => {};

function onWindow(event: string, handler: () => void): () => void {
  if (typeof window === 'undefined') return noop;
  window.addEventListener(event, handler);
  return () => window.removeEventListener(event, handler);
}

/**
 * Refetch the query (with its last params) on a window event, if it has run and is
 * enabled. The DOM listener fires a plain event; params/enabled are read declaratively
 * through `sample` `source` (no `getState`) — so the read happens fork-correctly in
 * whatever scope the trigger propagates in. Fired raw it targets the no-scope store
 * (ideal for a single-client app); for scoped apps, drive `query.refetch` yourself.
 */
function refetchOnWindowEvent(query: AnyQuery, event: string): () => void {
  const fired = createEvent();
  sample({
    clock: fired,
    source: { params: query.$params, enabled: query.$enabled },
    filter: ({ enabled, params }) => enabled && params !== null,
    fn: ({ params }) => params as never,
    target: query.refetch,
  });
  return onWindow(event, () => fired());
}

/**
 * Refetch the query when the window regains focus (browser only). The query must
 * have run at least once and be enabled. Returns an unsubscribe function.
 */
export function refetchOnWindowFocus(query: AnyQuery): () => void {
  return refetchOnWindowEvent(query, 'focus');
}

/** Refetch the query when the network comes back online (browser only). */
export function refetchOnReconnect(query: AnyQuery): () => void {
  return refetchOnWindowEvent(query, 'online');
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
