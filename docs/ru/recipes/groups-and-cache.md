# Группы и доступ к кэшу

## Инвалидация группы запросов

[Фабрика](/ru/recipes/defaults) регистрирует каждый созданный запрос, поэтому их можно
перезапросить вместе — эффектор-овский аналог `queryClient.invalidateQueries`:

```ts
import { createQueryFactory } from 'effector-refetch';

const { createQuery, invalidate } = createQueryFactory();

const todos = createQuery({ effect: fetchTodosFx });
const profile = createQuery({ effect: fetchProfileFx });

// перезапросить все запросы, которые уже запускались
invalidate();

// или сузить предикатом (получает объект запроса)
invalidate({ predicate: (q) => q === todos });
```

`invalidate` — обычное событие: scope-корректное и композируемое,
`sample({ clock: loggedOut, target: invalidate })`. Перезапрашиваются только запросы, которые
уже выполнялись, с их последними параметрами.

В SSR и тестах у него необязательный payload, поэтому `allSettled` требует явный `params`:

```ts
await allSettled(invalidate, { scope, params: undefined }); // все
await allSettled(invalidate, { scope, params: { predicate: (q) => q === todos } });
```

Нужны отдельные группы — используйте несколько фабрик.

## Отмена группы запросов

На том же реестре построен `cancel`: он прерывает запросы в полёте у всех квери, которые
создала фабрика:

```ts
const { createQuery, cancel } = createQueryFactory();

cancel(); // прервать всё, что в полёте
await allSettled(cancel, { scope }); // SSR и тесты
```

Предиката, в отличие от `invalidate`, у него нет: отмена простаивающей квери — и так no-op,
поэтому «отменить всё» ничего не стоит, а сузить до одной — это просто `todos.cancel()`.
Мутации фабрика не регистрирует, их это не касается.

Его естественная пара — аборт фреймворка в SSR-лоадере, см.
[Отмену запросов](/ru/recipes/cancellation#мост-для-внешнего-abortsignal-ssr-лоадеры).

## Императивные чтение и запись кэша

```ts
import { getQueryData, setQueryData } from 'effector-refetch';

const todos = getQueryData(todosQuery); // текущее $data
setQueryData(todosQuery, (prev) => [...(prev ?? []), newTodo]); // значение или (prev) => next
```

Они читают/пишут no-scope-стор — для одно-клиентского приложения. Апдейтер
`(prev) => next` применяется внутри редьюсера стора (`__.updateData`), поэтому `prev`
читается без `getState`. В scope-коде читайте `scope.getState(query.$data)`, а пишите в
scope так:

```ts
import { allSettled } from 'effector';

allSettled(todosQuery.__.updateData, { scope, params: (prev) => [...(prev ?? []), newTodo] });
```

Для правок от мутаций предпочитайте операторы [`update`](/ru/api/mutations#update) /
[`optimisticUpdate`](/ru/recipes/optimistic) (они scope-корректны).

## gcTime?

TanStack-овский `gcTime` выгружает записи кэша, когда у них не осталось наблюдателей.
effector-refetch не отслеживает наблюдателей (запросы — обычные юниты, не подписки), поэтому
ближайший аналог — выгрузка по возрасту в адаптере: `inMemoryCache({ maxAge })` /
`localStorageCache({ maxAge })`, плюс `maxEntries` для LRU-лимита.
