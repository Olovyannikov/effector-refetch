# Next.js (App Router) example

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Olovyannikov/effector-refetch/tree/main/examples/nextjs?file=src%2Fusers.ts)

Zero-flash SSR with [`@effector/next`](https://github.com/effector/next) and effector-refetch —
**no effector babel/SWC plugin anywhere**, and **all logic in the effector model**, components
only render.

## The pattern

- `src/users.ts` — the model. Two page entry events (`pageStarted`, `userPageStarted`), a
  `$search` store (explicit sid → travels server → client), two queries
  (`createJsonQuery({ name })` — the `name` is what gives stores their stable sids), URL sync
  as an effect. Components contain zero `useState`/`useEffect`.
- `app/layout.tsx` — root `<EffectorNext>` (no values): client-scope access for the whole tree.
- `app/page.tsx`, `app/users/[id]/page.tsx` — server components: read route/search params, then
  `fork()` → `allSettled(pageEvent)` → `serialize(scope)` → nested `<EffectorNext values>`.
- **Page transitions need no extra hooks**: on a client-side navigation Next re-runs the target
  page's server component, the model's page event fires there, and the nested provider hydrates
  the new values into the existing client scope automatically.
- `app/api/*` — deliberately slow (400ms) local API, so the SSR difference is visible.

## Try it

```bash
cd examples/nextjs
npm install
npm run dev   # http://localhost:3000
```

- Open [`/?q=Marg`](http://localhost:3000/?q=Marg) — the filter applies **on the server**: the
  HTML arrives pre-filtered, the input pre-filled from the restored `$search` store.
- Type in the search box — 200ms debounce + `TAKE_LATEST` (superseded requests are really
  aborted; watch the Network tab), and the term mirrors into the URL (shareable).
- Click a user — the detail page (`/users/[id]`) server-renders `userQuery` the same way: the
  bio is in the HTML, the client makes no request on load.
- Devtools → Network, reload any page: no `/api/*` requests on first paint — `status: done`
  arrives serialized.
