# @effector/router — Core Routing API

Package: `@effector/router` (peer: `effector`; `history` package for built-in adapters). All units are ordinary Effector stores/events/effects — compose with `sample`, `fork`, `allSettled`.

## createRoute

```ts
// Path route — params inferred from the path template
function createRoute<T extends string>(config: CreateRouteConfig<T>): PathRoute<ParseUrlParams<T>>;
// Pathless route — params given explicitly
function createRoute<Params extends object | void = void>(
  config?: WithBaseRouteConfig,
): PathlessRoute<Params>;
```

Config: `path?: string` (URL template), `parent?: Route<any>` (nesting), `beforeOpen?: Effect[]` (deprecated).

Returned units (same contract for path and pathless routes):

| Property                            | Type                                   | Notes                                       |
| ----------------------------------- | -------------------------------------- | ------------------------------------------- |
| `$params`                           | `Store<T>`                             | Applied route parameters                    |
| `$isOpened`                         | `Store<boolean>`                       | True if route or its children are opened    |
| `$isPending`                        | `Store<boolean>`                       | Deprecated `beforeOpen` preparation running |
| `open`                              | `EventCallable<RouteOpenedPayload<T>>` | Opens route and its parents                 |
| `opened`                            | `Event<RouteOpenedPayload<T>>`         | Fires on open (client or server)            |
| `openedOnServer` / `openedOnClient` | `Event<RouteOpenedPayload<T>>`         | SSR-specific variants                       |
| `updated`                           | `Event<RouteUpdatedPayload<T>>`        | Open route received new params              |
| `close`                             | `EventCallable<void>`                  | Closes the route                            |
| `closed`                            | `Event<void>`                          | Fires on close                              |
| `path`                              | `string`                               | PathRoute only                              |
| `parent`                            | `Route<any>`                           | Optional                                    |

Open payload: `route.open({ params?, query?, replace? })`.

```ts
const userRoute = createRoute({ path: '/user/:id' }); // Route<{ id: string }>
userRoute.open({ params: { id: '123' } });

const postRoute = createRoute({ path: '/post/:id<number>' }); // Route<{ id: number }>
const modeRoute = createRoute({ path: '/edit/:mode<create|update>' }); // union type
const dialog = createRoute<{ title: string }>(); // pathless, typed params
```

Typed path params: `:name` = string (default), `:name<number>`, `:name<a|b>` unions; full syntax in `@effector/router-paths`.

**Pitfalls / semantics:**

- Pathless routes (no `path`) never write history, don't require router registration; but to give one a URL, register as `{ path: '/dialog', route: dialogRoute }` in `createRouter`.
- `open()`, `open({})`, `open({ params: {} })` are equivalent for param-less routes. Params are never merged from previous state — only the supplied ones apply.
- Query: omitting `query` on open **preserves** the current URL query; a provided object **replaces** it; `query: {}` clears it. Same rule for redirects and links.
- `replace: true` replaces the current history entry instead of pushing.
- First activation emits `opened`, not `updated`. `updated` fires only for real param changes: equal params, query-only changes, and closing do not emit it. Comparison ignores object key order, preserves array order, distinguishes `null` vs absent key.
- Parent/child: opening a child opens the parent; child's full path = parent path + child path; child `$params` = intersection of parent+child params, parent keeps only its own declared params. Duplicate param names across the chain are rejected at path validation.
- `beforeOpen` (deprecated): runs once **after** history commit — not a guard; on failure the route does not emit `opened` and an already-open route is closed. Use `chainRoute` for readiness, `beforeNavigate` for holding history.
- To observe navigation with applied params: `sample({ clock: route.opened, source: route.$params, ... })`; watch `$params` directly for every update while open.

## createRouter

```ts
const router = createRouter({
  routes: [homeRoute, { path: '/dialog', route: dialogRoute }, nestedRouter],
  notFound, // optional pathless route fallback
  base: '/admin', // optional path prefix for all routes
  controls, // optional shared RouterControls
});
```

`routes` entries (`InputRoute`): `PathRoute<any>` | `{ path: string; route: PathlessRoute<any> }` | `Router` (nested).

Returned API:

| Name                        | Type                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| `$path`                     | `Store<string>`                                                            |
| `$query`                    | `Store<Query>`                                                             |
| `$history`                  | `Store<RouterAdapter \| null>`                                             |
| `$activeRoutes`             | `Store<Route<any>[]>`                                                      |
| `navigate`                  | `EventCallable<{ path?: string; query?: Query; replace?: boolean }>`       |
| `back` / `forward`          | `EventCallable<void>`                                                      |
| `setHistory`                | `EventCallable<RouterAdapter>`                                             |
| `registerRoute`             | `(route: InputRoute) => void` — dynamic registration                       |
| `initialized` / `updated`   | events: after every successful `setHistory` / later path-query changes     |
| `navigationFailed`          | emitted with `reason: 'not-initialized'` if navigating before `setHistory` |
| `ownRoutes` / `knownRoutes` | `MappedRoute[]`                                                            |

```ts
import { createBrowserHistory } from 'history';
import { historyAdapter } from '@effector/router';
router.setHistory(historyAdapter(createBrowserHistory())); // REQUIRED before navigation
```

**Pitfalls:**

- Router must be initialized via `setHistory` — before that, `navigate`/`back`/`forward` emit `navigationFailed` (`reason: 'not-initialized'`), they do not throw.
- `router.updated` is suppressed for equal snapshots and hash-only changes; `initialized` fires again on reinitialization.
- `notFound`: pass a pathless route; opened with the current query, is the only entry in `$activeRoutes`, auto-closes when a known route matches. Without it, unknown location leaves all routes closed. In nested routers, matching resolves deepest-first: a nested `notFound` prevents ancestor fallbacks; local and ancestor fallbacks are never open together.
- `registerRoute` takes effect on the **next** location update.
- Query type: `type Query = Record<string, string | null | Array<string | null>>`; `null` serializes as a flag (`?enabled`), arrays as repeated keys (order preserved), `undefined` keys are omitted (use `QueryInput` to remove a key).
- `router.navigate({ path })` without `query` preserves the current query (same effective-URL rule as `route.open` and links).

## createRouterControls

```ts
function createRouterControls(): RouterControls;
```

Returns: `$history`, `$locationState`, `$query`, `$path`, `setHistory`, `navigate`, `back`, `forward`, `locationUpdated` (`Event<{ pathname, query }>`), plus `initialized`, `updated`, `navigationFailed` (same lifecycle as Router).

Purpose: share navigation across layers (FSD). Declare `controls` + routes in a lower layer; features compose `beforeNavigate({ controls, ... })` / `trackQuery({ controls, ... })` without importing the app router; only the app creates `createRouter({ routes, controls })` and calls `controls.setHistory(...)`. Routes used in `beforeNavigate` `from`/`to` must be registered on a router using the **same** controls.

`navigate` payload: `{ path?, query?, replace? }` — omitted `path`/`query` reuse current values; provided `query` replaces the whole query; `query: {}` clears everything; per-key `undefined` removes that key.

## group

```ts
function group(routes: Route<any>[]): PathlessRoute;
```

Derived pathless route: opens when **any** grouped route opens, closes when **all** close; `$isPending` combines pending of all routes.

```ts
const authorizationRoute = group([signInRoute, signUpRoute]);
```

**Pitfalls:** regular path routes have no public manual close — their state follows navigation. `group` is a derived state, **not** a route-selection object for transition policy — for a shared pre-commit rule pass the array itself: `beforeNavigate({ to: [a, b, c], ... })`.

## createVirtualRoute (deprecated)

```ts
createVirtualRoute<T = void, Params = void>({ $isPending?: Store<boolean>, transformer?: (payload: T) => Params });
```

Compatibility factory; new code should use `createRoute<Params>()` without a path. Preserves `transformer` (map open payload → params) and external `$isPending` (owned by the surrounding model). No `beforeOpen` option — use `chainRoute` instead. Never writes history.

## redirect

```ts
function redirect<T>({ to: PathRoute<T>, replace?: boolean }): EventCallable<RouteOpenedPayload<T>>;
```

Clock-less Effector target; params/query travel in the payload via normal `sample`:

```ts
sample({
  clock: legacyUserOpened,
  fn: ({ id }) => ({ params: { id }, query: { source: 'legacy' } }),
  target: redirect({ to: routes.user, replace: true }),
});
```

**Pitfalls:** not an alias for `route.open` — a redirect **supersedes** a currently held `beforeNavigate` attempt (no `proceed` needed) and re-enters matching as a new attempt. Redirect loops are bounded: cancelled with a diagnostic after 16 consecutive pre-commit redirects. Deliberately has no `clock`/`source`/`filter`/`params`/`query` config keys.

## chainRoute

```ts
function chainRoute<T>({
  route: Route<T>,
  beforeOpen: CallableUnit | CallableUnit[], // events/effects, run in array order; Effects awaited
  openOn?: Unit | Unit[],
  cancelOn?: Unit | Unit[],
}): ChainRoute<T>; // pathless route + `cancelled` event
```

Post-commit readiness: preparation runs **after** history has changed. Without `openOn`, the chained route opens when `beforeOpen` succeeds; Effect failure cancels the attempt (observe via the Effect's own `fail`/`failData`).

```ts
const readyUserRoute = chainRoute({ route: routes.user, beforeOpen: loadUserFx });
```

- `$isPending` is true from parent `opened` until: chained opens, preparation fails, `cancelOn` fires, or parent closes (includes time waiting for `openOn`).
- An `openOn` signal during a running `beforeOpen` is remembered; route opens after preparation succeeds. `cancelOn` closes/cancels and emits `cancelled`.
- Repeated parent activation is `takeLatest`: new payload starts a new attempt, closes the previous derived route, ignores stale Effect results.
- Chains compose in layers (`chainRoute({ route: previousChain, ... })`).
- **Not a URL guard** — the URL is already committed. Use `beforeNavigate` to protect history.

## beforeNavigate

```ts
const transition = beforeNavigate({
  controls: RouterControls,
  from?: PathRoute | readonly PathRoute[],
  to?: PathRoute | readonly PathRoute[],
  filter?: Store<boolean> | ((navigation: NavigatePayload) => boolean),
});
// -> { started: Event<void>, proceed: EventCallable<void>, cancel: EventCallable<void> }
```

Holds matching navigation **before** history changes. `filter: true` = held. If both `from` and `to` given, both must match. Routes must be registered on a router using the same `controls`.

```ts
const leaveEditor = beforeNavigate({ controls, from: routes.editor, filter: $hasUnsavedChanges });
sample({ clock: leaveEditor.started, target: confirmDialog.open });
sample({ clock: confirmDialog.confirmed, target: leaveEditor.proceed });
sample({ clock: confirmDialog.cancelled, target: leaveEditor.cancel });
```

**Pitfalls:**

- Every matching instance adds one hold; the transition commits only after **all** holders proceed; any single `cancel` cancels the attempt and keeps the current location.
- While held, later ordinary navigation intents are **ignored** (a late confirmation cannot release the wrong destination); only `redirect` supersedes a hold.
- Native POP (browser back/forward) is held only when the adapter implements optional `block` — `historyAdapter`/`queryAdapter` do; a custom adapter without `block` guards router commands only.
- Not implemented via `chainRoute` — a chain starts after `route.opened` when history has already changed.

## trackQuery

```ts
trackQuery<T extends ZodType>({ controls: RouterControls, routes?: Route[], parameters: T }): QueryTracker<T>;
```

Returns:

| Property  | Type                                                                             |
| --------- | -------------------------------------------------------------------------------- |
| `$state`  | `Store<{status:'inactive'} \| {status:'pending'} \| {status:'entered', params}>` |
| `enter`   | `Event<z.infer<T>>` — merge tracked keys into URL                                |
| `entered` | `Event<z.infer<T>>` — params match schema (parsed output)                        |
| `exit`    | `Event<{ ignoreParams?: string[] } \| void>` — remove tracked keys               |
| `exited`  | `Event<void>` — params no longer match                                           |

```ts
const searchTracker = trackQuery({
  controls,
  routes: [searchRoute], // optional OR filter over routes' $isOpened
  parameters: z.object({ q: z.string(), page: z.coerce.number().default(1) }),
});
sample({ clock: searchTracker.entered, target: loadSearchResultsFx });
sample({ clock: searchTracker.exited, target: $results.reinit });
```

**Pitfalls:**

- `entered`/`exited` are transitions observed after creation — they do **not** replay a pre-existing state. For app start / late creation, sample `$state` with your own clock (it is accurate immediately, even under Fork).
- `enter` accepts only schema-declared keys with URL-compatible values (`string | null | ordered arrays`); convert numbers/dates/booleans first. `entered` publishes the schema's **parsed** output (transforms allowed).
- `enter` merges only supplied schema keys; `exit` removes schema-owned keys, preserving unrelated ones; `ignoreParams` keeps selected keys.
- When switching between routes in `routes`, the tracker does not emit a transient `exited` while the target route is pending; validation happens after that route opens.
- Omitting `routes` makes the tracker active on every location. Prefer specific schemas and separate trackers per concern.
