# Introspection

## Devtools labelling

Pass `name` to label the units in the effector inspector — **the public surface and every
internal seam**, so the whole pipeline is readable, not just the entry points:

```ts
const todos = createQuery({ effect: fetchTodosFx, name: 'todos' });
// public:   todos.start, todos.$data, todos.$status, todos.runFx, todos.inspect.*
// internal: todos.requested, todos.proceed, todos.toExec, todos.lookupFx, todos.toRun,
//           todos.rawDone, todos.acceptedDone, todos.scheduleRetry, todos.failed,
//           todos.finalFail, todos.$runId, todos.$attempts, …
```

No `name`? Pass `debug: true` to label everything under a generic `query.*` namespace. Without
either, internal units stay anonymous (zero inspector noise in production).

## Lifecycle event stream

Every query exposes `query.__.inspect` — effector events you can subscribe to:

| event                    | payload                      |
| ------------------------ | ---------------------------- |
| `start`                  | `{ params }`                 |
| `run`                    | `{ params, attempt }`        |
| `done`                   | `{ params, result }`         |
| `fail`                   | `{ params, error }`          |
| `aborted`                | `{ params }`                 |
| `cacheHit` / `cacheMiss` | `{ params }`                 |
| `retry`                  | `{ params, attempt, error }` |

## attachQueryLogger

Turn the stream into structured, timed log entries:

```ts
import { attachQueryLogger } from 'effector-refetch';

const stop = attachQueryLogger(todos, { name: 'todos' });
// → { query: 'todos', type: 'run', params, attempt: 0 }
//   { query: 'todos', type: 'done', params, durationMs: 42 }
stop(); // unsubscribe
```

Pass a custom `handler` to forward entries into your own logger or the effector
inspector. Entry types: `start | run | done | fail | aborted | cache-hit | cache-miss | retry`.

Options: `name`, `handler`, `now` (clock override for tests) and `scope` — pass a fork to
observe **only that scope's** events; without it the logger is global (every scope plus the
scope-less app in one log). `durationMs` is measured from the last `run` with the same params
(so concurrent `TAKE_EVERY` runs with different params are timed independently, and a retry
restarts its own clock).
