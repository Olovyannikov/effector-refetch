# Интроспекция

## Метки для devtools

Передайте `name`, чтобы пометить юниты в инспекторе effector — **и публичные, и все внутренние
швы**, чтобы был читаем весь пайплайн, а не только точки входа:

```ts
const todos = createQuery({ effect: fetchTodosFx, name: 'todos' });
// публичные:  todos.start, todos.$data, todos.$status, todos.runFx, todos.inspect.*
// внутренние: todos.requested, todos.proceed, todos.toExec, todos.lookupFx, todos.toRun,
//             todos.rawDone, todos.acceptedDone, todos.scheduleRetry, todos.failed,
//             todos.finalFail, todos.$runId, todos.$attempts, …
```

Нет `name`? Передайте `debug: true` — всё пометится под общим неймспейсом `query.*`. Без того и
другого внутренние юниты остаются безымянными (ноль шума в инспекторе в проде).

## Поток событий жизненного цикла

Каждый query предоставляет `query.__.inspect` — события effector для подписки:

| событие                  | payload                      |
| ------------------------ | ---------------------------- |
| `start`                  | `{ params }`                 |
| `run`                    | `{ params, attempt }`        |
| `done`                   | `{ params, result }`         |
| `fail`                   | `{ params, error }`          |
| `aborted`                | `{ params }`                 |
| `cacheHit` / `cacheMiss` | `{ params }`                 |
| `retry`                  | `{ params, attempt, error }` |

## attachQueryLogger

Превращает поток в структурные записи с замером времени:

```ts
import { attachQueryLogger } from 'effector-refetch';

const stop = attachQueryLogger(todos, { name: 'todos' });
// → { query: 'todos', type: 'run', params, attempt: 0 }
//   { query: 'todos', type: 'done', params, durationMs: 42 }
stop(); // отписаться
```

Передайте свой `handler`, чтобы форвардить записи в собственный логгер или инспектор
effector. Типы записей: `start | run | done | fail | aborted | cache-hit | cache-miss | retry`.

Опции: `name`, `handler`, `now` (подменяемые часы для тестов) и `scope` — передайте форк,
чтобы наблюдать **только его** события; без него логгер глобален (все scope плюс no-scope
приложение в одном логе). `durationMs` меряется от последнего `run` с теми же params
(конкурентные `TAKE_EVERY`-прогоны с разными params замеряются независимо, а retry
перезапускает свой отсчёт).
