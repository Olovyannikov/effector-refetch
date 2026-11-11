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
`$pending`, `$error` (plus the per-direction `$initialError` / `$nextPageError` /
`$previousPageError`), `finished.{done,fail}`, and `useUnit(feed)` support. Triggers:
`start`, `fetchNext`, `fetchPrevious`, `refetchAll`, `prefetch`, `reset`. Loading flavors:
`$isInitialLoading` (no pages yet — skeleton), `$isFetchingNextPage` / `$isFetchingPreviousPage`
(which end is loading), `$isRefetching` (`refetchAll` reloading the window).

`getNextPageParam` receives `{ lastPage, allPages, lastPageParam, allPageParams }` and
returns the next page param, or `null`/`undefined` when there are no more pages.

Offset feeds need a little more care than cursor feeds — local inserts and reorders shift the
offsets of the pages you have not loaded yet. See [Offset pagination](/recipes/offset-pagination).

### Warming a feed that isn't on screen: `prefetch`

A collapsed sidebar or the next tab can be loaded ahead of time. `start` is the wrong tool for
that — if it fails, a list the user never opened renders as broken. `prefetch` is the
background flavour:

```ts
feed.prefetch(params); // loads the first page quietly
```

- **Success** fills the window exactly as `start` would: `$pages`, the cursors, `$params`
  (so `fetchNext` continues from there) and `$status: 'done'`.
- **Failure** touches nothing — no `$error`, no `fail` status. The next real `start` is still
  a cold first load.
- It is a **no-op** once the feed has pages, or while a real run is in flight.
- A `start` arriving mid-flight wins: it runs its own first load, and the prefetched page is
  discarded rather than overwriting the fresh one.
- `$isPrefetching` reports it, deliberately **outside** `$pending` — a feed being warmed in
  the background must not read as loading (`$isInitialLoading` stays `false`).

A locked [barrier](#barrier) holds the prefetch like any other fetch. `retry` does not apply:
a background warm-up that fails is simply dropped.

### Pages as a stream (`finished.done`, `accumulate`)

Every loaded page is announced with its cursor and which end it came from:

```ts
feed.finished.done; // { params, page, pageParam, direction: 'initial' | 'next' | 'previous' }
```

`direction` is what a normalizing consumer needs: `'initial'` means **replace** (a first load
or a restart), `'next'` **append**, `'previous'` **prepend** — no diffing `$pages` to work it
out.

When the pages live in your own store — an entity map shared by several views, where the feed
is just "which ids, in what order" — holding them twice is waste. `accumulate: false` turns
that off:

```ts
const feed = createInfiniteQuery({
  effect: fetchPageFx,
  initialPageParam: 1,
  getNextPageParam: ({ lastPage }) => lastPage.next,
  accumulate: false,
});

sample({ clock: feed.finished.done, target: pagesReceived }); // your normalizer
```

The cursors keep working exactly as before — `fetchNext` walks the whole feed and
`$hasNextPage` stays honest — but `$pages` holds only the last page. Consequences worth
knowing:

- Cursor callbacks see that one page: `lastPage` is it, `allPages` is `[it]`. A
  `getNextPageParam` that counts across all pages (`allPages.flat().length`) needs the cursor
  to come from the page body instead.
- `maxPages` is moot (the window is one page).
- `refetchAll` reloads just the current page.

### Which end failed: per-direction errors

`$error` is the aggregate — it goes non-null whatever failed, which is too coarse for a feed:
a failed `fetchNext` should leave the list on screen with an inline "couldn't load more ·
retry" row, not blow up the page. Each direction therefore has its own error store:

```ts
feed.$initialError; //      the first load failed — there are no pages, show a full-screen error
feed.$nextPageError; //     fetchNext failed — keep the list, offer an inline retry
feed.$previousPageError; // fetchPrevious failed
```

Each clears when that direction is retried (on the request, so the error disappears as the
spinner appears) and on `start` / `reset`. A failure in one direction never clears another's,
and a failed `refetchAll` touches none of them — it surfaces through `$error` / `$status`.

Retrying needs no extra bookkeeping: a failed `fetchNext` leaves `nextPageParam` where it was,
so calling `feed.fetchNext()` again re-requests the same page.

```ts
feed.finished.fail; // { params, error, direction: 'initial' | 'next' | 'previous' | 'refetchAll' }
```

::: tip `$status` stays feed-wide
A failed `fetchNext` still flips `$status` to `'fail'` — it is the status of the last run, not
of the list. Drive the UI from the direction stores (plus `$pages.length`) and keep `$status`
for the simple "did anything fail" check.
:::

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
