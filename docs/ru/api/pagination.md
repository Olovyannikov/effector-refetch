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

Предоставляет `$pages` (= `$data`), `$pageParams`, `$hasNextPage`, `$hasPreviousPage`, `$status`,
`$pending`, `$error` (плюс понаправленные `$initialError` / `$nextPageError` /
`$previousPageError`), `finished.{done,fail}` и поддержку `useUnit(feed)`. Триггеры:
`start`, `fetchNext`, `fetchPrevious`, `refetchAll`, `prefetch`, `reset`. Флаги загрузки:
`$isInitialLoading` (страниц ещё нет — скелетон), `$isFetchingNextPage` / `$isFetchingPreviousPage`
(какой конец грузится), `$isRefetching` (`refetchAll` перезагружает окно).

`getNextPageParam` получает `{ lastPage, allPages, lastPageParam, allPageParams }` и
возвращает параметр следующей страницы либо `null`/`undefined`, когда страниц больше нет.

### Прогрев ленты, которой нет на экране: `prefetch`

Свёрнутую панель или соседнюю вкладку можно загрузить заранее. `start` для этого не годится:
если он упадёт, список, который пользователь даже не открывал, отрисуется сломанным.
`prefetch` — фоновый вариант:

```ts
feed.prefetch(params); // тихо загружает первую страницу
```

- **Успех** заполняет окно ровно так же, как это сделал бы `start`: `$pages`, курсоры,
  `$params` (чтобы `fetchNext` продолжил с этого места) и `$status: 'done'`.
- **Падение** не трогает ничего — ни `$error`, ни статус `fail`. Следующий настоящий `start`
  останется холодной первой загрузкой.
- Это **no-op**, если в ленте уже есть страницы или если идёт настоящий запуск.
- `start`, пришедший во время прогрева, побеждает: он делает свою первую загрузку, а
  прогретая страница отбрасывается, а не перетирает свежую.
- Прогрев виден через `$isPrefetching` и намеренно **не входит** в `$pending`: лента, которую
  греют в фоне, не должна читаться как загружающаяся (`$isInitialLoading` остаётся `false`).

Закрытый [barrier](#barrier) держит `prefetch` как любой другой запрос. `retry` к нему не
применяется: упавший фоновый прогрев просто отбрасывается.

### Страницы как поток (`finished.done`, `accumulate`)

Каждая загруженная страница объявляется вместе со своим курсором и тем, с какого конца она
пришла:

```ts
feed.finished.done; // { params, page, pageParam, direction: 'initial' | 'next' | 'previous' }
```

`direction` — это как раз то, что нужно нормализующему потребителю: `'initial'` означает
**заменить** (первая загрузка или перезапуск), `'next'` — **добавить в конец**, `'previous'` —
**в начало**; диффить `$pages`, чтобы это вычислить, не нужно.

Когда страницы и так живут в вашем сторе — в карте сущностей, общей для нескольких
представлений, где лента это лишь «какие id и в каком порядке», — хранить их дважды расточительно.
`accumulate: false` это выключает:

```ts
const feed = createInfiniteQuery({
  effect: fetchPageFx,
  initialPageParam: 1,
  getNextPageParam: ({ lastPage }) => lastPage.next,
  accumulate: false,
});

sample({ clock: feed.finished.done, target: pagesReceived }); // ваш нормализатор
```

Курсоры продолжают работать ровно как раньше — `fetchNext` проходит всю ленту, а
`$hasNextPage` остаётся честным, — но в `$pages` лежит только последняя страница. Что из этого
следует:

- Колбэки курсоров видят эту одну страницу: `lastPage` — она, `allPages` — `[она]`. Если
  `getNextPageParam` считал по всем страницам (`allPages.flat().length`), курсор придётся
  брать из тела страницы.
- `maxPages` теряет смысл (окно — одна страница).
- `refetchAll` перезагружает только текущую страницу.

### Какой конец упал: понаправленные ошибки

`$error` — агрегат: он становится непустым, что бы ни упало, и для ленты это слишком грубо.
Упавший `fetchNext` должен оставить список на экране и показать под ним строку «не удалось
загрузить ещё · повторить», а не разнести всю страницу. Поэтому у каждого направления свой
стор ошибки:

```ts
feed.$initialError; //      упала первая загрузка — страниц нет, показываем ошибку на весь экран
feed.$nextPageError; //     упал fetchNext — список оставляем, предлагаем повтор строкой
feed.$previousPageError; // упал fetchPrevious
```

Каждый очищается при повторе в том же направлении (на запросе, чтобы ошибка исчезала вместе с
появлением спиннера) и на `start` / `reset`. Падение в одном направлении никогда не чистит
чужую ошибку, а упавший `refetchAll` не трогает ни одну из них — он виден через
`$error` / `$status`.

Для повтора ничего дополнительно хранить не нужно: упавший `fetchNext` оставляет
`nextPageParam` на месте, так что повторный `feed.fetchNext()` запросит ту же страницу.

```ts
feed.finished.fail; // { params, error, direction: 'initial' | 'next' | 'previous' | 'refetchAll' }
```

::: tip `$status` остаётся на всю ленту
Упавший `fetchNext` по-прежнему переводит `$status` в `'fail'` — это статус последнего запуска,
а не списка. Стройте интерфейс на понаправленных сторах (плюс `$pages.length`), а `$status`
оставьте для простой проверки «упало ли вообще что-нибудь».
:::

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

### `retry` и `timeout`

Загрузка страницы принимает те же опции `retry` и `timeout`, что и `createQuery` — они
действуют для `start`, `fetchNext`, `fetchPrevious` и для каждой страницы `refetchAll`:

```ts
const feed = createInfiniteQuery({
  effect: fetchPageFx,
  initialPageParam: 0,
  getNextPageParam: ({ lastPage }) => lastPage.next ?? null,
  retry: { times: 2, delay: exponentialDelay(300) },
  timeout: 5_000, // на попытку
});
```

`refetchAll` перезагружает окно напрямую через эффект (мимо page-запроса), поэтому `timeout`
до него не доходит — но конфиг `retry` применяется к каждой странице внутри цикла перезагрузки,
а повторная попытка ждёт `barrier` наравне с остальными.

### Барьер

Передайте `barrier` (из `createBarrier`), чтобы гейтить все запросы — `start`,
`fetchNext`, `fetchPrevious` и `refetchAll` ждут, пока барьер залочен (например,
во время обновления токена). `refetchAll` перепроверяет барьер перед **каждой** страницей,
поэтому начавшийся в середине окна refresh придержит оставшиеся страницы:

```ts
import { createBarrier, createInfiniteQuery } from 'effector-refetch';

const authBarrier = createBarrier({ perform: refreshTokenFx });

const feed = createInfiniteQuery({
  effect: fetchPageFx,
  initialPageParam: 0,
  getNextPageParam: ({ lastPage }) => lastPage.next ?? null,
  barrier: authBarrier,
  // повторная попытка страницы тоже ждёт барьер — именно она переигрывает упавшую на 401
  retry: { times: 1, filter: ({ error }) => error.status === 401 },
});
```

Полный сценарий 401 — в [рецепте auth & barrier](/ru/recipes/auth-barrier).
