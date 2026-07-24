<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
// import straight from source so the demo needs no build step
import { createQuery, createRequestFx, type AbortReason } from '../../../../src';

const tab = ref<'demo' | 'code'>('demo');

interface Params {
  slot: number;
  id: number;
}
interface Poke {
  slot: number;
  id: number;
  name: string;
  sprite: string | null;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      rej(new DOMException('aborted', 'AbortError'));
    });
  });

// abort-aware effect against the real PokeAPI; the artificial delay makes
// cancellation visible — a superseded run aborts during the wait
const fetchPokemonFx = createRequestFx(async ({ slot, id }: Params, { signal }) => {
  await sleep(900, signal);
  const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { slot, id, name: data.name as string, sprite: (data.sprites?.front_default as string) ?? null };
});

// the same effect, two queries: with lanes and without — toggle to feel the difference
const lanesQuery = createQuery({
  effect: fetchPokemonFx,
  concurrency: { strategy: 'TAKE_LATEST', key: ({ slot }: Params) => String(slot) },
});
const plainQuery = createQuery({ effect: fetchPokemonFx, concurrency: 'TAKE_LATEST' });

const lanesOn = ref(true);
const active = () => (lanesOn.value ? lanesQuery : plainQuery);

const SLOTS = [1, 2, 3];
type SlotView = { loading: boolean; poke: Poke | null };
const slots = ref<Record<number, SlotView>>(
  Object.fromEntries(SLOTS.map((s) => [s, { loading: false, poke: null }])),
);
const log = ref<Array<{ text: string; kind: 'ok' | 'abort' | 'fail' }>>([]);
const push = (text: string, kind: 'ok' | 'abort' | 'fail') => {
  log.value = [...log.value.slice(-8), { text, kind }];
};

const unsubs: Array<() => void> = [];
for (const q of [lanesQuery, plainQuery]) {
  unsubs.push(
    q.finished.done.watch(({ result }) => {
      if (q !== active()) return;
      slots.value[result.slot] = { loading: false, poke: result };
      push(`✓ slot ${result.slot}: ${result.name}`, 'ok');
    }),
    q.aborted.watch(({ params, reason }: { params: Params; reason: AbortReason }) => {
      if (q !== active()) return;
      slots.value[params.slot] = { ...slots.value[params.slot], loading: false };
      push(`✗ slot ${params.slot} (#${params.id}): ${reason}`, 'abort');
    }),
    q.finished.fail.watch(({ params }) => {
      if (q !== active()) return;
      slots.value[params.slot] = { ...slots.value[params.slot], loading: false };
      push(`✗ slot ${params.slot}: request failed`, 'fail');
    }),
  );
}
onUnmounted(() => unsubs.forEach((u) => u()));

const roll = (slot: number) => {
  const id = 1 + Math.floor(Math.random() * 151);
  slots.value[slot] = { ...slots.value[slot], loading: true };
  active().start({ slot, id });
};
const cancelAll = () => active().cancel();
const onToggle = () => {
  plainQuery.cancel();
  lanesQuery.cancel();
  slots.value = Object.fromEntries(SLOTS.map((s) => [s, { loading: false, poke: null }]));
  log.value = [];
};
</script>

<template>
  <div class="lanes">
    <div class="lanes__tabs">
      <button class="lanes__tab" :class="{ active: tab === 'demo' }" @click="tab = 'demo'">Demo</button>
      <button class="lanes__tab" :class="{ active: tab === 'code' }" @click="tab = 'code'">Code</button>
    </div>

    <div v-show="tab === 'demo'" class="lanes__panel">
      <div class="lanes__bar">
        <label class="lanes__switch">
          <input v-model="lanesOn" type="checkbox" @change="onToggle" />
          lanes <code>key: ({ slot }) => slot</code>
        </label>
        <button class="lanes__btn" @click="cancelAll()">Cancel all</button>
      </div>

      <div class="lanes__grid">
        <div v-for="s in SLOTS" :key="s" class="lanes__slot">
          <div class="lanes__sprite">
            <span v-if="slots[s].loading" class="lanes__spinner">⟳</span>
            <img
              v-else-if="slots[s].poke?.sprite"
              :src="slots[s].poke!.sprite!"
              :alt="slots[s].poke!.name"
              width="72"
              height="72"
            />
            <span v-else class="lanes__empty">?</span>
          </div>
          <div class="lanes__name">{{ slots[s].loading ? '…' : (slots[s].poke?.name ?? `slot ${s}`) }}</div>
          <button class="lanes__btn lanes__btn--roll" @click="roll(s)">Randomize</button>
        </div>
      </div>

      <p class="lanes__hint">
        Click <em>Randomize</em> on one slot, then quickly on another. With lanes <strong>on</strong>, each
        slot's TAKE_LATEST supersedes only its own in-flight request; turn lanes <strong>off</strong> and any
        click aborts whatever else was loading.
      </p>

      <div class="lanes__log">
        <span v-if="log.length === 0" class="lanes__logempty">no activity yet — click “Randomize”</span>
        <div
          v-for="(e, i) in log"
          :key="i"
          :class="{ 'is-abort': e.kind === 'abort', 'is-fail': e.kind === 'fail' }"
        >
          {{ e.text }}
        </div>
      </div>
    </div>

    <div v-show="tab === 'code'" class="lanes__code">
      <slot name="code" />
    </div>
  </div>
</template>

<style scoped>
.lanes {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  margin: 16px 0;
}
.lanes__tabs {
  display: flex;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.lanes__tab {
  padding: 8px 18px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 13px;
}
.lanes__tab.active {
  color: var(--vp-c-brand-1);
  box-shadow: inset 0 -2px 0 var(--vp-c-brand-1);
}
.lanes__panel {
  padding: 14px;
}
.lanes__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.lanes__switch {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}
.lanes__btn {
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 13px;
}
.lanes__btn--roll {
  border-color: var(--vp-c-brand-1);
}
.lanes__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}
.lanes__slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}
.lanes__sprite {
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.lanes__sprite img {
  image-rendering: pixelated;
}
.lanes__spinner {
  font-size: 26px;
  animation: lanes-spin 0.9s linear infinite;
}
@keyframes lanes-spin {
  to {
    transform: rotate(360deg);
  }
}
.lanes__empty {
  font-size: 26px;
  color: var(--vp-c-text-3);
}
.lanes__name {
  font-size: 13px;
  text-transform: capitalize;
}
.lanes__hint {
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin: 12px 0;
}
.lanes__log {
  font:
    12px/1.5 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  background: var(--vp-c-bg-alt);
  border-radius: 8px;
  padding: 8px 10px;
  min-height: 40px;
  max-height: 140px;
  overflow: auto;
}
.lanes__logempty {
  color: var(--vp-c-text-3);
}
.lanes__log .is-abort {
  color: #f08c00;
}
.lanes__log .is-fail {
  color: #e03131;
}
.lanes__code :deep(div[class*='language-']) {
  margin: 0;
  border-radius: 0;
}
</style>
