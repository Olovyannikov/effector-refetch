# Vike

[Vike](https://vike.dev) (ex `vite-plugin-ssr`) gives you SSR on top of Vite with per-page
`+data` hooks — which map onto the effector pattern one-to-one: **the `+data` hook is where the
page's entry event fires**.

The model is identical to the [Next.js recipe](/recipes/nextjs) — page entry events, queries
with a stable `name` (that's what gives their stores explicit sids, so **no effector babel/SWC
plugin is needed** for the library's state), your own stores with explicit sids.

```bash
npm i effector effector-react effector-refetch vike vike-react
```

## 1. `+data`: fork → allSettled → serialize

`+data.ts` runs on the server (by default — including client-side navigations, which request it
from the server), one call per page render:

```ts
// pages/users/+data.ts
import { allSettled, fork, serialize } from 'effector';
import type { PageContextServer } from 'vike/types';
import { pageStarted } from '../../src/model';

export async function data(pageContext: PageContextServer) {
  const q = (pageContext.urlParsed.search.q as string | undefined) ?? '';

  const scope = fork();
  await allSettled(pageStarted, { scope, params: { q } });

  return { values: serialize(scope) }; // plain JSON — Vike ships it to the client
}
```

`/users?q=Marg` server-renders with the filter already applied, exactly like the Next.js
version.

## 2. The page: scope from `useData`

Data returned by `+data` reaches the component through `useData()` on both server and client —
build the scope from it and provide it:

```tsx
// pages/users/+Page.tsx
import { useMemo } from 'react';
import { fork } from 'effector';
import { Provider } from 'effector-react';
import { useData } from 'vike-react/useData';
import { UsersScreen } from '../../src/users-screen';

export default function Page() {
  const { values } = useData<{ values: Record<string, unknown> }>();
  // one scope per rendered page; re-forked when a navigation brings new values
  const scope = useMemo(() => fork({ values }), [values]);

  return (
    <Provider value={scope}>
      <UsersScreen />
    </Provider>
  );
}
```

The first client paint already has `$data` filled and `status: 'done'` — no skeleton, no
refetch on mount. Client-side transitions re-run `+data` (server-side) and the page re-forks
with the fresh values.

## 3. Detail pages

Same recipe with route params:

```ts
// pages/users/@id/+data.ts
export async function data(pageContext: PageContextServer) {
  const scope = fork();
  await allSettled(userPageStarted, { scope, params: { id: Number(pageContext.routeParams.id) } });
  return { values: serialize(scope) };
}
```

## Scaling up: per-page entry events via `meta`

The `+data` version above is the minimal one. A production layout (seen in real Vike + effector
apps) declares **two custom page hooks** through Vike's `meta`, so every page ships its own
model entry points and one global `+onBeforeRender` wires them all:

```ts
// pages/+config.ts
export default {
  passToClient: ['values'],
  meta: {
    // server entry: SSR data for the page
    pageInitiated: { env: { client: false, server: true } },
    // client entry: client-only wiring (persist pickup, token-authed queries, …)
    pageStarted: { env: { client: true, server: false } },
  },
};
```

```ts
// pages/+onBeforeRender.ts — one for the whole app
export async function onBeforeRender(pageContext: PageContextServer) {
  const scope = fork();
  const { pageInitiated } = pageContext.config;
  if (pageInitiated) {
    await allSettled(pageInitiated, {
      scope,
      // pass a NARROW payload, not the whole pageContext — otherwise
      // PageContextServer leaks into your queries' params types
      params: { routeParams: pageContext.routeParams, search: pageContext.urlParsed.search },
    });
  }
  return { pageContext: { values: serialize(scope) } };
}
```

```ts
// pages/users/+pageInitiated.ts — per page, pure model wiring
export const pageInitiated = createPageInit(); // createEvent<{ routeParams; search }>()
sample({ clock: pageInitiated, fn: ({ search }) => ({ q: search.q ?? '' }), target: usersQuery.start });
```

`pageStarted` is fired from a small client provider on each navigation — the place for
client-only concerns (e.g. `effector-storage`'s `persist(..., { pickup: pageStarted })`, or
queries whose auth token lives in `localStorage`).

## Notes

- **Per-page scope vs a persistent client scope**: the minimal setup re-forks per page —
  client-only state outside the serialized values resets on navigation. A persistent singleton
  client scope (one `fork()` for the whole session, new values injected on each navigation) is
  what `@effector/next` implements for Next — Vike has no maintained equivalent, so apps vendor
  those scope-injection internals by hand. If you go that way, effector-refetch's public stores
  already carry explicit sids, so the library's state hydrates without the effector babel/SWC
  plugin — only your own stores need sids.
- **Narrow payloads.** Don't feed the whole `pageContext` into entry events: it flows into
  `query.start` and the server-only context type leaks into your effects' params.
- **`+data` / `+onBeforeRender` stay server-side** by default — your API keys and DB clients
  can live there. If a page should fetch client-side on navigation instead, run the query from
  the client `pageStarted` event.
- The **cache layer** (`$queryCache` + `dehydrate`/`hydrate`) composes exactly as in
  [SSR & testing](/recipes/ssr-and-testing) — put the adapter into the server fork and ship
  `dehydrate(cache)` alongside `values`.
