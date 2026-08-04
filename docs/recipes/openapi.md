# OpenAPI codegen (hey-api / apicraft)

If your backend publishes an OpenAPI spec, you don't have to write queries by hand.
`effector-refetch/openapi` is a plugin for [`@hey-api/openapi-ts`](https://heyapi.dev) that
generates a ready-made, fully typed **`createQuery` for every GET** operation and
**`createMutation` for every POST/PUT/PATCH/DELETE** — wired through `createRequestFx`, so
cancellation (`cancel` / `TAKE_LATEST`) actually aborts the underlying HTTP request.

## Setup

```bash
npm i -D @hey-api/openapi-ts@0.82
```

::: warning Version
The plugin targets the `0.82.x` plugin API of `@hey-api/openapi-ts` (later versions changed
it). This is also exactly the line pinned by [apicraft](https://github.com/siberiacancode/core/tree/main/packages/apicraft).
:::

```ts
// openapi-ts.config.ts
import { defineConfig } from '@hey-api/openapi-ts';
import { defineConfig as effectorRefetch } from 'effector-refetch/openapi';

export default defineConfig({
  input: './openapi.json', // or a URL
  output: './src/api',
  plugins: ['@hey-api/client-fetch', effectorRefetch()],
});
```

```bash
npx openapi-ts
```

## What gets generated

Next to hey-api's usual `types.gen.ts` / `sdk.gen.ts` you get `refetch.gen.ts`:

```ts
// src/api/refetch.gen.ts (generated)
import { createRequestFx, createQuery, createMutation } from 'effector-refetch';
import { type Options, getPetById, addPet } from './sdk.gen';
import type { GetPetByIdData, AddPetData } from './types.gen';

/**
 * Query for `GET /pet/{petId}`
 * Find pet by ID.
 */
export const getPetByIdQuery = createQuery({
  name: 'getPetById',
  effect: createRequestFx((params: Options<GetPetByIdData>, { signal }: { signal: AbortSignal }) =>
    getPetById({ ...params, signal, throwOnError: true }).then((r) => r.data),
  ),
});

export const addPetMutation = createMutation({
  name: 'addPet',
  effect: createRequestFx((params: Options<AddPetData>, { signal }: { signal: AbortSignal }) =>
    addPet({ ...params, signal, throwOnError: true }).then((r) => r.data),
  ),
});
```

Details worth knowing:

- **Typed end to end.** Params are the SDK's `Options<…Data>` (path/query/body from the spec),
  `$data` is the spec's response type — no casts.
- **Abortable.** The run's `AbortSignal` goes into the SDK call, so `cancel`, `TAKE_LATEST`,
  timeouts and `attachToRoute` cancellation abort the real request.
- **Real errors.** `throwOnError: true` turns non-2xx responses into rejections, so `$error` /
  `retry` / `fallback` see them.
- **Stable names.** Each unit gets `name: '<operationId>'` — cache namespaces and devtools
  labels are stable without the effector babel/SWC plugin.
- **Your config still applies.** The generated definitions are plain queries — compose them
  with operators as usual:

```ts
import { retry, cache } from 'effector-refetch';
import { getPetByIdQuery } from './api/refetch.gen';

retry(getPetByIdQuery, { times: 3 });
cache(getPetByIdQuery, { staleAfter: 60_000 });
```

## Paginated operations

Opt in with `infinite`, and every paginated operation gets a `createInfiniteQuery` twin next to
its plain query. The one thing a spec can never describe is **where the next cursor lives in the
response**, so you supply that rule and the generated file imports it:

```ts
// openapi-ts.config.ts
effectorRefetch({
  infinite: {
    getNextPageParam: { module: './pagination', name: 'byNextPage' },
  },
});
```

```ts
// src/api/pagination.ts — yours, not generated
export const byNextPage = ({ lastPage }: { lastPage: { nextPage?: number | null } }) =>
  lastPage.nextPage ?? null;
```

```ts
// src/api/refetch.gen.ts — generated
export const listPetsInfiniteQuery = createInfiniteQuery({
  name: 'listPets.infinite',
  initialPageParam: 1 as number,
  getNextPageParam: byNextPage,
  effect: createRequestFx(
    (
      { params, pageParam }: { params: Options<ListPetsData>; pageParam: number },
      { signal }: { signal: AbortSignal },
    ) =>
      listPets({
        ...params,
        query: { ...params.query, page: pageParam },
        signal,
        throwOnError: true,
      }).then((r) => r.data),
  ),
});
```

Use it like any infinite query — `start` takes the operation's own params, the cursor is managed
for you:

```ts
listPetsInfiniteQuery.start({ query: { limit: 20 } });
listPetsInfiniteQuery.fetchNext();
```

**Which operations count.** By default, query operations whose spec marks a query parameter as a
pagination cursor — hey-api flags `page`, `offset`, `cursor`, `after`, `before`, `start` itself.
Override with `match` and `pageParam` when your API names things differently.

**The first page.** `page` starts at `1`, `offset` / `start` at `0`, anything else at `null`. A
`null` cursor makes the param type nullable and the first request goes out **without** the
parameter — no `?cursor=null`. Set `initialPageParam` to change it.

**Per operation.** Every option except `match` and `suffix` also accepts a function, so one
config can serve several pagination styles:

```ts
effectorRefetch({
  infinite: {
    getNextPageParam: ({ pageParam }) =>
      pageParam === 'cursor'
        ? { module: './pagination', name: 'byNextCursor' }
        : { module: './pagination', name: 'byNextPage' },
    getPreviousPageParam: ({ pageParam }) =>
      pageParam === 'page' ? { module: './pagination', name: 'byPrevPage' } : undefined,
  },
});
```

A mismatched rule is a **compile error**, not a runtime surprise: the generated query types
`getNextPageParam` against the operation's own page type, so handing a number-based rule to a
string cursor fails `tsc`.

## Options

```ts
effectorRefetch({
  output: 'refetch', // generated file name -> refetch.gen.ts
  exportFromIndex: false, // re-export from the output index.ts
  infinite: {
    getNextPageParam: { module: './pagination', name: 'byNextPage' }, // required to enable
    getPreviousPageParam: undefined, // enables fetchPrevious
    match: undefined, // (ctx) => boolean — default: the spec's pagination parameter
    pageParam: undefined, // override the cursor parameter name
    initialPageParam: undefined, // override the first-page value
    suffix: 'InfiniteQuery', // export name suffix
  },
});
```

Query-vs-mutation is decided by hey-api's `isQuery` hook (GET → query by default) and respects
your `~hooks.operations` overrides in the hey-api config.

## With apicraft

[apicraft](https://github.com/siberiacancode/core/tree/main/packages/apicraft) is a thin wrapper
over the same `@hey-api/openapi-ts` version, so the generated `sdk.gen.ts` / `types.gen.ts` are
identical — the plugin output composes with an apicraft-managed API layer as-is. Until apicraft
supports external plugins in its config, run `openapi-ts` with this plugin alongside it (same
`input`/`output`).
