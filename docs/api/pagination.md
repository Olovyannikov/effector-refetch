# Pagination

## createInfiniteQuery

Cursor/offset pagination that accumulates pages. `start` loads the first page
(resetting), `fetchNext` appends the next — driven by `getNextPageParam`.

```ts
import { createInfiniteQuery } from 'effector-refetch';

const feed = createInfiniteQuery({
  effect: fetchPageFx, // Effect<{ params, pageParam }, Page>
  initialPageParam: 0,
  getNextPageParam: ({ lastPage }) => lastPage.nextCursor ?? null, // null/undefined = done
});

feed.start({ tag: 'cats' });
feed.fetchNext(); // appends; no-op when $hasNextPage is false or already loading
feed.refetchAll(); // re-fetches EVERY accumulated page (same pageParams), keeping the window
```

Exposes `$pages` (= `$data`), `$pageParams`, `$hasNextPage`, `$hasPreviousPage`, `$status`,
`$pending`, `$error`, `finished.{done,fail}`, and `useUnit(feed)` support. Loading flavors:
`$isInitialLoading` (no pages yet — skeleton), `$isFetchingNextPage` / `$isFetchingPreviousPage`
(which end is loading), `$isRefetching` (`refetchAll` reloading the window).

`getNextPageParam` receives `{ lastPage, allPages, lastPageParam, allPageParams }` and
returns the next page param, or `null`/`undefined` when there are no more pages.

### Bidirectional + windowing

Add `getPreviousPageParam` to enable `fetchPrevious` (prepends), and `maxPages` to cap the
window (drops from the opposite end):

```ts
const feed = createInfiniteQuery({
  effect: fetchPageFx,
  initialPageParam: 10, // start in the middle
  getNextPageParam: ({ lastPage }) => lastPage.next ?? null,
  getPreviousPageParam: ({ firstPage }) => firstPage.prev ?? null,
  maxPages: 3,
});

feed.fetchPrevious(); // prepend; gated by $hasPreviousPage
```

Exposes `$hasPreviousPage` alongside `$hasNextPage`.

## `combineQueries` — parallel queries

Aggregate several independent queries into combined stores (the effector-flavored `useQueries`):

```ts
import { combineQueries } from 'effector-refetch';

const { $data, $pending, $isSuccess, $isError, $statuses, $errors } = combineQueries([userQuery, postsQuery]);
// $data: [User | null, Post[] | null]   $pending: any in flight   $isSuccess: all done
```

Start the queries as usual; `combineQueries` just reads their combined state.

::: tip
The page effect is an `Effect<{ params, pageParam }, Page>` — a regular
`createEffect`/`handler` or an abort-aware `createRequestFx` effect (the AbortSignal
reaches it through a synchronous side channel, so page fetches stay cancellable).
:::

### `retry` and `timeout`

Page fetches take the same `retry` and `timeout` options as `createQuery` — they apply to
`start`, `fetchNext`, `fetchPrevious` and to every page of a `refetchAll`:

```ts
const feed = createInfiniteQuery({
  effect: fetchPageFx,
  initialPageParam: 0,
  getNextPageParam: ({ lastPage }) => lastPage.next ?? null,
  retry: { times: 2, delay: exponentialDelay(300) },
  timeout: 5_000, // per attempt
});
```

`refetchAll` reloads the window straight through the effect (outside the page query), so
`timeout` doesn't reach it — but the `retry` config is applied per page inside the reload
loop, and a replayed page waits on the `barrier` like any other attempt.

### Barrier

Pass a `barrier` (from `createBarrier`) to gate all fetches — `start`, `fetchNext`,
`fetchPrevious`, and `refetchAll` wait while the barrier is locked (e.g. during a
token refresh). `refetchAll` re-checks it before **every** page, so a refresh that starts
mid-window holds the remaining pages:

```ts
import { createBarrier, createInfiniteQuery } from 'effector-refetch';

const authBarrier = createBarrier({ perform: refreshTokenFx });

const feed = createInfiniteQuery({
  effect: fetchPageFx,
  initialPageParam: 0,
  getNextPageParam: ({ lastPage }) => lastPage.next ?? null,
  barrier: authBarrier,
  // a retried page fetch waits at the barrier too — this is what replays a 401 page
  retry: { times: 1, filter: ({ error }) => error.status === 401 },
});
```

See the [auth & barrier recipe](/recipes/auth-barrier) for the full 401 flow.

Built on `createQuery`, so the page fetch inherits concurrency and cancellation.
