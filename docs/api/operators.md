# Operators

Every inline `createQuery` option is sugar over a **standalone operator** — `import` them and apply
to any query/mutation (even one built elsewhere). They're composable and tree-shakeable.

```ts
import { concurrency, retry, cache, timeout, keepFresh, applyBarrier } from 'effector-refetch';
```

## `concurrency`

How overlapping runs behave: `TAKE_LATEST` (default), `TAKE_FIRST`, `TAKE_EVERY`.

```ts
concurrency(searchQuery, { strategy: 'TAKE_LATEST' }); // new run aborts the previous
```

## `retry`

`retry(query, 3)` or a config. Each attempt is a real effect call; `filter` decides which failures
retry, `suppressIntermediateErrors` keeps `$error` clean until the final attempt.

```ts
import { exponentialDelay } from 'effector-refetch';

retry(userQuery, {
  times: 3,
  delay: exponentialDelay(200),
  filter: ({ error }) => (error as RequestError).status !== 404, // don't retry 404
});
```

## `cache`

`cache(query)` (in-memory) or a config (adapter / `staleAfter` / `key` / `swr` / `dedupe` / `purge`).

```ts
cache(productsQuery, { staleAfter: 30_000, swr: true, purge: loggedOut });
```

## `timeout`

Per-attempt deadline (ms): aborts the in-flight request and **fails** the run (retryable) if it
exceeds it. `0` disables it. Distinct from `refetchInterval` (poll cadence).

```ts
timeout(reportQuery, 5000); // give up a single attempt after 5s
```

## `keepFresh`

Refetch the query with its **last params** whenever a `source` store changes **or** a `@@trigger`
fires — dependency-based freshness (filters, locale, viewer, a write succeeding, a websocket ping).
No-op until it has run and while disabled.

```ts
keepFresh(productsQuery, { source: $filters }); // or source: [$filters, $locale]

// triggers: anything implementing the @@trigger protocol, or a plain effector Event
keepFresh(productsQuery, { triggers: [createProductMutation, tabFocused] });
```

`triggers` accepts our own queries/mutations (they implement `@@trigger` — `fired` = `finished.done`),
[withease](https://withease.effector.dev/) web-API triggers, farfetched-compatible triggers, or a
raw `Event`. Each trigger's `setup` is fired once when wired and stays active for the app's lifetime.

## `@@trigger` protocol

Every query and mutation **is** a [`@@trigger`](https://withease.effector.dev/protocols/trigger.html):
`query['@@trigger']()` returns `{ fired, setup, teardown }` where `fired` is `finished.done`. So a
query can drive **farfetched's** `keepFresh({ triggers })` (and vice-versa), or any protocol consumer:

```ts
import { keepFresh } from '@farfetched/core';

keepFresh(someFarfetchedQuery, { triggers: [ourQuery] }); // ourQuery succeeds → farfetched refetches
```

`isTrigger(x)` narrows to the protocol. Our units are always-on triggers: `setup`/`teardown` exist
for protocol compatibility but don't gate firing (the query runs on its own scoped lifecycle).

## `applyBarrier`

Gate an already-created query/mutation on a [barrier](/recipes/auth-barrier) (e.g. 401 → token
refresh → resume). Pass `null` to detach.

```ts
const auth = createBarrier({ perform: refreshTokenFx });
applyBarrier(userQuery, auth);
```

## Applying an operator more than once

Two well-defined behaviors, by operator kind:

- **Last-wins** — `concurrency` / `retry` / `cache` / `timeout` / `applyBarrier` are engine
  _setters_: a second call **replaces** the first. `retry(q, 1); retry(q, 3)` ⇒ 3 retries;
  `applyBarrier(q, null)` detaches.
- **Additive** — `keepFresh` / `invalidate` / `update` _add wiring_ each call: registering two
  `keepFresh` sources means **either** change refetches.

This is intentional and tested (`test/multi-operators.test.ts`) — last-wins for the single-valued
config knobs, additive for the ones that register reactions.

---

All of these equal the corresponding `createQuery({ … })` option — use whichever reads better.
Runnable: [`examples/operators.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/operators.ts).
