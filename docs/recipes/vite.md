# Vite (SPA)

The simplest setup — no SSR, no plugins, no providers required. Queries are plain effector
units, so a Vite + React/Vue/Solid SPA needs nothing beyond the model itself. Two upgrades are
worth making from day one though: an **app entry event** and a **scope**.

```bash
npm i effector effector-react effector-refetch
```

## The model

Same shape as every other recipe: entry events in, queries out, components only render.

```ts
// src/model.ts
import { createEvent, sample } from 'effector';
import { createJsonQuery } from 'effector-refetch';

export const usersQuery = createJsonQuery<void, User[]>({
  name: 'users',
  request: { url: '/api/users' }, // relative URLs are fine — it's all browser
});

/** Fired once from the entry point. */
export const appStarted = createEvent();
sample({ clock: appStarted, target: usersQuery.start });
```

## The entry: fork even in a SPA

You don't _have_ to fork in a client-only app — but doing it makes the app testable (the same
`appStarted` drives integration tests via `allSettled`) and keeps you one step from SSR:

```tsx
// src/main.tsx
import { allSettled, fork } from 'effector';
import { Provider } from 'effector-react';
import { appStarted } from './model';

const scope = fork();
void allSettled(appStarted, { scope });

createRoot(document.getElementById('root')!).render(
  <Provider value={scope}>
    <App />
  </Provider>,
);
```

Components use `useUnit` as usual — with the `Provider` in place they read the scope
automatically.

## Nice extras for a SPA

- **Persistence across reloads**: point the scope's cache at web storage —
  `fork({ values: [[$queryCache, localStorageCache({ version: 1, maxAge: 3_600_000 })]] })` —
  cached queries render instantly on the next visit ([details](/recipes/ssr-and-testing)).
- **Router integration**: `attachToRoute({ route, query })` starts/resets queries on navigation
  (atomic-router / @effector/router, [recipe](/recipes/router)).
- **Devtools**: drop in the [devtools panel](/api/devtools) during development.
- **No effector plugin needed**: sids only matter when state crosses a boundary
  (`serialize`/`fork({ values })` between server and client). A pure SPA never serializes, and
  the library's own stores carry explicit sids anyway.

## Testing bonus

Because the app boots from an event, an integration test is three lines:

```ts
const scope = fork();
await allSettled(appStarted, { scope });
expect(scope.getState(usersQuery.$status)).toBe('done');
```
