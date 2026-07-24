# Shared defaults (query factory)

effector-refetch has no global `QueryClient`. Two mechanisms cover shared policy:
a **factory** (creation-time, explicit) and **`$queryDefaults`** (run-time, per-scope).
Bake shared policy into a factory with `createQueryFactory` — per-call options always
override the defaults.

```ts
import { createQueryFactory } from 'effector-refetch';

const { createQuery, createMutation } = createQueryFactory({
  retry: 2,
  cache: { staleAfter: 30_000 },
  concurrency: 'TAKE_LATEST',
});

const todos = createQuery({ effect: fetchTodosFx }); // retry 2 + cache by default
const search = createQuery({ effect: searchFx, retry: 0 }); // override: no retry
```

## Make every query poll

The motivating case — one place to give all queries a polling interval:

```ts
const { createQuery } = createQueryFactory({ refetchInterval: 30_000 });

const stats = createQuery({ effect: fetchStatsFx }); // polls every 30s
const feed = createQuery({ effect: fetchFeedFx, refetchInterval: 5_000 }); // override to 5s
```

See the runnable [`examples/polling.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/polling.ts).

## What a factory carries

Query defaults: `retry`, `cache`, `concurrency`, `refetchInterval`, `structuralSharing`,
`enabled`, `debug`. Mutations only inherit `retry`, `concurrency`, `debug` (cache /
polling don't apply to writes).

Need different policies per area (e.g. `shared/api` vs `internal/api`)? Just create
multiple factories.

::: tip Why not a global client?
effector is decentralized — a god-object `QueryClient` fights that model. A factory gives
you the same "defaults in one place" ergonomics while every query stays a plain, testable
effector unit.
:::

## Run-time defaults: `$queryDefaults`

The factory works at **creation time**. `$queryDefaults` is a plain store read at
**run time**, so tests and SSR can change behavior per scope without rebuilding
queries — fork-correct by construction:

```ts
import { $queryDefaults, setQueryDefaults } from 'effector-refetch';
import { fork } from 'effector';

// per-scope: tests / SSR
const scope = fork({ values: [[$queryDefaults, { timeout: 5_000, retry: 2 }]] });

// or patch the running app (merge semantics)
setQueryDefaults({ retry: 1 });
```

Supported keys: `concurrency`, `retry` (count; delay 0, intermediate errors
suppressed), `staleAfter` (for cached queries), `timeout`.

Precedence (highest first):

1. the query's own config — inline option, `Store` option, standalone operator,
   **including factory defaults** (a factory sets options explicitly at creation);
2. `$queryDefaults`;
3. built-ins (`TAKE_LATEST`, no retry, `staleAfter: Infinity`, no timeout).

An explicit value always opts out of the store — e.g. `timeout: 0` disables the
deadline even when `$queryDefaults.timeout` is set. Mutations pin
`concurrency: 'TAKE_EVERY'` at creation, so `$queryDefaults.concurrency` never
affects them.

The classic use: give every query a retry budget and a deadline in tests without
touching application code — one `fork` value instead of N query edits.
