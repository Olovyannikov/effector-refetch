# effector-refetch-codemod

Migrate [farfetched](https://ff.effector.dev) (`@farfetched/core`) usage to
[effector-refetch](https://github.com/Olovyannikov/effector-refetch).

```bash
npx effector-refetch-codemod "src/**/*.{ts,tsx}"
npx effector-refetch-codemod "src/**/*.ts" --dry   # preview, write nothing
```

## What it does

- Rewrites imports: `@farfetched/core` → `effector-refetch` — but **only for names that exist
  there**. Names with no equivalent (`declareParams`, `attachOperation`, …) stay on the original
  import with a `// TODO(effector-refetch-codemod)` comment instead of becoming broken imports.
- Rewrites the contract adapter packages: `@farfetched/zod` / `@farfetched/io-ts` /
  `@farfetched/runtypes` → main-entry `zodContract` / `ioTsContract` / `runtypesContract`
  (aliased, so call sites don't change).
- Folds the standalone operators — `retry` / `cache` / `concurrency` / `timeout` (translating
  farfetched's `{ after }` shape) — into the inline config of `createQuery`, `createMutation`,
  `createJsonQuery` and `createJsonMutation`, and removes the now-unused operator imports.
  A conflicting inline option is **overwritten** (the operator ran later — last wins, matching
  farfetched's runtime). Lane keys fold as the object form `concurrency: { strategy, key }`.

  ```ts
  // before
  import { createQuery, retry, cache, concurrency } from '@farfetched/core';
  const userQuery = createQuery({ effect: fetchUserFx });
  retry(userQuery, { times: 3 });
  cache(userQuery, { staleAfter: 60_000 });
  concurrency(userQuery, { strategy: 'TAKE_LATEST' });

  // after
  import { createQuery } from 'effector-refetch';
  const userQuery = createQuery({
    effect: fetchUserFx,
    retry: { times: 3 },
    cache: { staleAfter: 60_000 },
    concurrency: 'TAKE_LATEST',
  });
  ```

- Rewrites `applyBarrier(q, { barrier })` to the positional `applyBarrier(q, barrier)`.
- Migrates the `createJsonQuery` / `createJsonMutation` shape: drops `params: declareParams<T>()`
  (leaving a TODO pointing at the `createJsonQuery<T, Response>` generics), hoists
  `response.mapData` / `response.validate` to the top level (supported inline since 0.17), and
  flags remaining `response` fields (`status`, sourced `{ source, fn }` forms) for hand-migration.
  Unknown imports that end up unreferenced (a dropped `declareParams`) are removed outright.
- **Annotates instead of silently migrating** shapes that differ between the libraries:
  `update(q, { on, by })` (here it's `update({ query, on, fn })`), `keepFresh(q, { automatically })`,
  `createBarrier({ active })`, `retry({ otherwise, mapParams })`, `concurrency({ abortAll })`,
  and farfetched `Time` strings (`'5min'` → milliseconds number).

`connectQuery` keeps the same API — only its import is rewritten. Operators applied to a query
the codemod can't resolve statically (e.g. imported from another module) are left untouched, so
review the diff (grep for `TODO(effector-refetch-codemod)`) and run your formatter afterwards.
