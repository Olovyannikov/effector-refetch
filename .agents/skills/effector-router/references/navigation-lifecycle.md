# @effector/router — Navigation Lifecycle

The router separates **history policy** (pre-commit) from **route readiness** (post-commit). Navigation is state managed by Effector: every step is exposed as ordinary stores/events, so an app composes lifecycle behavior with `sample` instead of router-specific hooks.

## Phases

1. **Intent** — a route `open` or `controls.navigate` produces a navigation intent.
2. **Pre-commit hold** — `beforeNavigate` may hold the intent before history changes.
3. **Commit** — the adapter commits the location; matching routes activate (`opened`, `$isOpened`, `$params`, `$activeRoutes` update from one match result per normalized location).
4. **Post-commit preparation** — `chainRoute` prepares a derived readiness route.
5. **Render** — a framework binding renders the view; lazy imports/fallbacks belong to that binding (Suspense/async components), not to core.

This is one internal attempt model with exactly **two public composition points**: `beforeNavigate` (can preserve correct history on cancel) and `chainRoute` (exposes readiness without delaying the URL). There is deliberately no public transition/attempt/task/barrier/blocker/guard object, and no recursive `route.open()` from preparation hooks.

## What fires when

- Route first activation → `opened` (plus `openedOnServer`/`openedOnClient` per platform). `$params` already holds applied params at that point.
- Open route receives new params → one `updated` payload. Equal params, query-only changes, and closing do **not** emit `updated`. Param equality ignores object key order, preserves array order, distinguishes `null` from an absent key.
- Route deactivation → `closed`.
- Router/controls: `initialized` after every successful `setHistory` (including reinitialization); `updated` only for later path/query changes — equal snapshots and hash-only changes are suppressed.
- Before `setHistory`: `navigate`/`back`/`forward` emit `navigationFailed` with `reason: 'not-initialized'`; they never throw or start an attempt. `$path` is `null`, `$query` is `{}` until initialization loads the adapter snapshot atomically.

## Pending ownership and concurrency

| Phase                    | Pending owner                                      | Repeated transition                             |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------- |
| `beforeNavigate` hold    | Application model via `started`/`proceed`/`cancel` | Ordinary intents ignored; `redirect` supersedes |
| Route activation         | Deprecated `createRoute.beforeOpen`                | Latest location activation wins                 |
| `chainRoute` preparation | Chained route `$isPending`                         | Latest parent activation wins (`takeLatest`)    |
| Lazy component import    | Framework Suspense / async component               | Framework cache & retry rules                   |

Core `$isPending` describes **model preparation**, not chunk loading.

## Cancellation and interruption semantics

- **Pre-commit cancel** (`beforeNavigate.cancel` by any holder) — history stays unchanged; the attempt is dropped. Multiple matching `beforeNavigate` instances each add one hold; commit happens only after **all** proceed.
- **While held** — later ordinary navigation intents are ignored, so a late confirmation cannot release the wrong destination. A `redirect` target supersedes the held attempt and re-enters matching as a new attempt; consecutive pre-commit redirects are bounded (loop cancelled with a diagnostic after 16).
- **Post-commit error** — an Effect failure after commit is a normal Effect failure (`fail`/`failData`); it cancels the chained readiness route and ends `$isPending`. The URL stays committed.
- **Deprecated `beforeOpen` failure** — the route does not emit `opened`; a previously open route is closed so stale params cannot remain active for the new URL.
- **chainRoute interruption** — `$isPending` ends on: chained route opens, preparation fails, `cancelOn` fires, or the parent closes. A newer parent activation supersedes the older attempt and ignores its late Effect results.
- **Native POP** (browser back/forward) uses the same hold/cancel boundary via the adapter's optional `block`; adapters sharing one `History` instance coordinate through one physical blocker — each matching controls model must proceed before the native transition retries once. An adapter without `block` cannot hold external POP.

## Microtask commit window

Every committed navigation opens a one-microtask hold-collection window: `beforeNavigate` holds registered synchronously in the same transaction are gathered before the location commits. This deferral is uniform — even a navigation with no attached policy commits on the **next microtask**, never synchronously. `allSettled(command, { scope })` resolves after the commit, so scoped tests and SSR always observe the settled location.

## "Navigation is state" / FSD composition

Routes and controls are plain units declared in a lower layer; features compose policy from them; only the app layer creates the router and attaches platform history:

```ts
// shared/routing.ts
export const controls = createRouterControls();
export const routes = {
  home: createRoute({ path: '/' }),
  editor: createRoute({ path: '/editor/:id' }),
};

// feature layer
const leaveEditor = beforeNavigate({ controls, from: routes.editor, filter: $hasUnsavedChanges });
sample({ clock: leaveEditor.started, target: confirmDialog.open });
sample({ clock: confirmDialog.confirmed, target: leaveEditor.proceed });
sample({ clock: confirmDialog.cancelled, target: leaveEditor.cancel });

// app layer
export const router = createRouter({ routes: Object.values(routes), controls });
controls.setHistory(historyAdapter(createBrowserHistory()));
```

## Choosing the right primitive

- Hold/confirm/authorize **before the URL changes** → `beforeNavigate` (+ `redirect` on `started` for auth redirects).
- Load data / derive readiness **after the URL changed** → `chainRoute` (use its `$isPending` for progress UI).
- `createRoute({ beforeOpen })` is deprecated: runs once after confirmed location activation, cannot block history.
- `createVirtualRoute` has no `beforeOpen` at all; compose with ordinary events/effects or `chainRoute`.

## Documented invariants (regression-covered)

- One preparation per committed transition, including query-only updates.
- `chainRoute` pending starts at parent `opened` and ends at a terminal state; preparation failure and parent close end pending.
- Repeated chain activation is `takeLatest`.
- Held navigation can be cancelled or proceeded; redirects supersede holds; redirect loops are bounded.
- Native POP respects the same hold/cancel boundary.
- All behaviors are isolated per Effector Fork scope.
