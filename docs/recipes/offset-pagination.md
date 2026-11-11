# Offset pagination

`createInfiniteQuery` is cursor-shaped: you hand it a `pageParam` and it hands you the next
one. An **offset** is just a cursor that happens to be a position in a server-side list — and
positions move. The moment items are inserted, removed or reordered, the offsets of the pages
you have not loaded yet point somewhere else than they did a second ago.

Two kinds of movement, with different fixes:

- **The server moved** — somebody else posted, an item was deleted. Nothing local can prevent
  the skip or the duplicate; dedupe on append and reload when it matters.
- **You moved it** — an optimistic insert, an item bumped to the top after an update, a local
  delete. This one is yours to account for, and it is the one that silently corrupts a feed.

## Pick the cursor that doesn't drift

The tempting `getNextPageParam` counts what is already loaded:

```ts
// ✗ drifts: a local insert makes the feed think it has loaded one more item than the server gave it
getNextPageParam: ({ allPages }) => {
  const loaded = allPages.flatMap((p) => p.items).length;
  return loaded < total ? loaded : null;
};
```

Derive it from the page params instead — they record what you actually **requested**, which no
local edit can change:

```ts
// ✓ stable: the next offset follows the last requested one
getNextPageParam: ({ lastPageParam }) => (lastPageParam + SIZE < total ? lastPageParam + SIZE : null);
```

The difference, on a feed of 2-item pages after one optimistic insert at the top:

| cursor                       | next request | result                      |
| ---------------------------- | ------------ | --------------------------- |
| `allPages.flatMap(…).length` | offset **5** | `i5, i6` — **`i4` is lost** |
| `lastPageParam + SIZE`       | offset **4** | `i4, i5` — correct          |

The counting form is only safe while `$pages` holds exactly what the server returned, which
stops being true the first time you patch it locally.

## Dedupe on append

With a stable cursor you can still receive an item you already show — the server shifted under
you between two requests. Since the appended page lands in `$pages` as-is, dedupe where you
read the feed, by id:

```ts
const $items = feed.$pages.map((pages) => {
  const seen = new Set<string>();
  return pages
    .flatMap((p) => p.items)
    .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
});
```

Keeping the dedupe in a derived store (rather than mutating `$pages`) means the page bodies
still match their `pageParams`, so `refetchAll` keeps working.

## After a local insert or delete

A local edit shifts every later offset by one. You have three options, in order of how much
they cost:

**Accept the drift for inserts at the top and reload instead.** The simplest correct thing: let
the optimistic insert render, then `feed.start(params)` when the user next pulls to refresh.
One wasted request, no bookkeeping.

**Carry the shift in the cursor.** Keep a counter of local inserts minus deletes and apply it
where you compute the next offset:

```ts
const $localShift = createStore(0)
  .on(todoInserted, (n) => n + 1)
  .on(todoDeleted, (n) => n - 1)
  .reset(feed.start);
```

Read it where the offset is built (a `source` store on the page effect, or in your own
`fetchNext` wrapper) — `getNextPageParam` is a pure callback and must not read stores.

**Patch the pages and keep the params honest.** `update` / `optimisticUpdate` write through
`__.setData`, which re-derives the cursors from the patched pages:

```ts
update({
  query: feed,
  on: addTodo,
  fn: ({ data, result }) => [{ items: [result, ...data[0].items] }, ...data.slice(1)],
});
```

Note what that does to `$pageParams`: they are **truncated to the new page count**. Patch a
3-page window (`pageParams: [0, 2, 4]`) down to one page and the params become `[0]` — so a
later `refetchAll` reloads one page, not three. Keep the page count stable when you patch, or
expect the window to shrink with it.

## `refetchAll` versus `start` on a reordered window

`refetchAll` re-requests the **stored** `pageParams` and replaces the window with what comes
back. For a locally reordered feed that means the local order is gone:

```
local window:      MOVED, i0, i1, i2, i3
refetchAll asks:   offset 0, offset 2
window after:      i0, i1, i2, i3          ← MOVED dropped, server order restored
```

That is the right behaviour when you want the truth from the server, and the wrong one when the
user is still looking at their own optimistic edit. Prefer:

- **`refetchAll`** — a background refresh of a window the user has not edited (polling, tag
  invalidation, reconnect).
- **`start`** — after a local edit, or after anything that makes the old offsets meaningless (a
  filter change, a sort change). It resets the window and loads page one, so nothing stale
  survives.

## When to ask the backend for a cursor

Offsets are a workaround for a list that changes. If the feed is high-churn — a social timeline,
a notification list, anything with inserts at the top — none of the above fully fixes it: two
users can always interleave a post between your page requests. A keyset / cursor API
(`?after=<id>`) makes the page boundary a _value_ rather than a _position_, so later pages stay
correct no matter what happens before them.

Worth asking for when you see: duplicates across page boundaries under normal use, items
missing that the user swears existed, or a `getNextPageParam` accumulating correction factors.
With a cursor the whole page above collapses into:

```ts
getNextPageParam: ({ lastPage }) => lastPage.nextCursor ?? null;
```
