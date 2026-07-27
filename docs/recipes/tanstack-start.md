# TanStack Start

[TanStack Start](https://tanstack.com/start) is full-stack React on TanStack Router. Its key
property for effector: **route loaders are isomorphic** — they run on the server for the first
render and on the client for subsequent navigations. That makes the integration tiny: run the
page's entry event in the loader, return `serialize(scope)` as loader data, and let the
router's built-in dehydration carry it across.

The model is identical to the [Next.js recipe](/recipes/nextjs) — page entry events, queries
with a stable `name` (their stores ship explicit sids, so **no effector babel/SWC plugin is
needed** for the library's state), your own stores with explicit sids.

```bash
npm i effector effector-react effector-refetch
```

## 1. The loader: fork → allSettled → serialize

Loader data must be serializable — `serialize(scope)` returns plain JSON, so the router
dehydrates/rehydrates it automatically with the rest of the loader data:

```tsx
// src/routes/users.tsx
import { createFileRoute } from '@tanstack/react-router';
import { allSettled, fork, serialize } from 'effector';
import { pageStarted } from '../model';

export const Route = createFileRoute('/users')({
  validateSearch: (search) => ({ q: (search.q as string) ?? '' }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps }) => {
    const scope = fork();
    await allSettled(pageStarted, { scope, params: deps });
    return { values: serialize(scope) };
  },
  component: UsersPage,
});
```

`/users?q=Marg` renders on the server with the filter already applied. On a client-side
navigation the same loader runs **in the browser** — a fresh fork, the query fetches
client-side, and the page gets its values the same way. One code path for both.

## 2. The component: scope from loader data

```tsx
import { useMemo } from 'react';
import { fork } from 'effector';
import { Provider } from 'effector-react';

function UsersPage() {
  const { values } = Route.useLoaderData();
  const scope = useMemo(() => fork({ values }), [values]);

  return (
    <Provider value={scope}>
      <UsersScreen />
    </Provider>
  );
}
```

First paint arrives with `$data` filled and `status: 'done'` — no skeleton, no refetch on
mount. `UsersScreen` is the usual `useUnit` view, zero `useState`/`useEffect`
([see the Next.js recipe](/recipes/nextjs#_4-components-useunit-nothing-else)).

## 3. Detail routes

```tsx
// src/routes/users.$id.tsx
export const Route = createFileRoute('/users/$id')({
  loader: async ({ params }) => {
    const scope = fork();
    await allSettled(userPageStarted, { scope, params: { id: Number(params.id) } });
    return { values: serialize(scope) };
  },
  component: UserPage,
});
```

## Notes

- **Server-only work belongs in server functions.** The loader is isomorphic, so anything
  inside it ships to the client bundle. If the effect needs secrets or a DB, wrap that part in
  `createServerFn` and call it from the query's effect — the query machinery (retry, cache,
  concurrency, abort) still applies around it.
- **Per-route scope**: this minimal setup forks per route, so client-only state outside the
  serialized values resets on navigation. For a persistent client scope, keep a module
  singleton and merge loader values into it instead of re-forking.
- The **cache layer** (`$queryCache` + `dehydrate`/`hydrate`) composes as in
  [SSR & testing](/recipes/ssr-and-testing): put the adapter into the loader's fork and return
  `dehydrate(cache)` alongside `values`.
