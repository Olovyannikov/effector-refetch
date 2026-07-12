# Мутации и инвалидация

## createMutation

Мутация — это «пишущий» вариант запроса: тот же effect-first движок (статус, retry,
concurrency, жизненный цикл) без cache/refresh/stale, плюс алиас `mutate`. Concurrency по
умолчанию `TAKE_EVERY`, чтобы независимые записи не отменяли друг друга.

```ts
import { createMutation } from 'effector-refetch';

const addTodo = createMutation({ effect: addTodoFx, retry: 2 });
addTodo.mutate({ text: 'Купить молоко' });
```

Предоставляет `{ start, mutate, reset, cancel, $data, $error, $status, $pending, $params,
finished, aborted }` и работает с `useUnit(mutation)`.

## invalidate

Перезапросить запросы, когда что-то завершилось успешно:

```ts
import { invalidate } from 'effector-refetch';

invalidate({ on: addTodo, refetch: todosQuery });
```

- **`on`** — Mutation/Query (по успеху), `Event` или `Effect`; либо массив.
- **`refetch`** — запрос или массив; каждый перезапускается с последними параметрами, только если уже запускался (`status !== 'initial'`), минуя свежесть кэша.
- **`filter`** — опциональный гейт по payload триггера (например, `{ params, result }`).

## invalidateTag

Кросс-модульная инвалидация без импорта запросов в месте вызова: дайте запросам
`tags` и стреляйте тегом откуда угодно:

```ts
import { invalidateTag, createQuery, createInfiniteQuery } from 'effector-refetch';

const todosQuery = createQuery({ effect: fetchTodosFx, cache: true, tags: ['todos'] });
const feedQuery = createInfiniteQuery({ effect: fetchPageFx, tags: ['todos'] /* … */ });

sample({ clock: addTodo.finished.done, fn: () => 'todos', target: invalidateTag });
// или пачкой: invalidateTag(['todos', 'stats'])
```

Совпавший тег заставляет каждый тегированный запрос **очистить свой кэш-неймспейс**
(prefetch-прогрев и записи под другими params не переживают инвалидацию) и **перезапроситься
с последними params** (только если уже запускался). Тегированный infinite-query выполняет
`refetchAll` — перезагружает всё накопленное окно. Scope-корректно:
`allSettled(invalidateTag, { scope, params: 'todos' })`.

## update

Патчит `$data` запроса прямо из результата — без рефетча:

```ts
import { update } from 'effector-refetch';

update({ query: todosQuery, on: addTodo, fn: ({ data, result }) => [...(data ?? []), result] });
```

## optimisticUpdate

Применяет сразу на `start`, откатывает при ошибке, опционально сверяет с сервером на успехе:

```ts
import { optimisticUpdate } from 'effector-refetch';

optimisticUpdate({
  query: todosQuery,
  on: addTodo,
  update: ({ data, params }) => [{ id: -1, ...params }, ...(data ?? [])],
  commit: ({ data, result }) => (data ?? []).map((t) => (t.id === -1 ? result : t)),
});
```

Сочетайте оптимистичный фидбек с `invalidate`, чтобы сверяться с серверной правдой.
