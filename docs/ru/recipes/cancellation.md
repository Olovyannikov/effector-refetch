# Отмена запросов

Отмена здесь настоящая: у каждого запуска свой `AbortController`, поэтому аборт не просто
игнорирует результат, а роняет `fetch` внутри вашего хэндлера. Запуск отменяют четыре вещи, три
из них — бесплатно:

- **`query.cancel()` / `query.reset()`** — явно.
- **Вытеснение** — под `TAKE_LATEST` более новый запуск той же полосы аборит предыдущий.
- **`timeout`** — дедлайн попытки аборит её и проваливает запуск (с возможностью ретрая).
- **Внешний сигнал** — аборт роутера, закрывающийся диалог, уход со страницы. Вот его нужно
  связать руками, и дальше страница в основном про это.

## Откуда берётся сигнал

`createRequestFx` отдаёт хэндлеру сигнал запуска **вторым аргументом**:

```ts
import { createQuery, createRequestFx } from 'effector-refetch';

const getUserFx = createRequestFx(async (id: number, { signal }) => {
  const response = await fetch(`/api/users/${id}`, { signal });
  return response.json();
});

const userQuery = createQuery({ effect: getUserFx, name: 'user' });
```

Сигнал едет через синхронный сторонний канал и намеренно **не** внутри параметров. Почему ему
там нельзя:

- `$params` — сериализуемое состояние: оно уезжает через `serialize(scope)`, чтобы гидрированный
  клиент знал последние параметры. Сигнал (как и любой инстанс класса) внутри них попадёт в
  SSR-пейлоад, и транспорт фреймворка упадёт, когда станет его упаковывать.
- Параметры проходят через композицию `attach` / `mapParams` — сигнал внутри них копировался бы
  и перекладывался как данные, и отмена тихо перестала бы работать.

Поэтому так делать не надо:

```ts
// ✗ ломает сериализацию SSR — и собственный сигнал запроса всё равно уже под рукой
createQuery({ effect: createRequestFx(async (p: { id: number; signal: AbortSignal }) => …) });
```

## `cancel` против `reset` и `timeout`

|                          | аборит в полёте   | `$data`  | `$status` после           | событие               |
| ------------------------ | ----------------- | -------- | ------------------------- | --------------------- |
| `cancel()`               | да, все полосы    | остаётся | последний **завершённый** | `aborted: cancelled`  |
| `reset()`                | да, все полосы    | чистится | `initial`                 | `aborted: cancelled`  |
| истёк `timeout`          | да, этот запуск   | остаётся | `fail` (ретраится)        | `aborted: timeout`¹   |
| вытеснение `TAKE_LATEST` | да, старый запуск | остаётся | от самого нового запуска  | `aborted: superseded` |

¹ в причине сигнала будет `'timeout'`; дальше запуск падает, так что срабатывает и
`finished.fail`.

Отменённый запуск не завершается: `finished.done` / `finished.fail` / `finished.finally`
молчат, и только `aborted` сообщает, что это было. Если нужно реагировать на отмену —
подписывайтесь на него, а не на `finished`. Полная семантика:
[Отмена](/ru/api/queries#отмена-cancel-reset).

## Из интерфейса

`cancel` — обычное событие, так что идёт через `useUnit` как и всё остальное:

```tsx
import { useUnit } from 'effector-react';

function SearchResults() {
  const [cancel, pending] = useUnit([searchQuery.cancel, searchQuery.$pending]);

  return pending ? <button onClick={cancel}>Стоп</button> : null;
}
```

После `cancel` предыдущие результаты остаются на экране — `$data` не тронут, а `$status`
возвращается к тому, что было до отменённого запуска. Если нужно, чтобы вид опустел, используйте
`reset`.

## Мост для внешнего AbortSignal (SSR-лоадеры)

Фреймворки отдают лоадеру `AbortController`, который срабатывает, когда клиент отвалился или
навигацию вытеснила новая. Мост для него — `attachToAbortSignal`: один `fork()` соответствует
одному запросу, так что отмена запусков этого scope и есть та гранулярность, которая у внешнего
сигнала и так есть:

```ts
// TanStack Start
import { createFileRoute } from '@tanstack/react-router';
import { allSettled, fork, serialize } from 'effector';
import { attachToAbortSignal } from 'effector-refetch';

export const Route = createFileRoute('/users/$id')({
  loader: async ({ abortController, params }) => {
    const scope = fork();
    attachToAbortSignal({ signal: abortController.signal, target: userQuery.cancel, scope });

    await allSettled(userQuery.start, { scope, params: Number(params.id) });
    return { values: serialize(scope) };
  },
  component: UserPage,
});
```

Та же форма работает в любом лоадере, который отдаёт сигнал (Remix/React Router, `onBeforeRender`
во Vike, `request.signal` в route handler'е Next.js).

Две вещи, которые он делает и на которых обычно спотыкается ручной
`signal.addEventListener('abort', …)`:

- **Уже прерванный сигнал не выстрелит.** Если клиент отвалился до того, как лоадер начал
  работу, `signal.aborted` уже `true`, а событие `abort` больше никогда не придёт — слушатель
  будет ждать вечно. `attachToAbortSignal` проверяет это и срабатывает сразу.
- **Отмена должна идти через `allSettled`, а не `scopeBind`.** Последний теряет контекст форка
  по цепочке запуска, и отмена уедет мимо того scope, которому принадлежат запросы в полёте.

`target` принимает и массив, а вызов возвращает функцию **dispose** — на случай, когда работа
закончилась сама, а сигнал живёт дольше:

```ts
const detach = attachToAbortSignal({
  signal: abortController.signal,
  target: [usersQuery.cancel, statsQuery.cancel],
  scope,
});

try {
  await allSettled(pageStarted, { scope, params: deps });
} finally {
  detach();
}
```

С [фабрикой](/ru/recipes/defaults) одна цель покрывает все созданные ею запросы — список не
придётся поддерживать вручную:

```ts
attachToAbortSignal({ signal: abortController.signal, target: api.cancel, scope });
```

::: warning Не передавайте сигнал параметром
Соблазн выглядит так: `allSettled(query.start, { params: { signal: abortController.signal } })`.
Это кладёт несериализуемое значение в `$params`, и лоадер падает, сериализуя собственный
возврат: `serialize(scope)` спокойно донесёт объект сигнала до пейлоада, а отвергнет его уже
сериализатор фреймворка (seroval в TanStack Start).
:::

## При клиентской навигации

Уход со страницы обычно должен останавливать её запросы. `attachToRoute` уже сбрасывает запрос
при закрытии роута (`resetOnClose`, включено по умолчанию) — но учтите, что `reset` **чистит
данные**: это то, что нужно для страницы деталей, с которой вы ушли насовсем, и не то, что нужно,
если пользователь может сразу вернуться:

```ts
import { sample } from 'effector';

// оставить данные для мгновенного возврата назад, но остановить запрос
sample({ clock: userRoute.closed, target: userQuery.cancel });
```

Для запроса, параметры которого меняются по мере ввода или фильтрации, ничего из этого не нужно:
`TAKE_LATEST` (по умолчанию) сам аборит вытесненный запрос, а `debounce` отбрасывает запуски до
того, как они дойдут до сети.

## Заметки

- `cancel` работает **на весь запрос**: он аборит все запуски в полёте во всех полосах
  (lanes). Полосы разделяют _вытеснение_, а не отмену, — поэтому «отменить вот эту одну строку,
  не трогая соседние» не выразить. Для такой ленты заводите отдельную квери.
- Отмена откатывает [`optimisticUpdate`](/ru/recipes/optimistic), который был в полёте, — патч
  отменённой мутации не залипает.
- `reset` не чистит `$params`: там лежат последние _запрошенные_ параметры, те самые, которые
  повторяют `invalidate` / `keepFresh` / рефетч по тегу.
- `Date` (как и любой инстанс класса) в параметрах переживает SSR строкой, если не дать ему
  кодек — см. [`paramsSerialize`](/ru/api/queries#параметры-и-ssr-paramsserialize), родственную
  ловушку в том же сторе.
