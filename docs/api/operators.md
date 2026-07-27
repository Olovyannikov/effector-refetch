# Operators

Every inline `createQuery` option is sugar over a **standalone operator** — `import` them and apply
to any query/mutation (even one built elsewhere). They're composable and tree-shakeable.

```ts
import {
  concurrency,
  retry,
  cache,
  timeout,
  debounce,
  fallback,
  keepFresh,
  applyBarrier,
} from 'effector-refetch';
```

## `concurrency`

How overlapping runs behave: `TAKE_LATEST` (default), `TAKE_FIRST`, `TAKE_EVERY`, `QUEUE`.

```ts
concurrency(searchQuery, { strategy: 'TAKE_LATEST' }); // new run aborts the previous
concurrency(saveMutation, { strategy: 'QUEUE' }); // writes run strictly one after another
```

`QUEUE` serializes runs: the next starts only after the previous settles, failures don't
break the chain, and `cancel`/`reset` flush the waiting runs (they abort as `'cancelled'`).
Combined with a lane `key` the serialization is per lane.

Add a **lane key** to make runs compete only with runs of the same key — refreshing one
table row no longer cancels its neighbours:

```ts
concurrency(rowQuery, { strategy: 'TAKE_LATEST', key: ({ rowId }) => String(rowId) });
```

Supersede (`TAKE_LATEST`) and busy-drop (`TAKE_FIRST`) apply **within a lane**; `cancel` /
`reset` still affect every lane. `$data` stays single per query — lanes partition
cancellation, not data (the last lane to settle wins the store; keep per-key _data_ in a
cached query keyed by params instead).

Try it live — three pokedex slots over the real PokeAPI, each slot is a lane:

<LanesDemo>
<template #code>

```ts
import { createQuery, createRequestFx } from 'effector-refetch';

const fetchPokemonFx = createRequestFx(async ({ slot, id }: { slot: number; id: number }, { signal }) => {
  const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { slot, id, name: data.name, sprite: data.sprites.front_default };
});

const pokedexQuery = createQuery({
  effect: fetchPokemonFx,
  // one lane per slot: refreshing slot 2 never aborts slot 1's request
  concurrency: { strategy: 'TAKE_LATEST', key: ({ slot }) => String(slot) },
});

pokedexQuery.aborted.watch(({ params, reason }) => {
  // reason: 'superseded' | 'cancelled' | 'take-first-busy' | 'disabled'
  console.log(`slot ${params.slot} dropped: ${reason}`);
});

pokedexQuery.start({ slot: 1, id: 25 }); // pikachu
pokedexQuery.start({ slot: 2, id: 1 }); //  bulbasaur — doesn't touch slot 1
pokedexQuery.start({ slot: 2, id: 4 }); //  charmander — supersedes ONLY bulbasaur
```

</template>
</LanesDemo>

Runnable script version: [`examples/concurrency-lanes.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/concurrency-lanes.ts).

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

`cache(query)` (in-memory) or a config (adapter / `staleAfter` / `key` / `swr` / `dedupe` /
`purge` / `fillOnAbort`).

```ts
cache(productsQuery, { staleAfter: 30_000, swr: true, purge: loggedOut });
cache(feedQuery, { swr: { silent: true }, fillOnAbort: true });
```

- **`swr: { silent: true }`** — a failed background revalidation keeps serving the stale
  entry silently: `$error`/`$status` stay untouched, `finished.fail` still fires for
  observers (and `startAsync` still rejects).
- **`fillOnAbort: true`** — a SUPERSEDED in-flight run is allowed to finish so its
  response still lands in the cache; only its connection to `$data`/status is severed.
  Explicit `cancel`/`reset` aborts for real.

## `timeout`

Per-attempt deadline (ms): aborts the in-flight request and **fails** the run (retryable) if it
exceeds it. `0` disables it. Distinct from `refetchInterval` (poll cadence).

```ts
timeout(reportQuery, 5000); // give up a single attempt after 5s
```

## `debounce`

Wait N ms before a run executes; a newer run in the same lane started during the wait
supersedes it **before it hits the network** — a true debounce for search-as-you-type
under `TAKE_LATEST`. `0` disables.

```ts
debounce(searchQuery, 300); // or createQuery({ debounce: 300 })
```

## `fallback`

Recover a **final** failure (after retries) into data: `$data` gets the value, `$status`
becomes `done`, `finished.done` fires. The value is **not** written to the cache (it isn't
server truth), and aborts/skips are exempt. Pass `null` to detach.

```ts
fallback(productsQuery, []); // empty list instead of an error screen
fallback(profileQuery, ({ error, params }) => cachedProfileOr(params, error));
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

- **Last-wins** — `concurrency` / `retry` / `cache` / `timeout` / `debounce` / `fallback` / `applyBarrier` are engine
  _setters_: a second call **replaces** the first. `retry(q, 1); retry(q, 3)` ⇒ 3 retries;
  `applyBarrier(q, null)` detaches.
- **Additive** — `keepFresh` / `invalidate` / `update` _add wiring_ each call: registering two
  `keepFresh` sources means **either** change refetches.

This is intentional and tested (`test/multi-operators.test.ts`) — last-wins for the single-valued
config knobs, additive for the ones that register reactions.

---

All of these equal the corresponding `createQuery({ … })` option — use whichever reads better.
Runnable: [`examples/operators.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/operators.ts).
