# HTTP & validation

## createRequestFx

Wrap any HTTP client into a typed, abort-aware effector effect with normalized errors:

```ts
import { ofetch } from 'ofetch';
import { createRequestFx, createQuery } from 'effector-refetch';

const getUserFx = createRequestFx<{ id: number }, User>(({ id }, { signal }) =>
  ofetch(`/api/users/${id}`, { signal }),
);
const userQuery = createQuery({ effect: getUserFx, cache: true });
```

The handler receives an `AbortSignal`; the query owns the controller and fires it on
`cancel` / `reset` and on `TAKE_LATEST` supersede — so the request actually aborts.
Errors are normalized to `RequestError` (`status`, `data`). It returns an `AbortableEffect`
(exported, if you need to annotate it); pass it to `createQuery` / `createMutation` / etc. just
like a plain `Effect`.

### Error guards

Narrow `$error` / `finished.fail` payloads with typed guards instead of `instanceof` + casts:

```ts
import { isRequestError, isHttpError, isTimeoutError, isValidationError } from 'effector-refetch';

isHttpError(error); // a RequestError carrying a status
isHttpError(error, 404); // exactly 404
isHttpError(error, (s) => s >= 500); // any 5xx
isTimeoutError(error); // aborted past its `timeout`
isValidationError(error); // a failed contract / validate (narrows to .validationErrors)
isRequestError(error); // any normalized transport error
```

```ts
import { sample } from 'effector';

// refresh the token on a 401
sample({
  clock: api.finished.fail,
  filter: ({ error }) => isHttpError(error, 401),
  target: authBarrier.lock,
});

// a friendly message per error kind
const $message = api.$error.map((e) =>
  isHttpError(e, (s) => s >= 500) ? 'Server error' : isTimeoutError(e) ? 'Timed out' : e ? 'Failed' : null,
);
```

More in the [error-handling recipe](/recipes/error-handling#type-guards).

It's just an effect, so anything works inside: multipart **FormData** uploads
([`examples/form-data.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/form-data.ts)),
**GraphQL** (POST `{ query, variables }` — see the [GraphQL recipe](/recipes/graphql)),
or streaming updates ([SSE & WebSocket](/recipes/streaming)).

### Composing with `attach`

A `createRequestFx` effect is a **regular `Effect<Params, Result>`**: the per-run
`AbortSignal` reaches the handler through a synchronous side channel, not inside the
params. So it can be called directly (`getUserFx({ id: 1 })` — no cancellation outside a
query run) and wrapped in a **plain `attach`** — mapped params, injected stores, and real
cancellation all survive:

```ts
import { attach, createStore } from 'effector';
import { createRequestFx, createQuery } from 'effector-refetch';

const $userId = createStore('user-123');

const getPostsForUserFx = attach({
  source: { userId: $userId }, // read fork-correctly per scope
  mapParams: (search: string, { userId }) => ({ search, userId, limit: 20 }),
  effect: getPostsFx, // a createRequestFx effect — stays cancellable through attach
});

const postsQuery = createQuery({ effect: getPostsForUserFx, cache: true });
```

When the mapping belongs to a single query, the inline
[`createQuery({ source, mapParams })`](/api/queries#params-mapping-source-mapparams) sugar
does the same without a separate effect — and keys the cache by the **mapped** params
(with a hand-rolled `attach` the cache only sees the public params).
Runnable demo: [`examples/map-params.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/map-params.ts).

## createJsonQuery

Declarative endpoint over the global `fetch` (no HTTP-client dependency):

```ts
import { createJsonQuery, HTTP_METHODS, zodContract } from 'effector-refetch';

export const getProductsQuery = createJsonQuery({
  request: { url: 'https://api/products', query: ({ search }) => ({ search, limit: 20 }) },
  response: { contract: zodContract(ProductList) },
  concurrency: 'TAKE_LATEST',
  cache: { staleAfter: 30_000 },
});

export const createUser = createJsonQuery<NewUser, User>({
  request: { url: 'https://api/users', method: HTTP_METHODS.POST, body: (u) => u },
});
```

`request`: `{ url, method?, query?, body?, headers? }`. Each field is a function of params
(or, for `url`, a static string). Abort-aware, normalized `RequestError`, optional contract,
plus all the usual query options.

`mapData` / `validate` work inline too (same semantics as `createQuery`'s — `mapData` reshapes
the validated response before `$data`, `validate` composes after the contract):

```ts
const userNameQuery = createJsonQuery<{ id: number }, { user: User }, string>({
  request: { url: ({ id }) => `/api/users/${id}` },
  mapData: ({ result }) => result.user.name,
  validate: ({ result }) => result.user != null || ['empty user'],
});
```

### Sourced fields (reactive, fork-correct)

Any request field can also be read from a `Store` — handy for an auth token or base URL that
lives in state. It's wired through `attach`, so each `fork`/SSR scope uses its own value:

```ts
const userQuery = createJsonQuery<{ id: number }>({
  request: {
    // combine a store with params via { source, fn }
    url: { source: $apiBase, fn: (base, { id }) => `${base}/users/${id}` },
    // or pass a Store directly
    headers: { source: $token, fn: (token) => ({ authorization: `Bearer ${token}` }) },
  },
});
```

A field is `(params) => T`, a `Store<T>`, or `{ source: Store, fn: (value, params) => T }`.
Stores are resolved per scope at request time — no global mutable client.

## createJsonMutation

The write-side mirror of `createJsonQuery`: same `request` shape (sourced fields included),
defaults to `POST`, returns a `Mutation` (no cache / refresh / stale).

```ts
import { createJsonMutation, invalidate } from 'effector-refetch';

const createUser = createJsonMutation<NewUser, User>({
  request: { url: 'https://api/users', body: (u) => u }, // method defaults to POST
});

const deleteUser = createJsonMutation<number>({
  request: { url: (id) => `https://api/users/${id}`, method: HTTP_METHODS.DELETE },
});

invalidate({ on: createUser, refetch: usersQuery }); // refetch the list on success
createUser.mutate({ name: 'Ada' });
```

## createJsonRequestFx

The reusable building block behind both: a declarative request **effect** (same `request` shape,
sourced fields, abort-aware, normalized `RequestError`) you can pass anywhere an effect is expected
— `createQuery` / `createMutation` / `createInfiniteQuery` / `connectQuery` — instead of
hand-writing `createRequestFx`.

```ts
import { createJsonRequestFx, createInfiniteQuery } from 'effector-refetch';

const fetchPageFx = createJsonRequestFx<{ params: { tag: string }; pageParam: number }, Page>({
  url: ({ params, pageParam }) => `/api/feed?tag=${params.tag}&cursor=${pageParam}`,
});

const feed = createInfiniteQuery({
  effect: fetchPageFx,
  initialPageParam: 0,
  getNextPageParam: ({ lastPage }) => lastPage.nextCursor,
});
```

## Validation (contracts)

Validate a response against a schema; a failure becomes a **retryable** `ValidationError`:

```ts
import {
  createQuery,
  zodContract,
  standardSchemaContract,
  runtypesContract,
  ioTsContract,
  createContract,
} from 'effector-refetch';

createQuery({ effect: getUserFx, contract: zodContract(UserSchema) }); // zod
createQuery({ effect: getUserFx, contract: standardSchemaContract(UserSchema) }); // valibot / zod 3.24+ / arktype
createQuery({ effect: getUserFx, contract: runtypesContract(User) }); // runtypes
createQuery({ effect: getUserFx, contract: ioTsContract(User) }); // io-ts codec
createQuery({ effect: getUserFx, contract: createContract({ isData: isUser }) }); // manual / any lib
createQuery({ effect: getPriceFx, validate: ({ result }) => result >= 0 || ['negative price'] });
```

Contracts are **structural** — the schema libraries are not imported; you pass your own
schema/validator. On failure, `$error` is a `ValidationError` with `.validationErrors`.

`contract` and `validate` are **two fields that compose**: if both are given, the `contract` runs
first, then `validate`, and the first failure wins. This is the intended, final design — they stay
separate (a schema check vs. an ad-hoc predicate), not a single merged field.

::: tip @withease/contracts — no adapter needed

[`@withease/contracts`](https://withease.effector.dev/contracts/) produces objects with the exact
`{ isData, getErrorMessages }` shape the `contract` option expects, so its combinators are passed
**directly** — no wrapper:

```ts
import { obj, str, num, arr } from '@withease/contracts';

createQuery({ effect: getUserFx, contract: obj({ id: num, name: str, tags: arr(str) }) });
```

:::

::: tip Any other library
Anything is one `createContract` away — superstruct, typed-contracts, a hand-written guard:

```ts
import { is } from 'superstruct';
createContract({ isData: (raw) => is(raw, UserStruct) });
```

`standardSchemaContract` already covers every [Standard Schema](https://standardschema.dev) library
(valibot, arktype, zod ≥3.24).
:::
