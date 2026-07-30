# Auto-refetch & polling

## Polling — `refetchInterval`

Refetch on a timer while the query is started and enabled:

```ts
const stats = createQuery({ effect: fetchStatsFx, refetchInterval: 5000 }); // every 5s
stats.start();
```

After each settle (success or failure) the query waits `refetchInterval` ms, then
`refresh`es with the last params (bypassing cache). It's paused while `$enabled` is
`false`, stops on `reset`, and is fork-correct (each scope polls independently). The
interval can be reactive — pass a `Store<number>` and change it live (e.g. faster while
a tab is active):

```ts
createQuery({ effect: fx, refetchInterval: $pollMs });
```

## On window focus / reconnect

Opt-in, browser-only, tree-shakeable:

```ts
import { refetchOnWindowFocus, refetchOnReconnect } from 'effector-refetch';

const stop1 = refetchOnWindowFocus(userQuery);
const stop2 = refetchOnReconnect(userQuery);
// call stop1() / stop2() to detach
```

Both refetch with the query's last params, only if it has run and is enabled. Without a
scope they read the no-scope store (single-client app); pass a `scope` as the second
argument to run the trigger fork-correctly. Safe to call on every component mount — the
effector wiring is created once per query, unsubscribe removes only the DOM listener.

## Offline / network mode

`createNetworkBarrier()` is a [barrier](/recipes/auth-barrier) that **locks while the browser is
offline** and unlocks on reconnect. Gate queries with it and their runs pause when the connection
drops, then resume automatically when it returns — no per-query wiring:

```ts
import { createNetworkBarrier, refetchOnReconnect } from 'effector-refetch';

const offline = createNetworkBarrier();

const userQuery = createQuery({ effect: fetchUserFx, barrier: offline });
// or apply it to a whole group: createQueryFactory({ barrier: offline })

offline.$online; // Store<boolean> — drive an "offline" banner
refetchOnReconnect(userQuery); // optional: also refresh already-loaded data
offline.stop(); // detach the online/offline listeners on teardown
```

A run started while offline sits in `pending` (the effect body isn't entered) until the network
returns. Browser-only — on the server the barrier stays open (online).

In a scoped app (`@effector/next`, any `fork()` setup) pass the scope — the `online`/`offline`
listeners fire outside effector's call stack, so otherwise the lock lands on the scope-less app
and the forked queries keep running:

```ts
const offline = createNetworkBarrier({ scope });
```

## Refetch on source change — `keepFresh`

Keep a query fresh relative to external state (filters, locale, viewer): `keepFresh` refetches it
with its **last params** whenever a `source` store changes.

```ts
import { keepFresh } from 'effector-refetch';

keepFresh(productsQuery, { source: $filters }); // or source: [$filters, $locale]
```

No-op until the query has run (`status !== 'initial'`) and while it's disabled. Distinct from
`refetchInterval` (time-based) — this is dependency-based. (If the source value should actually
change the request, thread it through the params instead — `connectQuery` / `sample` into `start`.)

## Web-API triggers (`@withease/web-api`)

[`@withease/web-api`](https://withease.effector.dev/web-api/) trackers implement the `@@trigger`
protocol, so they drop **straight** into `keepFresh({ triggers })` — no adapter:

```ts
import { trackPageVisibility, trackNetworkStatus } from '@withease/web-api';
import { keepFresh } from 'effector-refetch';

const network = trackNetworkStatus();

// refetch when the tab becomes visible again (tracker fires its `visible` event)
keepFresh(dashboardQuery, { triggers: [trackPageVisibility()] });

// …or on any plain event the tracker exposes
keepFresh(dashboardQuery, { triggers: [network.online] });
```

Tracker **stores** fit the other slots: gate a query while offline with `enabled`, or treat a
tracker's store as a `source`:

```ts
createQuery({ effect: fx, enabled: network.$online });
```

This overlaps the built-in `refetchOnWindowFocus` / `refetchOnReconnect` / `createNetworkBarrier`
above — use the built-ins for those common cases, and reach for `@withease/web-api` when you want
more signals (geolocation, media query, screen orientation, …) behind the same `@@trigger` API.

## Compose with patronum

A query's triggers are plain effector events, so you can drive them with any
[patronum](https://patronum.effector.dev/operators/) operator — no special API needed:

```ts
import { interval, debounce, throttle } from 'patronum';

// debounced search-as-you-type
debounce({ source: queryChanged, timeout: 300, target: searchQuery.start });

// custom polling with start/stop control
const { tick } = interval({ timeout: 10_000, start: pageOpened, stop: pageClosed });
sample({ clock: tick, source: searchQuery.$params, target: searchQuery.refetch });

// throttle a refresh button
throttle({ source: refreshClicked, timeout: 1000, target: dashboard.refresh });
```

Use the built-in `refetchInterval` for the common case; reach for patronum when you want
explicit start/stop, debounce or throttle semantics.

::: warning Polling and SSR
With `refetchInterval > 0`, `allSettled(query.start, { scope })` never resolves — every
settle schedules the next tick, so the scope never goes idle. For SSR (or tests that
await the scope), make the interval a `Store<number>` and set it to `0` in that scope:

```ts
const $interval = createStore(30_000);
const stats = createQuery({ effect: fetchStatsFx, refetchInterval: $interval });

// per-request SSR scope: polling off
const scope = fork({ values: [[$interval, 0]] });
```

:::
