# Пагинация

## createInfiniteQuery

Курсорная/offset-пагинация с накоплением страниц. `start` грузит первую страницу (со сбросом),
`fetchNext` докидывает следующую — по `getNextPageParam`.

```ts
import { createInfiniteQuery } from 'effector-refetch';

const feed = createInfiniteQuery({
  effect: fetchPageFx, // Effect<{ params, pageParam }, Page>
  initialPageParam: 0,
  getNextPageParam: ({ lastPage }) => lastPage.nextCursor ?? null, // null/undefined = конец
});

feed.start({ tag: 'cats' });
feed.fetchNext(); // докидывает; no-op, если $hasNextPage = false или уже грузится
feed.refetchAll(); // перезапрашивает ВСЕ накопленные страницы (те же pageParams), сохраняя окно
```

Предоставляет `$pages` (= `$data`), `$pageParams`, `$hasNextPage`, `$status`, `$pending`,
`$error`, `finished.{done,fail}` и поддержку `useUnit(feed)`.

`getNextPageParam` получает `{ lastPage, allPages, lastPageParam, allPageParams }` и
возвращает параметр следующей страницы либо `null`/`undefined`, когда страниц больше нет.

### Двунаправленность + окно

Добавьте `getPreviousPageParam`, чтобы включить `fetchPrevious` (вставка в начало), и
`maxPages`, чтобы ограничить окно (сбрасывает с противоположного конца):

```ts
const feed = createInfiniteQuery({
  effect: fetchPageFx,
  initialPageParam: 10, // старт с середины
  getNextPageParam: ({ lastPage }) => lastPage.next ?? null,
  getPreviousPageParam: ({ firstPage }) => firstPage.prev ?? null,
  maxPages: 3,
});

feed.fetchPrevious(); // prepend; гейт по $hasPreviousPage
```

Появляется `$hasPreviousPage` рядом с `$hasNextPage`.

## `combineQueries` — параллельные запросы

Агрегирует несколько независимых запросов в общие сторы (эффектор-овский `useQueries`):

```ts
import { combineQueries } from 'effector-refetch';

const { $data, $pending, $isSuccess, $isError, $statuses, $errors } = combineQueries([userQuery, postsQuery]);
// $data: [User | null, Post[] | null]   $pending: любой в полёте   $isSuccess: все done
```

Запускайте запросы как обычно; `combineQueries` лишь читает их общее состояние.

::: tip
Эффект страницы — `Effect<{ params, pageParam }, Page>`: обычный `createEffect`/`handler`
или abort-aware `createRequestFx`-эффект (AbortSignal доходит до него через синхронный
side-канал, так что загрузка страниц остаётся отменяемой).
:::

Построено на `createQuery`, поэтому загрузка страницы наследует concurrency и отмену.
