# Оптимистичные апдейты

Показать изменение мгновенно, откатить при ошибке, сверить с сервером при успехе — и при
желании ещё `invalidate`, чтобы подтвердить серверной правдой (паттерн в духе TanStack).

## Попробуйте вживую

Список дел поверх симулированного API (~600 мс задержки). Добавленный элемент появляется
мгновенно — приглушённым, оптимистичным — и «затвердевает», когда сервер подтверждает
запись. Включите переключатель, чтобы сервер отклонял записи, и посмотрите на откат;
добавьте несколько дел подряд — `TAKE_EVERY` держит отдельный оптимистичный слой на
каждую мутацию.

<OptimisticTodosDemo>
<template #code>

```ts
import { createQuery, createMutation, optimisticUpdate } from 'effector-refetch';

interface Todo {
  id: number;
  text: string;
  pending?: boolean; // только у оптимистичного временного элемента
}

const todosQuery = createQuery({ handler: fetchTodos }); // симулированный API, ~600мс
const addTodo = createMutation({
  handler: addTodoOnServer,
  concurrency: 'TAKE_EVERY', // параллельные добавления — у каждого свой оптимистичный слой
});

optimisticUpdate({
  query: todosQuery,
  on: addTodo,
  // применяется мгновенно на addTodo.mutate(text)
  update: ({ data, params }) => [...(data ?? []), { id: 0, text: params, pending: true }],
  // сверить временный элемент с серверным результатом при успехе
  commit: ({ data, result }) => (data ?? []).map((t) => (t.pending && t.text === result.text ? result : t)),
  // rollbackOnFailure: true (по умолчанию) — упавшее добавление снимает ТОЛЬКО свой слой
});

addTodo.mutate('Купить молоко'); // появляется сразу; коммит или откат через ~600мс
```

</template>
</OptimisticTodosDemo>

## Паттерн

```ts
import { createQuery, createMutation, optimisticUpdate, invalidate } from 'effector-refetch';

const todosQuery = createQuery({ effect: fetchTodosFx });
const addTodo = createMutation({ effect: addTodoFx });

optimisticUpdate({
  query: todosQuery,
  on: addTodo,
  // применяется сразу на addTodo.mutate(...)
  update: ({ data, params }) => [{ id: -1, text: params.text, pending: true }, ...(data ?? [])],
  // сверить временный элемент с серверным результатом при успехе
  commit: ({ data, result }) => (data ?? []).map((t) => (t.id === -1 ? result : t)),
  // rollbackOnFailure по умолчанию true
});

// дополнительно сверяемся с серверной правдой
invalidate({ on: addTodo, refetch: todosQuery });

addTodo.mutate({ text: 'Купить молоко' });
```

## Как это работает

- На **start** `addTodo` до-мутационное `$data` снимается как _база_ (один раз на серию
  in-flight мутаций), и поверх кладётся оптимистичный слой этой мутации.
- При **ошибке** — или **прерванном** прогоне (скип по `enabled`, вытеснение `TAKE_LATEST`) —
  снимается только слой _этой_ мутации; остальные in-flight слои переприменяются над базой.
- При **успехе** слой материализуется в базу (`commit` сверяет его с ответом сервера; без
  `commit` остаётся оптимистичное значение).
- `cancel` / `reset` откатывают **все** in-flight слои разом.

Параллельные (`TAKE_EVERY`) мутации безопасны: у каждой свой слой, поэтому чужая ошибка не
затрёт ни оптимистичное значение соседа, ни исходные данные.
Запускаемое демо: [`examples/optimistic-parallel.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/optimistic-parallel.ts).

::: warning
При settle не по порядку слои переприменяются в **порядке старта** — если `update`-функции
не коммутируют, композиция может отличаться от серверной; сверяйтесь через `commit` или
`invalidate`, когда точный порядок важен. In-flight слои сопоставляются с settle по params
(stable JSON), одинаковые params соединяются FIFO.
:::
