# Интеграция: TanStack Query и Apollo

Оберните внешний клиент как **fetch-стадию** запроса — query сохраняет всю
поверхность effector-refetch (`$data`/`$status`, ретраи, инвалидация,
биндинги), а кэш внешней экосистемы делает то, что умеет. Главный сценарий —
**поэтапная миграция**: перевести экран на effector-refetch, не отказываясь от
кэша TanStack/Apollo (и их devtools), которым пользуется остальное приложение.

Оба адаптера без зависимостей: клиент типизирован **структурно** (настоящий
`QueryClient` / `ApolloClient` подходит под форму, из этих пакетов ничего не
импортируется) и читается **лениво** через `getClient()`, так что клиенты
на каждый fork работают.

## TanStack Query — `effector-refetch/tanstack`

`withTanstackCache(getClient, handler, options?)` прогоняет каждый запуск
`handler` через `QueryClient.fetchQuery` — работают кэш, дедупликация и
devtools TanStack:

```ts
import { createQuery, createRequestFx } from 'effector-refetch';
import { withTanstackCache } from 'effector-refetch/tanstack';

const fetchUserFx = createRequestFx(
  withTanstackCache(
    () => queryClient, // лениво: может приезжать из per-fork обвязки
    (id: number, { signal }) => fetch(`/api/users/${id}`, { signal }).then((r) => r.json()),
    { queryKey: (id) => ['user', id], staleTime: 60_000 },
  ),
);

const userQuery = createQuery({ effect: fetchUserFx });
```

- `queryKey` по умолчанию — `['effector-refetch', params]`.
- Свежая запись TanStack (в пределах `staleTime`) вообще пропускает fetch.
- `AbortSignal` рана пробрасывается в ваш handler, так что `cancel` /
  `TAKE_LATEST` по-прежнему отменяют сетевой запрос. Нюанс: когда TanStack
  склеивает два конкурентных запуска в один in-flight fetch, сигнал у них общий.
- Не совмещайте с собственным `cache` effector-refetch на том же query —
  выберите одного владельца кэша, иначе они разойдутся во мнении о свежести.

## Apollo — `effector-refetch/apollo`

`apolloHandler(getClient, options)` строит handler поверх `client.query` —
работают нормализованный кэш и цепочка link'ов Apollo:

```ts
import { createQuery, createRequestFx } from 'effector-refetch';
import { apolloHandler } from 'effector-refetch/apollo';
import { USER_QUERY } from './queries';

const fetchUserFx = createRequestFx(
  apolloHandler<number, { user: User }>(() => apolloClient, {
    document: USER_QUERY, // или (params) => document
    variables: (id) => ({ id }),
    fetchPolicy: 'cache-first',
  }),
);

const userQuery = createQuery({
  effect: fetchUserFx,
  mapData: ({ result }) => result.user,
});
```

- `AbortSignal` рана проезжает через HTTP-link Apollo
  (`context.fetchOptions.signal`).
- `document` принимает статичный `gql`-документ или функцию от params.

## Когда это НЕ нужно

Если вы не мигрируете с TanStack/Apollo (и не живёте с ними параллельно) —
адаптеры не нужны: собственный [`cache`](/ru/api/operators#cache) (SWR, dedupe,
scope-изолированный `$queryCache`) покрывает кэширование нативно, а GraphQL —
[просто `POST` в эффекте](/ru/api/http).
