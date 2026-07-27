# Next.js (App Router)

Zero-flash SSR with [`@effector/next`](https://github.com/effector/next): the server renders a
page with the query **already settled**, the client picks the state up with no skeleton and no
refetch on mount — and **no effector babel/SWC plugin is required** for the library's stores
(they ship with explicit stable sids, see the note below).

A complete runnable app lives in
[`examples/nextjs`](https://github.com/Olovyannikov/effector-refetch/tree/main/examples/nextjs).

```bash
npm i effector effector-react @effector/next effector-refetch
```

## The pattern

Four pieces, all logic in the model — components only render.

### 1. The model: page events in, queries out

One **entry event per page**. The server fires it per request; sample wires it to the queries.

```ts
// src/users.ts
import { createEvent, createStore, sample } from 'effector';
import { createJsonQuery, debounce } from 'effector-refetch';

export const usersQuery = createJsonQuery<{ q: string }, User[]>({
  name: 'users', // ← the name gives $data/$status/$params their stable sids
  request: { url: `${base}/api/users`, query: ({ q }) => (q ? { q } : {}) },
  concurrency: 'TAKE_LATEST', // typing aborts the superseded request
});
debounce(usersQuery, 200);

export const pageStarted = createEvent<{ q: string }>();
export const searchChanged = createEvent<string>();

// your OWN stores need explicit sids to travel (or use @effector/swc-plugin)
export const $search = createStore('', { sid: 'app/$search' })
  .on(pageStarted, (_, { q }) => q)
  .on(searchChanged, (_, q) => q);

sample({ clock: pageStarted, target: usersQuery.start });
sample({ clock: searchChanged, fn: (q) => ({ q }), target: usersQuery.start });
```

### 2. Root layout: a bare provider

```tsx
// app/layout.tsx
<Providers>{children}</Providers> // <EffectorNext> without values — scope access for the tree
```

### 3. Pages: fork → allSettled(pageEvent) → serialize

```tsx
// app/page.tsx — a server component
import { allSettled, fork, serialize } from 'effector';
import { pageStarted } from '../src/users';

export const dynamic = 'force-dynamic'; // SSR per request, not a static page

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const scope = fork();
  await allSettled(pageStarted, { scope, params: { q } });
  return (
    <Providers values={serialize(scope)}>
      <UsersScreen />
    </Providers>
  );
}
```

`/?q=Marg` renders server-side with the filter already applied — `$search`, `$data`, `$status`
all arrive serialized.

### 4. Components: `useUnit`, nothing else

```tsx
'use client';
const { users, status, q, onSearch } = useUnit({
  users: usersQuery.$data,
  status: usersQuery.$status,
  q: $search,
  onSearch: searchChanged,
});
```

No `useState`, no `useEffect` — the first paint already has `status: 'done'` and the data.

## Page transitions — no extra hooks

On a client-side navigation Next **re-runs the target page's server component**: the model's
page event fires there, and the page's nested `<EffectorNext values>` hydrates the fresh values
into the existing client scope automatically. A detail route is the same recipe with its own
entry event:

```tsx
// app/users/[id]/page.tsx
export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = fork();
  await allSettled(userPageStarted, { scope, params: { id: Number(id) } });
  return (
    <Providers values={serialize(scope)}>
      <UserCard />
    </Providers>
  );
}
```

## Why no effector plugin?

`serialize(scope)` only picks up stores that have sids. Bundler plugins never process a prebuilt
`node_modules` dist — so effector-refetch assigns **explicit stable sids** to the public stores
(`er/<name>/$data`, …). Two rules follow:

- give queries a stable **`name`** — sids (and cache namespaces) derive from it, which keeps
  them identical between the separately-compiled server and client bundles;
- **your own** stores still need sids: pass one explicitly (`createStore('', { sid: '…' })`) or
  add [`@effector/swc-plugin`](https://github.com/effector/swc-plugin) for your app code.

## Practices from production

Conventions proven by real SSR + effector codebases that transfer to this setup as-is:

- **Narrow event payloads.** Fire `pageStarted` with exactly what the model needs
  (`{ q }`, `{ id }`) — never the whole `searchParams`/context object. A wide payload flows
  through `sample` into `query.start`, and framework types leak into your effects' params.
- **Two kinds of entry events.** Server page events (`pageStarted`, `userPageStarted`) carry
  SSR data. Add a **client-only** `appStarted` — fired once from a small client component on
  hydration — for wiring that can't run on the server: `effector-storage`'s
  `persist(..., { pickup: appStarted })`, queries whose auth token lives in `localStorage`,
  analytics.
- **Slice layout.** At scale, keep each domain slice as `api/` (queries/mutations) + `model/`
  (entry events, `sample` wiring) + `ui/` (dumb `useUnit` views) — the FSD convention; the
  page files stay thin adapters that only translate route params into model events.
- **Components never call `.start`.** Every query start goes through an event + `sample` — the
  component's only job is `useUnit`. This is what keeps the whole flow replayable in tests via
  `allSettled(pageStarted, { scope, params })`.

## Server-side URLs

Relative URLs only exist in the browser. On the server, point the request at your own origin:

```ts
const base = typeof window === 'undefined' ? `http://localhost:${process.env.PORT ?? 3000}` : '';
```

## Cache layer (optional)

`serialize` transfers the **store layer**. If you also use `cache: { staleAfter }` and want the
server's entries to age correctly on the client, add the **cache layer** — per-request adapter
via `$queryCache` + `dehydrate`/`hydrate` — as described in
[SSR & testing](/recipes/ssr-and-testing).
