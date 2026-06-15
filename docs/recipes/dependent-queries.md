# Dependent queries

When one request needs the result of another (fetch a character, then its origin location),
[`connectQuery`](/api/queries) wires them: when the **source** succeeds it computes the **target**'s
params and starts it. No `sample` boilerplate, no effect in a component.

## One source

```ts
import { createQuery, connectQuery } from 'effector-refetch';

const characterQuery = createQuery({ effect: fetchCharacterFx, cache: true });
const originQuery = createQuery({ effect: fetchLocationFx, cache: { staleAfter: 60_000 } });

connectQuery({
  source: characterQuery,
  fn: ({ result: character }) => ({ params: { url: character.origin.url } }),
  target: originQuery,
});

characterQuery.start(1); // originQuery starts automatically when the character resolves
```

`fn` receives `{ result, params }` of the source (the result, plus the params it ran with) and
returns `{ params }` for the target. It re-runs every time the source succeeds, so the target stays
in sync — and since both are plain queries, `cache` / `retry` / `concurrency` apply to each
independently.

## Several sources

Pass an object of queries — the target starts once **all** of them are `done`, then again whenever
any of them produces a fresh result:

```ts
connectQuery({
  source: { user: userQuery, settings: settingsQuery },
  fn: ({ user, settings }) => ({ params: { id: user.result.id, theme: settings.result.theme } }),
  target: dashboardQuery,
});
```

Each key in `fn`'s argument is `{ result, params }` for that source.

## Gating with `filter`

`filter` skips the target run when the source result isn't usable yet (same `{ result, params }`
shape, return `false` to skip):

```ts
connectQuery({
  source: characterQuery,
  filter: ({ result: character }) => character.origin.url !== '', // unknown origin -> don't fetch
  fn: ({ result: character }) => ({ params: { url: character.origin.url } }),
  target: originQuery,
});
```

## `connectQuery` vs `combineQueries`

- **`connectQuery`** — _chains_: a source feeds the next query's **params** (request B depends on
  A's result).
- [**`combineQueries`**](/api/queries) — _aggregates_: read several independent queries as one
  combined `$data` / `$pending` / `$errors` (the effector-flavored `useQueries`), with no
  dependency between them.

Runnable:
[`examples/rick-and-morty.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/rick-and-morty.ts).
