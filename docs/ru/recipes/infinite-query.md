# Infinite query: живой покедекс

`createInfiniteQuery` поверх offset/limit-пагинации PokeAPI — параметр следующей
страницы достаётся из URL `next`, который возвращает API; `null` завершает
список. UI управляют loading-флаги из 0.15: `$isInitialLoading` показывает
скелетон первой страницы, `$isFetchingNextPage` — спиннер на кнопке «load more»,
пока уже загруженные страницы остаются на экране.

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
  // API сам отдаёт URL следующей страницы — достаём offset из него, null = конец
  getNextPageParam: ({ lastPage }) =>
    lastPage.next ? Number(new URL(lastPage.next).searchParams.get('offset')) : null,
});

pokedex.start(); //          первая страница -> $isInitialLoading, пока летит
pokedex.fetchNext(); //      следующая       -> $isFetchingNextPage; $pages накапливаются
pokedex.$hasNextPage; //     false, когда `next` стал null
pokedex.reset(); //          обратно к пустому состоянию
```

</template>
</InfinitePokedexDemo>

## Заметки

- **Void-параметры работают** — `start()` без аргументов; эффект получает
  `{ params: undefined, pageParam }`.
- **`$pages` накапливает** результаты страниц; рендерьте
  `pages.flatMap((p) => p.results)`.
- **Loading-флаги**: `$isInitialLoading` (страниц ещё нет — скелетон),
  `$isFetchingNextPage` / `$isFetchingPreviousPage` (какой конец списка грузится),
  `$isRefetching` (`refetchAll` перезагружает загруженное окно).
- **Двунаправленные списки**: задайте `getPreviousPageParam` и используйте
  `fetchPrevious` / `$hasPreviousPage`; `maxPages` ограничивает окно.
- В React/Vue/Solid те же юниты доступны через `useUnit(pokedex)` благодаря
  `@@unitShape` — см. [биндинги](/ru/api/bindings).

Запускаемый скрипт: [`examples/infinite-pokeapi.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/infinite-pokeapi.ts).
Полное API: [`createInfiniteQuery`](/ru/api/pagination#createinfinitequery).
