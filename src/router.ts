import { createStore, sample, type Event, type EventCallable } from 'effector';

/**
 * Minimal structural shape of a route instance. Nothing is imported — both
 * atomic-router's `RouteInstance` and @effector/router's `Route` satisfy it
 * (their `opened`/`updated` payloads carry `params` plus router-specific
 * extras like `query`, which ride along into `mapParams` untouched).
 */
export interface RouteLike<Opened> {
  opened: Event<Opened>;
  /** Param changes while the route stays open (both routers emit it). */
  updated?: Event<Opened>;
  closed?: Event<unknown>;
}

export interface AttachToRouteConfig<Opened, QueryParams> {
  route: RouteLike<Opened>;
  /** A Query or InfiniteQuery (anything with `start` + `reset`). */
  query: { start: EventCallable<QueryParams>; reset: EventCallable<void> };
  /** Map the route's `opened`/`updated` payload to the query's params. Default: the route params. */
  mapParams?: (opened: Opened) => QueryParams;
  /** Reset the query when the route closes. Default: true. */
  resetOnClose?: boolean;
  /**
   * Re-start the query when the open route receives new params (`route.updated`),
   * e.g. /users/1 -> /users/2. Default: true (when the route exposes `updated`).
   */
  restartOnUpdate?: boolean;
}

/**
 * Start a query when a route opens (with its params), re-start it when the route's
 * params change, and reset it when the route closes — router glue that works with
 * both atomic-router and @effector/router, without importing either:
 *
 *   attachToRoute({ route: userRoute, query: userQuery, mapParams: ({ params }) => Number(params.id) });
 *
 * Pure `sample` under the hood, so it's scope-correct/SSR-friendly.
 */
export function attachToRoute<Opened, QueryParams = Opened extends { params: infer P } ? P : void>(
  config: AttachToRouteConfig<Opened, QueryParams>,
): void {
  const { route, query, mapParams, resetOnClose = true, restartOnUpdate = true } = config;

  const toParams =
    mapParams ?? ((opened: Opened) => (opened as { params?: unknown } | undefined)?.params as QueryParams);

  if (restartOnUpdate && route.updated) {
    // Openness gate: some routers (@effector/router) fire `opened` on EVERY open() call —
    // including a re-open with new params, alongside their own `updated` — so `opened`
    // starts the query only on a closed -> open transition; param changes go via `updated`.
    const $open = createStore(false, { serialize: 'ignore' });
    // derived event: gate passes only on a closed -> open transition; the flag is set
    // FROM the derived event (not from `opened` directly), so the gate is guaranteed to
    // read the pre-open state — no dependence on subscription order
    const firstOpen: Event<Opened> = sample({
      clock: route.opened,
      source: $open,
      filter: (open) => !open,
      fn: (_open, payload) => payload,
    });
    $open.on(firstOpen, () => true);
    if (route.closed) $open.reset(route.closed);
    sample({ clock: firstOpen, fn: toParams, target: query.start });
    sample({ clock: route.updated, fn: toParams, target: query.start });
  } else {
    sample({ clock: route.opened, fn: toParams, target: query.start });
  }

  if (resetOnClose && route.closed) {
    sample({ clock: route.closed, target: query.reset });
  }
}
