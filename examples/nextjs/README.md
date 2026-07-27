# Next.js (App Router) example

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Olovyannikov/effector-refetch/tree/main/examples/nextjs?file=app%2Fpage.tsx)

Zero-flash SSR with [`@effector/next`](https://github.com/effector/next) and effector-refetch —
**no effector babel/SWC plugin anywhere**:

- `src/users.ts` — a `createJsonQuery({ name: 'users', … })` declared once at module level.
  The `name` gives the query stable sids (`er/users/$data`, …), which is what lets
  `serialize(scope)` transfer its state.
- `app/page.tsx` — a **server component**: `fork()` per request → `allSettled(usersQuery.start)`
  → `serialize(scope)` → `<EffectorNext values>`.
- `app/users-screen.tsx` — a client component reading the query with `useUnit`. The first paint
  already has the data and `status: 'done'` — no skeleton, no refetch on mount. Typing in the
  search box re-runs the query client-side with a 200ms debounce and `TAKE_LATEST` (the
  superseded request is actually aborted).
- `app/api/users/route.ts` — a deliberately slow (400ms) local API, so the SSR difference is
  visible: the server waits for data before streaming HTML.

```bash
cd examples/nextjs
npm install
npm run dev   # http://localhost:3000
```

To see the no-flash behavior, open devtools → Network → disable cache, reload: the HTML response
already contains the user list; the client makes **no** `/api/users` request on load.
