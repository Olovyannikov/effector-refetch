# HTTP и валидация

## createRequestFx

Оборачивает любой HTTP-клиент в типизированный, abort-aware эффект с нормализованными ошибками:

```ts
import { ofetch } from 'ofetch';
import { createRequestFx, createQuery } from 'effector-refetch';

const getUserFx = createRequestFx<{ id: number }, User>(({ id }, { signal }) =>
  ofetch(`/api/users/${id}`, { signal }),
);
const userQuery = createQuery({ effect: getUserFx, cache: true });
```

Хендлер получает `AbortSignal`; контроллером владеет query и срабатывает им на `cancel` /
`reset` и при вытеснении `TAKE_LATEST` — так запрос реально прерывается. Ошибки нормализуются
в `RequestError` (`status`, `data`). Возвращает `AbortableEffect` (экспортируется, если нужно
аннотировать); передаётся в `createQuery` / `createMutation` и т.д. как обычный `Effect`.

### Error guards

Сужайте payload `$error` / `finished.fail` типизированными guard'ами вместо `instanceof` + кастов:

```ts
import { isRequestError, isHttpError, isTimeoutError, isValidationError } from 'effector-refetch';

isHttpError(error); // RequestError со status
isHttpError(error, 404); // ровно 404
isHttpError(error, (s) => s >= 500); // любой 5xx
isTimeoutError(error); // прерван по `timeout`
isValidationError(error); // провал контракта / validate (сужает к .validationErrors)
isRequestError(error); // любая нормализованная транспортная ошибка
```

```ts
import { sample } from 'effector';

// обновить токен на 401
sample({
  clock: api.finished.fail,
  filter: ({ error }) => isHttpError(error, 401),
  target: authBarrier.lock,
});

// понятное сообщение под каждый тип ошибки
const $message = api.$error.map((e) =>
  isHttpError(e, (s) => s >= 500) ? 'Ошибка сервера' : isTimeoutError(e) ? 'Таймаут' : e ? 'Сбой' : null,
);
```

Подробнее — в [рецепте обработки ошибок](/ru/recipes/error-handling#type-guards).

Это просто эффект — внутри работает что угодно: multipart **FormData**-загрузки
([`examples/form-data.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/form-data.ts)),
**GraphQL** (POST `{ query, variables }` — см. [рецепт GraphQL](/ru/recipes/graphql)),
или стриминг ([SSE и WebSocket](/ru/recipes/streaming)).

### Композиция с `attach`

Эффект из `createRequestFx` — **обычный `Effect<Params, Result>`**: пер-рановый
`AbortSignal` попадает в хендлер через синхронный side-канал, а не внутри params. Поэтому
его можно вызывать напрямую (`getUserFx({ id: 1 })` — вне прогона query отмены нет) и
оборачивать в **голый `attach`** — маппинг параметров, инъекция сторов и настоящая отмена
переживают обёртку:

```ts
import { attach, createStore } from 'effector';
import { createRequestFx, createQuery } from 'effector-refetch';

const $userId = createStore('user-123');

const getPostsForUserFx = attach({
  source: { userId: $userId }, // читается fork-корректно per scope
  mapParams: (search: string, { userId }) => ({ search, userId, limit: 20 }),
  effect: getPostsFx, // createRequestFx-эффект — отмена работает и через attach
});

const postsQuery = createQuery({ effect: getPostsForUserFx, cache: true });
```

Когда маппинг нужен одному конкретному query, инлайн-сахар
[`createQuery({ source, mapParams })`](/ru/api/queries#маппинг-параметров-source-mapparams)
делает то же без отдельного эффекта — и считает ключ кэша от **смапленных** params
(при самодельном `attach` кэш видит только публичные params).
Запускаемое демо: [`examples/map-params.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/map-params.ts).

## createJsonQuery

Декларативный эндпоинт поверх глобального `fetch` (без зависимости от HTTP-клиента):

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

`request`: `{ url, method?, query?, body?, headers? }`. Каждое поле — функция от параметров
(или, для `url`, статическая строка). Abort-aware, нормализованный `RequestError`,
опциональный контракт и все обычные опции запроса.

`mapData` / `validate` тоже работают инлайном (семантика — как у `createQuery`: `mapData`
преобразует провалидированный ответ перед `$data`, `validate` компонуется после контракта):

```ts
const userNameQuery = createJsonQuery<{ id: number }, { user: User }, string>({
  request: { url: ({ id }) => `/api/users/${id}` },
  mapData: ({ result }) => result.user.name,
  validate: ({ result }) => result.user != null || ['пустой пользователь'],
});
```

### Sourced-поля (реактивные, fork-корректные)

Любое поле запроса можно читать из `Store` — удобно для токена авторизации или base URL, которые
лежат в состоянии. Это разводится через `attach`, поэтому каждый `fork`/SSR-scope использует своё
значение:

```ts
const userQuery = createJsonQuery<{ id: number }>({
  request: {
    // комбинируем стор с параметрами через { source, fn }
    url: { source: $apiBase, fn: (base, { id }) => `${base}/users/${id}` },
    // или передаём Store напрямую
    headers: { source: $token, fn: (token) => ({ authorization: `Bearer ${token}` }) },
  },
});
```

Поле — это `(params) => T`, `Store<T>` или `{ source: Store, fn: (value, params) => T }`.
Сторы резолвятся на момент запроса в рамках scope — без глобального мутабельного клиента.

## createJsonMutation

Зеркало `createJsonQuery` для записей: та же форма `request` (включая sourced-поля), по умолчанию
`POST`, возвращает `Mutation` (без cache / refresh / stale).

```ts
import { createJsonMutation, invalidate } from 'effector-refetch';

const createUser = createJsonMutation<NewUser, User>({
  request: { url: 'https://api/users', body: (u) => u }, // метод по умолчанию POST
});

const deleteUser = createJsonMutation<number>({
  request: { url: (id) => `https://api/users/${id}`, method: HTTP_METHODS.DELETE },
});

invalidate({ on: createUser, refetch: usersQuery }); // рефетч списка при успехе
createUser.mutate({ name: 'Ada' });
```

## createJsonRequestFx

Переиспользуемый кирпичик за обоими: декларативный request-**эффект** (та же форма `request`,
sourced-поля, abort-aware, нормализованный `RequestError`), который можно передать куда угодно,
где ждут эффект — `createQuery` / `createMutation` / `createInfiniteQuery` / `connectQuery` —
вместо ручного `createRequestFx`.

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

## Валидация (контракты)

Проверяет ответ по схеме; провал превращается в **ретраябельную** `ValidationError`:

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
createQuery({ effect: getUserFx, contract: createContract({ isData: isUser }) }); // вручную / любая либа
createQuery({ effect: getPriceFx, validate: ({ result }) => result >= 0 || ['отрицательная цена'] });
```

Контракты **структурные** — сами библиотеки схем не импортируются, вы передаёте свою
схему/валидатор. При провале `$error` — это `ValidationError` с `.validationErrors`.

`contract` и `validate` — **два поля, которые композируются**: если заданы оба, сначала отрабатывает
`contract`, затем `validate`, и побеждает первый провал. Это намеренное, финальное решение — они
остаются раздельными (проверка по схеме vs. ad-hoc предикат), а не сливаются в одно поле.

::: tip @withease/contracts — без адаптера

[`@withease/contracts`](https://withease.effector.dev/contracts/) отдаёт объекты ровно той формы
`{ isData, getErrorMessages }`, что ожидает опция `contract`, — поэтому его комбинаторы передаются
**напрямую**, без обёртки:

```ts
import { obj, str, num, arr } from '@withease/contracts';

createQuery({ effect: getUserFx, contract: obj({ id: num, name: str, tags: arr(str) }) });
```

:::

::: tip Любая другая библиотека
Что угодно — в одну строку через `createContract` (superstruct, typed-contracts, ручной guard):

```ts
import { is } from 'superstruct';
createContract({ isData: (raw) => is(raw, UserStruct) });
```

`standardSchemaContract` уже покрывает любую [Standard Schema](https://standardschema.dev) либу
(valibot, arktype, zod ≥3.24).
:::
