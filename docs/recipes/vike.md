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

## Notes

- **Per-page scope**: unlike `@effector/next` (which merges values into one client scope), this
  minimal setup re-forks per page — client-only state living outside the serialized values
  resets on navigation. If you need a persistent client scope, keep it in a module singleton
  and `hydrate`-merge values into it instead of re-forking.
- **`+data` stays server-side** by default — your API keys and DB clients can live in it. If a
  page should fetch client-side on navigation instead, run the query from a client event rather
  than `+data`.
- The **cache layer** (`$queryCache` + `dehydrate`/`hydrate`) composes exactly as in
  [SSR & testing](/recipes/ssr-and-testing) — put the adapter into the `+data` fork and ship
  `dehydrate(cache)` alongside `values`.
