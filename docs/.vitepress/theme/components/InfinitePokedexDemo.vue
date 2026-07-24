<script setup lang="ts">
import { ref } from 'vue';
import { useUnit } from 'effector-vue/composition';
// import straight from source so the demo needs no build step
import { createInfiniteQuery } from '../../../../src';

const tab = ref<'demo' | 'code'>('demo');

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

const { pages, hasNext, fetchingNext, initialLoading, start, fetchNext, reset } = useUnit({
  pages: pokedex.$pages,
  hasNext: pokedex.$hasNextPage,
  fetchingNext: pokedex.$isFetchingNextPage,
  initialLoading: pokedex.$isInitialLoading,
  start: pokedex.start,
  fetchNext: pokedex.fetchNext,
  reset: pokedex.reset,
});

// sprite by id, lifted from the entry URL (…/pokemon/25/ -> 25)
const spriteOf = (url: string) => {
  const id = url.match(/\/pokemon\/(\d+)\//)?.[1];
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
};
</script>

<template>
  <div class="ipd">
    <div class="ipd__tabs">
      <button class="ipd__tab" :class="{ active: tab === 'demo' }" @click="tab = 'demo'">Demo</button>
      <button class="ipd__tab" :class="{ active: tab === 'code' }" @click="tab = 'code'">Code</button>
    </div>

    <div v-show="tab === 'demo'" class="ipd__panel">
      <div class="ipd__bar">
        <button v-if="pages.length === 0" class="ipd__btn ipd__btn--go" @click="start()">Open pokedex</button>
        <template v-else>
          <button class="ipd__btn ipd__btn--go" :disabled="!hasNext || fetchingNext" @click="fetchNext()">
            {{ fetchingNext ? 'Loading…' : hasNext ? 'Load more' : 'All 151 loaded' }}
          </button>
          <button class="ipd__btn" @click="reset()">Reset</button>
          <span class="ipd__count">{{ pages.flatMap((p) => p.results).length }} / 151</span>
        </template>
      </div>

      <div v-if="initialLoading" class="ipd__skeleton">▒▒▒ loading the first page ▒▒▒</div>

      <div v-else-if="pages.length" class="ipd__grid">
        <div v-for="p in pages.flatMap((pg) => pg.results)" :key="p.name" class="ipd__cell">
          <img :src="spriteOf(p.url)" :alt="p.name" width="64" height="64" loading="lazy" />
          <span>{{ p.name }}</span>
        </div>
      </div>

      <p v-else class="ipd__hint">
        Click <em>Open pokedex</em> — the first page shows <code>$isInitialLoading</code> (skeleton), every
        next one shows <code>$isFetchingNextPage</code> on the button while loaded pages stay visible.
      </p>
    </div>

    <div v-show="tab === 'code'" class="ipd__code">
      <slot name="code" />
    </div>
  </div>
</template>

<style scoped>
.ipd {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  margin: 16px 0;
}
.ipd__tabs {
  display: flex;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.ipd__tab {
  padding: 8px 18px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 13px;
}
.ipd__tab.active {
  color: var(--vp-c-brand-1);
  box-shadow: inset 0 -2px 0 var(--vp-c-brand-1);
}
.ipd__panel {
  padding: 14px;
}
.ipd__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.ipd__btn {
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 13px;
}
.ipd__btn--go {
  border-color: var(--vp-c-brand-1);
}
.ipd__btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.ipd__count {
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-left: auto;
}
.ipd__skeleton {
  font:
    13px/1.5 ui-monospace,
    Menlo,
    monospace;
  color: var(--vp-c-text-3);
  padding: 20px 0;
  text-align: center;
}
.ipd__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 8px;
  max-height: 320px;
  overflow: auto;
}
.ipd__cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 11px;
  text-transform: capitalize;
  padding: 6px 2px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}
.ipd__cell img {
  image-rendering: pixelated;
}
.ipd__hint {
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin: 8px 0 0;
}
.ipd__code :deep(div[class*='language-']) {
  margin: 0;
  border-radius: 0;
}
</style>
