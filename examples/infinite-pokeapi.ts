/**
 * Infinite query demo against PokeAPI (offset/limit pagination).
 *
 * PokeAPI's list endpoint returns `next` / `previous` URLs — the next page
 * param (offset) is extracted from the `next` URL, `null` ends the list.
 * Also shows the 0.15 loading flavors: `$isInitialLoading` for the first page
 * skeleton vs `$isFetchingNextPage` for the "load more" spinner.
 *
 * Run: npx tsx examples/infinite-pokeapi.ts
 */
import { allSettled, createEffect, fork } from 'effector';
import { createInfiniteQuery } from '../src';

interface PokemonListPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: Array<{ name: string; url: string }>;
}

const PAGE_SIZE = 5;

const fetchPokemonPageFx = createEffect(
  async ({ pageParam }: { params: void; pageParam: number }): Promise<PokemonListPage> => {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon?offset=${pageParam}&limit=${PAGE_SIZE}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
);

const pokedex = createInfiniteQuery({
  effect: fetchPokemonPageFx,
  initialPageParam: 0,
  // the API hands us the next-page URL — lift the offset out of it, null = the end
  getNextPageParam: ({ lastPage }) => {
    if (!lastPage.next) return null;
    return Number(new URL(lastPage.next).searchParams.get('offset'));
  },
});

async function main() {
  const scope = fork();

  const first = allSettled(pokedex.start, { scope, params: undefined });
  console.log('initial loading:', scope.getState(pokedex.$isInitialLoading)); // true — skeleton
  await first;
  log(scope);

  const more = allSettled(pokedex.fetchNext, { scope });
  // pages already on screen stay visible; only the bottom spinner shows
  console.log('fetching next page:', scope.getState(pokedex.$isFetchingNextPage)); // true
  console.log('initial loading:', scope.getState(pokedex.$isInitialLoading)); // false
  await more;
  log(scope);

  await allSettled(pokedex.fetchNext, { scope });
  log(scope);

  function log(s: typeof scope) {
    const pages = s.getState(pokedex.$pages);
    const names = pages.flatMap((p) => p.results.map((r) => r.name));
    console.log(
      `pages=${pages.length} loaded=${names.length}/${pages[0]?.count} ` +
        `hasNext=${s.getState(pokedex.$hasNextPage)} last=${JSON.stringify(names.slice(-PAGE_SIZE))}`,
    );
  }
}

main().catch((e) => console.error('demo failed:', e));
