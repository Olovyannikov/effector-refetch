# Auth & barrier (pause the environment)

Sometimes you need to **pause every request**, do something, then resume — the classic
case being a `401`: pause, refresh the token, replay the queued requests.

`createBarrier` is a mutex that queries wait on. While it's locked, any gated query that
tries to run blocks; when it unlocks, the queued requests proceed.

```ts
import { sample } from 'effector';
import { createBarrier, createQueryFactory } from 'effector-refetch';

// the barrier runs the refresh when it locks, and unlocks when refresh settles
const authBarrier = createBarrier({ perform: refreshTokenFx });

// every query/mutation built here waits on the barrier
const { createQuery, createMutation } = createQueryFactory({ barrier: authBarrier });

const profile = createQuery({
  effect: getProfileFx, // throws { status: 401 } when the token is stale
  retry: { times: 1, filter: ({ error }) => error.status === 401 },
});

// on a 401, lock the barrier — this kicks off refreshTokenFx
sample({
  clock: getProfileFx.failData,
  filter: (error) => error.status === 401,
  target: authBarrier.lock,
});
```

What happens on a stale token:

1. `getProfileFx` fails with `401` → the barrier **locks** and `refreshTokenFx` runs.
2. The `retry` schedules a re-run — but it **waits at the barrier**.
3. Other queries started meanwhile also queue.
4. `refreshTokenFx` settles → the barrier **unlocks** → the retry (and the queue) run with the fresh token.

## Try it live

Expire the token, then press **Fetch ×3**: one `401` locks the barrier, the refresh runs
**once**, and every retried request resumes and succeeds when it unlocks:

<AuthBarrierDemo>
<template #code>

```ts
import { createEffect, sample } from 'effector';
import { createBarrier, createQuery, createRequestFx } from 'effector-refetch';

let token = 'valid';

// simulated protected API: 401 while the token is expired
const fetchDataFx = createRequestFx(async (id: number) => {
  await sleep(500);
  if (token !== 'valid') throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return { id, secret: `data-${id}` };
});

// the refresh: runs ONCE per lock, the barrier re-opens when it settles
const refreshTokenFx = createEffect(async () => {
  await sleep(1200);
  token = 'valid';
});

const authBarrier = createBarrier({ perform: refreshTokenFx });

const dataQuery = createQuery({
  effect: fetchDataFx,
  barrier: authBarrier, // every run — including retries — waits while it's locked
  retry: 1, //             the 401 attempt is replayed after the refresh
  concurrency: 'TAKE_EVERY',
});

// a 401 locks the barrier → refreshTokenFx kicks off, retries queue up
sample({
  clock: fetchDataFx.failData,
  filter: (error) => error.status === 401,
  target: authBarrier.lock,
});

dataQuery.start(1); // with an expired token: 401 → lock → refresh → retry succeeds
```

</template>
</AuthBarrierDemo>

## API

```ts
const barrier = createBarrier({ perform?: Effect<void, any> });
barrier.lock();        // close — gated queries wait
barrier.unlock();      // open — queued queries proceed
barrier.$locked;       // Store<boolean>
```

With `perform`, locking auto-runs the effect and unlocks when it settles (success **or**
failure — no deadlock). Without it, drive `lock`/`unlock` yourself.

Gate a single query without a factory — via the config option, or the `applyBarrier` operator
on an already-created query/mutation (pass `null` to detach):

```ts
const q = createQuery({ effect: fx, barrier: authBarrier });
// or, after creation:
applyBarrier(existingQuery, authBarrier);
```

## Lock it from the failure, not from `finished.fail`

`finished.fail` only fires for the **final** failure — after the retries are exhausted. A
lock driven by it arrives too late: the retry has already gone out with the stale token.
Drive the lock from the raw effect instead (`fx.failData`), which fires on the very first
`401`:

```ts
// ✅ fires on the first 401, before the retry is scheduled
sample({ clock: getProfileFx.failData, filter: (e) => e.status === 401, target: authBarrier.lock });

// ❌ only after every retry has already failed
sample({
  clock: profile.finished.fail,
  filter: ({ error }) => error.status === 401,
  target: authBarrier.lock,
});
```

An HTTP layer works just as well — lock where you see the `401`, before rethrowing. Because
that code runs outside effector's call stack, bind it to the scope:

```ts
import { scopeBind } from 'effector';

async function request(url: string) {
  const response = await fetch(url);
  if (response.status === 401) {
    scopeBind(authBarrier.lock, { safe: true })();
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }
  return response.json();
}
```

## Infinite queries

`createInfiniteQuery` takes `barrier` and `retry`, so paginated feeds get the same flow:
`start`, `fetchNext` and `fetchPrevious` wait while the barrier is locked, and a retried
page fetch waits too — that is what replays the `401` page after the refresh.

```ts
const feed = createInfiniteQuery({
  effect: fetchPageFx,
  initialPageParam: 0,
  getNextPageParam: ({ lastPage }) => lastPage.next,
  barrier: authBarrier,
  retry: { times: 1, filter: ({ error }) => error.status === 401 },
});
```

`refetchAll` is the exception: it reloads the window straight through the effect, outside
the page query, so it is **not** retried. It does wait on the barrier before every page, so
a refresh that starts mid-window holds the remaining pages — but a page that fails leaves
the previous window on screen and surfaces the error in `$error` / `$status`. Re-trigger it
yourself if you want a second pass.

## Scope and SSR

The barrier is fork-safe: both the lock flag and the queue of waiting runs live in stores,
so concurrent scopes — SSR requests, tests — block and release independently. Locking one
scope leaves the others running.

::: warning Locking from outside effector
A `lock()` called from an HTTP layer, an SDK callback or anything else outside effector's
call stack lands on the **scope-less** app, and scoped queries never see it. Wrap it in
`scopeBind(barrier.lock, { safe: true })` (as above), or drive the lock declaratively with
`sample`.
:::
