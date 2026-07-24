---
name: effector-router
description: >-
  Use when building, reviewing, or refactoring routing with @effector/router
  (the official effector router, https://router.effector.dev) — createRoute/
  createRouter, typed path DSL, beforeNavigate guards, chainRoute data loading,
  trackQuery, React/Vue/Solid/React Native bindings, SSR and testing via
  fork/allSettled. Covers the navigation-is-state model and the scope-correct
  initialization that is easy to get wrong. Not atomic-router and not
  argon-router — a different, official library.
---

# effector-router (@effector/router)

The official router for [effector](https://effector.dev). Navigation is effector state:
a route is a plain bundle of units (`$isOpened`, `$params`, `open`/`opened`/`updated`/`closed`)
that a router matches against a history adapter's location. Everything composes with
`sample`/`fork`/`allSettled`.

Docs: https://router.effector.dev · Repo: https://github.com/effector/router

## Packages

```bash
pnpm add @effector/router history          # core (requires the history package)
pnpm add @effector/router-react            # React bindings (stable)
pnpm add @effector/router-vue effector-vue # Vue 3 ^3.5 bindings (beta)
pnpm add @effector/router-solid            # Solid 1.x bindings (draft)
pnpm add @effector/router-react-native     # React Navigation adapter
# standalone typed path DSL (used by core, usable alone):
pnpm add @effector/router-paths
```

SSR projects must add `@effector/router` to the effector babel plugin `factories` list.

## Quick start

```ts
import { createRoute, createRouter, historyAdapter } from '@effector/router';
import { createBrowserHistory } from 'history';
import { allSettled, fork } from 'effector';

const feedRoute = createRoute({ path: '/' });
const postRoute = createRoute({ path: '/posts/:postId<number>' });
const router = createRouter({ routes: [feedRoute, postRoute] });

// the router does NOTHING until it gets a history — always before render/navigation:
const scope = fork();
await allSettled(router.setHistory, {
  scope,
  params: historyAdapter(createBrowserHistory()), // or createMemoryHistory() in SSR/tests
});

postRoute.open({ params: { postId: 1 } }); // typed params from the path DSL
```

## Mental model (read first)

- **Navigation is state.** React to `route.opened`/`updated`/`closed` and `$isOpened`/`$params`
  with `sample`; never imperatively inspect the URL.
- **Two composition points, pre- and post-commit.** `beforeNavigate({ controls, from/to, filter })`
  holds a transition _before_ history changes (guards, confirmations — cancel leaves the URL
  untouched). `chainRoute` derives readiness _after_ the URL already changed (data loading,
  `beforeOpen` effects). `chainRoute` is **not** a URL guard.
- **Controls invert ownership.** `createRouterControls()` lets feature layers declare routes,
  `redirect`s and `beforeNavigate` policy; only the app layer calls `createRouter({ controls })`
  and attaches history. Guard routes must be registered on a router with the _same_ controls.
- **Typed paths.** `/blog/:year<number>/:slug` infers `{ year: number; slug: string }`;
  modifiers: `<type>` then `{range}`/`+`/`*` then `?` (`/items/:ids<number>{1,3}?`).

## Core API map

`createRoute`, `createRouter`, `createRouterControls`, `group`, `chainRoute`, `redirect`,
`beforeNavigate`, `trackQuery`, `historyAdapter`, `queryAdapter` — signatures, returned units
and caveats in [references/core-routing.md](references/core-routing.md). Lifecycle invariants
(what fires when, holds, POP blocking, redirect loops) in
[references/navigation-lifecycle.md](references/navigation-lifecycle.md).

## Query semantics (same everywhere: `route.open`, `navigate`, `Link`)

- `query` omitted → current query is **preserved**; a provided object **replaces** it entirely;
  `query: {}` clears it; a per-key `undefined` removes that key.
- `null` serializes as a bare flag, arrays as repeated keys.
- Reactive typed query state: `trackQuery` — but its `entered`/`exited` don't replay
  pre-existing state; sample its `$state` at app start.

## Framework bindings

React / Vue / Solid export the same identifiers from their own package
(`@effector/router-react` etc.): `RouterProvider`, `createRouteView`, `createLazyRouteView`,
`createRoutesView`, `Link`, `useLink`, `withLayout`, `Outlet`, `useRouter`, `useIsOpened`,
`useOpenedViews`. Details, per-framework differences and the Link matrix in
[references/bindings.md](references/bindings.md).

React Native (`@effector/router-react-native`): `createStackNavigator` /
`createBottomTabsNavigator` sync router state with React Navigation — see
[references/react-native.md](references/react-native.md).

## SSR & testing

Memory history per request/test, `fork` + `allSettled(router.setHistory, ...)`, assert with
`scope.getState(route.$isOpened)` — patterns in
[references/adapters-ssr.md](references/adapters-ssr.md).

## Common mistakes to avoid

- Navigating before `setHistory` — `navigate`/`back`/`forward` emit
  `navigationFailed` (`not-initialized`), `$path` is `null`.
- Using `chainRoute`/`beforeOpen` as an access guard — history has already committed;
  use `beforeNavigate` to hold/cancel.
- Creating route views or `RoutesView` inside render — define at module scope, or pages remount.
- Expecting `route.updated` on first activation — the first match emits `opened`.
- Passing a whole query object to preserve one key — omitted `query` already preserves;
  an object replaces everything.
- In React Native: calling `navigation.navigate` directly — navigate only via route events.
