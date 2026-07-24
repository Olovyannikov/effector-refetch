# Framework bindings (React / Vue / Solid)

Three packages with the same exported identifiers and the same contract; React is the stable reference implementation, Vue and Solid mirror it.

| Framework | Package                  | Status                 | Peer deps                                                   |
| --------- | ------------------------ | ---------------------- | ----------------------------------------------------------- |
| React     | `@effector/router-react` | stable                 | `@effector/router effector effector-react react`            |
| Vue 3     | `@effector/router-vue`   | beta (Vue `^3.5` only) | `@effector/router effector effector-vue vue`                |
| Solid     | `@effector/router-solid` | draft (Solid 1.x)      | `@effector/router effector effector-solid solid-js history` |

Shared exports from each package: `RouterProvider`, `createRouteView`, `createLazyRouteView`, `createRoutesView`, `Link`, `useLink`, `withLayout`, `Outlet`, `useRouter`, `useRouterContext`, `useIsOpened`, `useOpenedViews`. `LinkProps<Params>` type is also exported (documented for Vue/Solid).

## Setup

```tsx
import { createRoute, createRouter, historyAdapter } from '@effector/router';
import { createBrowserHistory } from 'history';
import { RouterProvider, createRouteView, createRoutesView, Link } from '@effector/router-react';

const homeRoute = createRoute({ path: '/' });
const userRoute = createRoute({ path: '/user/:id' });
const router = createRouter({ routes: [homeRoute, userRoute] });
router.setHistory(historyAdapter(createBrowserHistory()));
// Fork/SSR variant: await allSettled(router.setHistory, { scope, params: historyAdapter(history) })

const RoutesView = createRoutesView({
  routes: [
    createRouteView({ route: homeRoute, view: HomePage }),
    createRouteView({ route: userRoute, view: UserPage }),
  ],
  otherwise: NotFoundPage, // optional
});

const App = () => (
  <RouterProvider router={router}>
    <RoutesView />
  </RouterProvider>
);
```

## RouterProvider

Props: `router: Router` (required), `children`. Required by `Link`, `useLink`, `useRouter`, `useRouterContext` — they throw `[useRouter] Router not found. Add RouterProvider in app root` outside it. Route views, `useIsOpened`, and `useOpenedViews` subscribe to the units passed to them and do not read this context. Multiple providers with different routers may wrap different subtrees.

Effector `Scope` (fork/SSR/testing): put the scope binding **outside** RouterProvider — React: `<Provider value={scope}>` from `effector-react`; Solid: `<Provider value={scope}>` from `effector-solid`; Vue: `app.use(EffectorScopePlugin({ scope }))` from `effector-vue`.

## createRouteView(config) → RouteView

| Key                   | Type                      | Notes                                                                                                                 |
| --------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `route` (required)    | `Route<T> \| Router`      | A `Router` target is active while its `$activeRoutes` is non-empty (mount a nested routes view under a parent Outlet) |
| `view` (required)     | component                 | rendered when the route is open                                                                                       |
| `layout` (optional)   | component with `children` | wraps the view                                                                                                        |
| `children` (optional) | `RouteView[]`             | nested views rendered by `Outlet` in the parent view                                                                  |

Returns a plain `RouteView` object `{ route, view, children? }` — not a component; pass it to `createRoutesView` or as `children`.

## createLazyRouteView(config) → RouteView

Same keys as `createRouteView` plus `fallback` (optional, shown while the chunk loads; defaults to empty). `view` is a dynamic import returning a **default export**: `view: () => import('./Profile')`. Wrapped in the framework's `lazy`/`Suspense` (Vue: async component).

- The importer starts when the view **renders**, not on `route.open()`. Route opening does not wait for the chunk.
- Route/chained `$isPending` = model preparation, NOT chunk loading; chunk loading is observed by the Suspense/fallback boundary.
- Preload: reuse the same importer in an app-owned Effect — `const importP = () => import('./P'); const preloadFx = createEffect(importP);` then `sample({ clock: linkHovered, target: preloadFx })`. Never call `route.open()` from `beforeOpen` to "preload".
- Do **not** pass a `Router` as `route` to `createLazyRouteView` — lazy router targets are not implemented (only `createRouteView` supports Router targets).

## createRoutesView({ routes, otherwise? }) → Component

Renders the selected opened view. Selection is declarative, in two stages:

1. An active child route removes its active parent from the candidates, regardless of order in `routes`.
2. Of the remaining active views, the **last one declared** in the `routes` array wins.

`otherwise` renders when no supplied view is open. Create route views and the `RoutesView` component once at module scope — recreating them inside a render creates new identities/subscriptions and remounts the page. Keep persistent chrome outside `RoutesView`.

## Link

Anchor component; uses `to`/`params` instead of `href`.

| Prop            | Type            | Notes                                                                                                             |
| --------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `to` (required) | `Route<Params>` | must be registered in the provided router (throws otherwise)                                                      |
| `params`        | `Params`        | conditionally required — required when the route path has required keys; omittable for pathless/param-less routes |
| `query`         | `Query`         | passed to `route.open` on intercepted click                                                                       |
| `replace`       | `boolean`       | replace instead of push                                                                                           |
| `onClick`       | anchor handler  | runs first; `e.preventDefault()` cancels router navigation                                                        |
| ...anchor attrs |                 | forwarded; React also forwards `ref` to the `<a>`, Vue forwards attrs/events                                      |

`href` always contains the complete path params plus the **effective query**: `query` omitted → current router query preserved; explicit object → replaces it; `{}` → clears it. `route.open` with the same payload produces the same URL.

### Link click matrix (shared React/Vue/Solid contract)

| Case                                                         | Behavior                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Ordinary primary-button, same-origin, `target="_self"` click | Intercepted; calls the route open unit with params, query, replace                          |
| Modified (cmd/ctrl/shift/alt) or secondary click             | Native anchor behavior (new tab/window/download)                                            |
| `target != "_self"`                                          | Native anchor behavior                                                                      |
| `download` attr or cross-origin href                         | Native anchor behavior                                                                      |
| User `onClick` calls `preventDefault()`                      | User handler runs first; route opening skipped                                              |
| Params typing                                                | `params` required for routes with required keys; omission allowed for pathless/empty routes |

## useLink — signature differs per framework

- **React**: `useLink<T>(to: Route<T>, params: T): { path: string; onOpen: (payload?: RouteOpenedPayload<T>) => void }`. Pass `undefined` for param-less routes. Extra keys not in the path template are a TS error.
- **Solid**: `useLink<T>(to: Route<T>, params?: Accessor<T>): { path: Accessor<string>; onOpen: EventCallable<RouteOpenedPayload<T>> }`. `params` is an accessor; `path()` recomputes when it changes.
- **Vue**: `useLink<T>(to: Route<T>): { build: (params?: T, query?: Query) => string; onOpen: (payload: RouteOpenedPayload<T>) => void }`. No params argument — call `build(params, query)` per use.

In all frameworks `onOpen` is the route's raw open unit: it does **not** capture the params passed to the hook/`build` — pass the full payload when calling it. Throws `[useLink] Route not found. Maybe it is not passed into createRouter?` for unregistered routes.

## Outlet

Renders the selected opened view among the current view's `children`; renders nothing when no child is active. Recursive: each selected child provides its own `children` to the next `Outlet`, no depth limit. Child components can read parent route params via the parent route's `$params`. (Solid caveat: the Solid docs also note the current implementation may not provide a new child context to a further nested `Outlet` — treat deep Outlet nesting in Solid as one level.)

## withLayout(layout, views) → RouteView[]

Wraps each view in `views` with `layout` (component receiving `children`). Spread the result into `routes`: `[...withLayout(MainLayout, [HomeScreen, AboutScreen]), LoginScreen]`. Views from one call share a private group identity: switching between them replaces only the page child and keeps the layout instance mounted; a separate `withLayout` call is a separate group. Equivalent to per-view `layout:` config for a single route. Preserves `route`, `children`, and other route-view metadata; can be nested.

## useRouter / useRouterContext

- `useRouterContext()` (all frameworks): raw `Router` instance with real stores/methods (`router.$path: Store<string>`, `router.setHistory`, ...). Bind stores yourself with the framework's `useUnit`.
- `useRouter()` binds the router's unit shape via `useUnit`:
  - **React**: returns the router with all stores bound to **values** — `router.$path` is a `string`, `router.$query` a `Query`, `router.$activeRoutes` a `Route[]`; methods `router.back()`, `router.forward()`, `router.navigate({ path, query })`. Component re-renders on changes.
  - **Vue**: returns `{ path: Readonly<Ref<string>>, query: Readonly<Ref<Query>>, activeRoutes: Readonly<Ref<Route[]>>, onBack, onForward, onNavigate }` — refs (`.value` in script, auto-unwrapped in templates), events as functions.
  - **Solid**: same shape as Vue but `path`, `query`, `activeRoutes` are accessors (`path()`), events callable.

## useIsOpened(route: Route | Router)

Route → value of `route.$isOpened`; Router → `true` while `router.$activeRoutes` is non-empty. Return type: React `boolean`, Vue `ComputedRef<boolean>`, Solid `Accessor<boolean>`. Does not require router context (reads the supplied unit directly).

## useOpenedViews(routes: RouteView[])

Low-level primitive behind `createRoutesView` and `Outlet`. Filters the supplied views to opened ones (`$isOpened` / non-empty `$activeRoutes`), removes an active parent when its child is active, preserves declaration order (does NOT track open order — last declared wins as tie-breaker). Return type: React `RouteView[]`, Vue `ComputedRef<RouteView[]>`, Solid `Accessor<RouteView[]>`. Multiple sibling views (e.g. page + pathless modal routes) can be open simultaneously — use for custom stack/layer/animated renderers.

## Per-framework differences summary

| Aspect          | React                                       | Vue                                                                                                                 | Solid                                                   |
| --------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Reactive values | plain values (useUnit re-render)            | `Readonly<Ref<...>>` / `ComputedRef`                                                                                | accessors `() => value`                                 |
| `useLink`       | `(to, params)` → `path: string`             | `(to)` → `build(params?, query?)`                                                                                   | `(to, paramsAccessor?)` → `path: Accessor`              |
| Params in views | `useUnit(route.$params)` → object           | `useUnit` from effector-vue                                                                                         | `useUnit(route.$params)` → accessor, read `params().id` |
| Scope setup     | `<Provider value={scope}>` (effector-react) | `app.use(EffectorScopePlugin({ scope }))`                                                                           | `<Provider value={scope}>` (effector-solid)             |
| Link extras     | forwards `ref` to `<a>`                     | forwards attrs/events; template inference may lose conditional `params` typing — annotate `LinkProps<Params>` in TS | reactive `useLink`                                      |

## Pitfalls

- `RouteView` objects are not components; only `createRoutesView(...)` returns a renderable component.
- Define route views and `RoutesView` at module scope; in-render creation causes full remounts.
- `otherwise` / last-declared-wins: order your `routes` array deliberately; parent suppression happens first.
- Lazy views: `fallback` covers chunk load only; `$isPending` covers model prep only. Router targets are eager-only.
- `useLink().onOpen` needs the full payload — it never remembers the hook's params.
