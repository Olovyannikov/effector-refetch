# Infinite query: a live pokedex

`createInfiniteQuery` over PokeAPI's offset/limit pagination — the next page
param is lifted out of the `next` URL the API returns, `null` ends the list.
The 0.15 loading flavors drive the UI: `$isInitialLoading` shows the first-page
skeleton, `$isFetchingNextPage` puts the spinner on the "load more" button while
already-loaded pages stay visible.

<InfinitePokedexDemo>
<template #code>

```ts
import { createInfiniteQuery } from 'effector-refetch';

interface PokemonListPage {
  count: number;
  next: string | null;
  results: Array<{ name: string; url: string }>;
}

const PAGE_SIZE = 12;

const pokedex = createInfiniteQuery({
  effect: async ({ pageParam }: { params: void; pageParam: number }): Promise<PokemonListPage> => {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon?offset=${pageParam}&limit=${PAGE_SIZE}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  initialPageParam: 0,
  // the API hands us the next-page URL — lift the offset out of it, null = the end
  getNextPageParam: ({ lastPage }) =>
    lastPage.next ? Number(new URL(lastPage.next).searchParams.get('offset')) : null,
});

pokedex.start(); //          first page  -> $isInitialLoading while it flies
pokedex.fetchNext(); //      next page   -> $isFetchingNextPage; $pages accumulate
pokedex.$hasNextPage; //     false once `next` is null
pokedex.reset(); //          back to empty
```

</template>
</InfinitePokedexDemo>

## Notes

- **Void params are fine** — `start()` without arguments; the effect receives
  `{ params: undefined, pageParam }`.
- **`$pages` accumulates** page results; render `pages.flatMap((p) => p.results)`.
- **Loading flags**: `$isInitialLoading` (no pages yet — skeleton),
  `$isFetchingNextPage` / `$isFetchingPreviousPage` (which end is loading),
  `$isRefetching` (`refetchAll` re-runs the loaded window).
- **Bidirectional lists**: provide `getPreviousPageParam` and use
  `fetchPrevious` / `$hasPreviousPage`; `maxPages` caps the window.
- In React/Vue/Solid the same units come from `useUnit(pokedex)` via
  `@@unitShape` — see [bindings](/api/bindings).

Runnable script version: [`examples/infinite-pokeapi.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/infinite-pokeapi.ts).
Full API: [`createInfiniteQuery`](/api/pagination#createinfinitequery).
