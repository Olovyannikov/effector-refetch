# @effector/router — Adapters, SSR/Fork, Testing

Adapters bridge the router with a history implementation. Built-ins wrap the [`history`](https://github.com/remix-run/history) package (`npm install history`). The router does nothing until `setHistory` receives an adapter.

## RouterAdapter interface

```ts
interface RouterAdapter {
  location: RouterLocation; // live snapshot: always current
  push: (to: To) => void;
  replace: (to: To) => void;
  goBack: () => void;
  goForward: () => void;
  listen: (cb: (location: RouterLocation) => void) => Subscription; // { unsubscribe(): void }
  block?: (cb: (transition: RouterTransition) => void) => Subscription; // optional
}
interface RouterLocation {
  pathname: string;
  search: string;
  hash: string;
}
type To = string | Partial<RouterLocation>;
```

- `location` is a **live** snapshot with exactly `pathname`, `search`, `hash`; reading after `push`/`replace`/native change returns the current value.
- `To` string is a **full path** `pathname[?search][#hash]` (history convention) — parse it (e.g. `parsePath` from `history`), don't treat it as pathname-only. Object form: omitted fields are retained from the current location.
- `block` is optional: it lets `beforeNavigate` hold native POP transitions, supplying `{ action, location, retry }`. Without it, router commands are still intercepted, but external browser back/forward cannot be held reliably.
- Before `setHistory`: `$path` is `null`, `$query` is `{}`; initialization loads the adapter snapshot atomically; replacing an adapter removes previous listen/block subscriptions first.

## historyAdapter

```ts
historyAdapter(history: History): RouterAdapter  // pathname-based, main navigation
```

```ts
import { createRouter, historyAdapter } from '@effector/router';
import { createBrowserHistory, createHashHistory, createMemoryHistory } from 'history';

router.setHistory(historyAdapter(createBrowserHistory())); // /about
// createHashHistory()   → http://host/#/about (static hosting)
// createMemoryHistory({ initialEntries: ['/'], initialIndex: 0 }) → testing, SSR, React Native
```

## queryAdapter

```ts
queryAdapter(history: History, options?: { key?: string }): RouterAdapter
```

Stores navigation in URL **query** instead of pathname — modals, tabs, embedded/secondary navigation. Host `pathname` and `hash` stay untouched.

- **Default (no `key`)**: the whole target path (pathname+search+hash) is URL-encoded into the entire `location.search` (`/users?%2Fuser%2F1%3Ftab%3Dinfo`). This mode owns the whole search string — the router and the host app **cannot share other query params**.
- **`{ key: 'modal' }`**: nested route stored in one named query param (`/users?sort=asc&modal=%2Fuser%2F1`); all other query params preserved; several `queryAdapter` routers can coexist. Closing the route removes only that one param.

```ts
const history = createBrowserHistory(); // ONE shared instance
mainRouter.setHistory(historyAdapter(history)); // pathname
modalRouter.setHistory(queryAdapter(history, { key: 'modal' })); // layers on top

aboutRoute.open(); // /about
loginModal.open(); // /about?modal=%2Flogin — main pathname stays
```

**Pitfall:** both routers must share the **same** `history` instance — that is how the query router layers its state on the main URL. Built-in adapters coordinate native blocking per shared `History`: one physical `history.block` subscription; a router command bypasses it after its own pre-commit lifecycle; a native back/forward retries only after every participating adapter releases it; unsubscribing an adapter releases its part of a pending native transition.

## Custom adapters

Requirements: provide an initial `location`; handle both `To` forms (parse strings as full paths); notify all `listen` callbacks on every location change; `listen` returns `{ unsubscribe }` that cleans up resources; keep the `location` property synchronized (mutate the same object). `block` may be omitted when the platform cannot retry native transitions. Docs show console/localStorage/React Native (`Linking`)/Electron IPC examples.

```ts
import { parsePath } from 'history';
function resolveTo(to: To, current: RouterLocation): RouterLocation {
  const target = typeof to === 'string' ? parsePath(to) : to;
  const reset = typeof to === 'string';
  return {
    pathname: target.pathname ?? current.pathname,
    search: target.search ?? (reset ? '' : current.search),
    hash: target.hash ?? (reset ? '' : current.hash),
  };
}
```

## SSR / Fork / Scope usage

Initialize the router inside a scope with `allSettled(setHistory)`; use memory history on the server.

```ts
// Client (React) — scope-first bootstrap
import { allSettled, fork } from 'effector';
import { Provider } from 'effector-react';
import { createBrowserHistory } from 'history';
import { historyAdapter } from '@effector/router';

async function render() {
  const scope = fork();
  const history = createBrowserHistory();
  await allSettled(router.setHistory, { scope, params: historyAdapter(history) });
  createRoot(document.getElementById('root')!).render(
    <Provider value={scope}><App /></Provider>,
  );
}
```

```ts
// Server (SSR) — memory history with the requested URL
import { createMemoryHistory } from 'history';
const scope = fork();
await allSettled(controls.setHistory, {
  scope,
  params: historyAdapter(createMemoryHistory({ initialEntries: ['/products/123'] })),
});
```

Notes:

- Routes expose `openedOnServer` / `openedOnClient` in addition to the combined `opened` for platform-specific SSR handling.
- Every committed navigation is deferred by one microtask, but `allSettled(command, { scope })` resolves **after** the commit — scoped code always observes the settled location.
- Route contract, not-found behavior, adapter lifecycle, and `trackQuery.$state` are all documented as isolated per Fork scope; `trackQuery.$state` is accurate when read from a Fork or when the tracker is created after history initialization.

## Testing patterns

Memory history + fork + allSettled:

```ts
import { createMemoryHistory } from 'history';
import { historyAdapter } from '@effector/router';
import { allSettled, fork } from 'effector';

test('navigation works', async () => {
  const scope = fork();
  const history = createMemoryHistory({ initialEntries: ['/'] });

  await allSettled(router.setHistory, { scope, params: historyAdapter(history) });
  await allSettled(aboutRoute.open, { scope });

  expect(history.location.pathname).toBe('/about');
  expect(scope.getState(aboutRoute.$isOpened)).toBe(true);
});
```

Mock adapter test:

```ts
test('custom adapter', async () => {
  const locations: RouterLocation[] = [];
  const currentLocation = { pathname: '/', search: '', hash: '' };
  const mockAdapter: RouterAdapter = {
    location: currentLocation,
    push: (to) => {
      const location = resolveTo(to, currentLocation);
      Object.assign(currentLocation, location);
      locations.push(location);
    },
    replace: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    listen: () => ({ unsubscribe: () => {} }),
  };

  const scope = fork();
  await allSettled(router.setHistory, { scope, params: mockAdapter });
  await allSettled(aboutRoute.open, { scope });

  expect(locations).toContainEqual({ pathname: '/about', search: '', hash: '' });
});
```

## Best practices (from docs)

- Prefer built-in adapters; custom only when necessary.
- Initialize `setHistory` **before** any navigation (`allSettled(router.setHistory, ...)` first, then `allSettled(route.open, ...)`).
- One adapter instance per router — don't call `setHistory` twice with different instances.
- Clean up subscriptions in custom `listen`/`unsubscribe`.
