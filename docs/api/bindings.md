# Framework bindings

A query implements effector's `@@unitShape` protocol, so you can pass it straight to
`useUnit` from **effector-react**, **effector-vue** or **effector-solid** — no wrapper needed.

```tsx
// React
import { useUnit } from 'effector-react';

function UserCard({ id }: { id: number }) {
  const { data, pending, error, refetch } = useUnit(userQuery);
  return pending ? <Spinner /> : <div onClick={() => refetch(id)}>{data?.name}</div>;
}
```

```vue
<!-- Vue -->
<script setup lang="ts">
import { useUnit } from 'effector-vue/composition';
const { data, pending, refetch } = useUnit(userQuery);
</script>
```

`useUnit(query)` yields `{ data, error, status, pending, isInitialLoading, isRefetching,
stale, enabled, params, start, refetch, refresh, reset, cancel }`. `isInitialLoading` is a
run with no real data yet (skeleton); `isRefetching` — a run over existing data (spinner).

## useQuery helpers

Thin helpers that add derived booleans (`isInitial / isPending / isDone / isFail`):

```tsx
// React — effector-refetch/react
import { useQuery } from 'effector-refetch/react';
const { data, isPending, isFail, error, start } = useQuery(userQuery);
useEffect(() => start(id), [id]); // queries never auto-start
```

```vue
<!-- Vue — effector-refetch/vue (returns refs) -->
<script setup lang="ts">
import { useQuery } from 'effector-refetch/vue';
const { data, isPending, isDone, start } = useQuery(userQuery);
</script>
```

```tsx
// Solid — effector-refetch/solid (returns accessors — call them)
import { useQuery } from 'effector-refetch/solid';

function UserCard(props: { id: number }) {
  const { data, isPending, isFail, start } = useQuery(userQuery);
  start(props.id); // queries never auto-start
  return <div>{isPending() ? 'Loading…' : data()?.name}</div>;
}
```

React works with `<Provider value={scope}>`, Vue with the `EffectorScopePlugin`, Solid with
effector-solid's `<Provider>` — all for SSR / `fork`. Bindings require the matching optional
peers (`react`+`effector-react` / `vue`+`effector-vue` / `solid-js`+`effector-solid`).

## Refetch on mount

`useQuery` (all three frameworks) takes an options object — `refetchOnMount` refetches the query
**with its last params** when the component subscribes:

```ts
useQuery(userQuery, { refetchOnMount: true }); // refetch only if data is stale
useQuery(userQuery, { refetchOnMount: 'always' }); // refetch every mount
```

It's a no-op until the query has run at least once (`status !== 'initial'`) and is enabled —
it never starts a query that has no params yet. `true` needs a `cache.staleAfter` to have a notion
of staleness; `'always'` ignores it.

## Suspense (React)

`useSuspenseQuery` returns the data directly (never `null`): it **auto-starts** the query,
suspends the nearest `<Suspense>` while loading, throws to the nearest Error Boundary on failure,
and returns the data when done.
The suspense promise is cached per (scope, query) and dropped on settle; a query holds a single
state, so when several components suspend on the same query, the first starter's params win.

```tsx
import { Suspense } from 'react';
import { useSuspenseQuery } from 'effector-refetch/react';

function UserName({ id }: { id: number }) {
  const user = useSuspenseQuery(userQuery, id); // suspends until ready
  return <span>{user.name}</span>;
}

function Page({ id }: { id: number }) {
  return (
    <ErrorBoundary fallback={<p>Failed to load</p>}>
      <Suspense fallback={<Spinner />}>
        <UserName id={id} />
      </Suspense>
    </ErrorBoundary>
  );
}
```

This is for **client-side** Suspense: reads and triggers are scope-aware, but the settle signal
is observed globally, so use it with `fork` outside of concurrent SSR streaming.
