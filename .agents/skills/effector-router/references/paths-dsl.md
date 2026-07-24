# Path pattern DSL (`@effector/router-paths`)

Standalone package: `npm install @effector/router-paths`. Used internally by `@effector/router` (`createRoute({ path })`) and usable on its own.

## Core API

```ts
import { compile, convertPath, ParseUrlParams } from '@effector/router-paths';

const { parse, build } = compile('/user/:id<number>');
parse('/user/123'); // { path: '/user/123', params: { id: 123 } }
parse('/user/abc'); // null (validation failed)
build({ id: 456 }); // '/user/456'
```

- `compile<T>(path: T)` returns `{ parse: (path: string) => { path: string; params: Params } | null; build: (params: Params) => string }`.
- `parse` returns `null` on any mismatch (wrong type, not in union, wrong segment count). `build` throws on invalid input (value not in union, array bound violated, missing required param).
- Compile once at module scope and reuse; do not recompile per call.

## Pathname-only patterns

`compile` accepts **pathname patterns only**. These throw at compile time:

```ts
compile('/user?id=123'); // throws: query/hash is not part of a pattern
compile('https://example.com/u'); // throws: origins are not patterns
compile('/user/:ids{3,2}'); // throws: invalid range (min > max)
```

Query strings are never part of the pattern DSL — see "Query typing" below.

## Parameter syntax

| Pattern                                    | Inferred params type                              | Notes                                                                   |
| ------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------- |
| `/user/:name`                              | `{ name: string }`                                | default type is string                                                  |
| `/post/:id<number>`                        | `{ id: number }`                                  | parse validates; `/post/abc` → `null`                                   |
| `/edit/:mode<create\|update\|delete>`      | `{ mode: 'create' \| 'update' \| 'delete' }`      | union; build throws for value outside union                             |
| `/blog/:year<number>/:month<number>/:slug` | `{ year: number; month: number; slug: string }`   | multiple params                                                         |
| `/user/:id?`                               | `{ id?: string }`                                 | optional segment                                                        |
| `/post/:id<number>?`                       | `{ id?: number }`                                 | optional + type                                                         |
| `/category/:tags+`                         | `{ tags: string[] }`                              | one or more; `parse('/category')` → `null`                              |
| `/files/:path*`                            | `{ path: string[] }`                              | zero or more (wildcard); `parse('/files')` → `{ params: { path: [] } }` |
| `/path/:segments{2,3}`                     | `{ segments: string[] }`                          | exact range of segment count                                            |
| `/items/:ids<number>{1,3}?`                | `{ ids?: number[] }`                              | modifier order: `<type>` then `{range}`/`+`/`*` then `?`                |
| `/tag/:names<create\|update\|delete>{2,2}` | `{ names: ('create' \| 'update' \| 'delete')[] }` | typed range                                                             |

### Optional (`?`)

```ts
const { parse, build } = compile('/user/:id?');
build({}); // '/user'
parse('/user'); // { path: '/user', params: {} }  — key OMITTED, not undefined
parse('/user/456'); // { path: '/user/456', params: { id: '456' } }
```

When the segment is absent, the parser omits the optional key from `params` entirely.

### Repeating (`+`, `*`) and ranges (`{min,max}`)

- `+` requires at least one value; `*` allows an empty array (`build({ path: [] })` → base path).
- `{min,max}` enforces both bounds on parse and build: `compile('/path/:segments{2,3}')` — `build({ segments: ['a'] })` throws; `parse('/path/w/x/y/z')` → `null`.
- A **present** value must still satisfy the bound even when the segment is optional:

```ts
const repeated = compile('/tags/:id+?');
repeated.build({}); // '/tags'
repeated.build({ id: [] }); // throws: Parameter "id" expects at least 1 value
```

## Type inference

```ts
import { ParseUrlParams } from '@effector/router-paths';

type UserParams = ParseUrlParams<'/user/:id<number>'>; // { id: number }
type TagsParams = ParseUrlParams<'/tags/:items+'>; // { items: string[] }
type OptParams = ParseUrlParams<'/post/:id?'>; // { id?: string }
```

`build` is type-checked against the inferred params: `build({ id: '123' })` on a `<number>` param is a TS error, as is a missing required param or an extra key not declared in the template. Pattern for reusable templates:

```ts
const USER_PATH = '/user/:id<number>/profile' as const;
type UserPathParams = ParseUrlParams<typeof USER_PATH>;
```

## Use with `createRoute`

```ts
// From @effector/router core:
function createRoute<T extends string>(config: {
  path: T;
  parent?: Route<any>;
}): PathRoute<ParseUrlParams<T>>;
function createRoute<Params extends object | void = void>(config?): PathlessRoute<Params>; // no path

const userRoute = createRoute({ path: '/user/:id' }); // Route<{ id: string }>
userRoute.open({ params: { id: '123' } });
```

- With a `parent`, the child route receives the **intersection** of parent and child params; the parent keeps only params declared by its own path. Duplicate param names across parent/child are rejected during path validation.
- Parameterized routes use only the params supplied by the current open; missing values are never merged from previous route state.

## Query typing

Queries are not expressible in path patterns. The core query types (`@effector/router`):

```ts
type QueryValue = string | null | Array<string | null>;
type Query = Record<string, QueryValue>;
type QueryInput = Record<string, QueryValue | undefined>; // undefined keys are omitted
```

- `router.$query` stores the normalized `Query`; input payloads may use `QueryInput` when a key must be removed.
- `route.open({ query })` semantics: omitting `query` **preserves** the current URL query; a provided object **replaces** it; `query: {}` **clears** it. `Link` href follows the same rules.
- Typed/validated query params: use `trackQuery({ controls, routes?, parameters })` from `@effector/router` with a Zod schema (`parameters: ZodType`). Returns `QueryTracker<T>` with `$state` (`inactive | pending | entered`), `enter: Event<z.infer<T>>`, `entered`, `exit`, `exited`. `enter` accepts only schema-declared keys with URL-compatible values (`string`, `null`, arrays of those) — convert numbers/dates/booleans yourself; a schema transform can expose domain values via `entered` output.

## Converting to Express format

```ts
import { convertPath } from '@effector/router-paths';
convertPath('/users/:id<number>', 'express');
```

| effector/router pattern | Express result | Description                 |
| ----------------------- | -------------- | --------------------------- |
| `:id<.+>`               | `:id`          | removes regex/type patterns |
| `:id+`                  | `*id`          | one or more → wildcard      |
| `:id*`                  | `*id`          | zero or more → wildcard     |
| `:id{.+}`               | `*id`          | custom regex → wildcard     |
| `:id?`                  | `{:id}`        | wraps optional params       |
| `*id?`                  | `{*id}`        | wraps optional wildcards    |

Example: `convertPath('/api/:version?/*path?', 'express')` → `'/api{/:version}/{/*path}'`.

## Pitfalls

- `parse` returns `null`, it never throws; `build` throws — handle both.
- Optional keys are omitted from `params` when absent (check with `'id' in params`, not `params.id === undefined` semantics from other routers).
- `+` with `?`: `build({})` is fine, `build({ id: [] })` throws (empty array does not satisfy `+`).
- Do not put query/hash/origin in a pattern — `compile` throws immediately.
- Modifier order matters: type annotation first, then repetition/range, then `?` (e.g. `:ids<number>{1,3}?`).
