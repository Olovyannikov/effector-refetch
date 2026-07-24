/**
 * Demo: concurrency lanes over a real API (PokeAPI) — same-key runs compete,
 * different keys don't.
 *
 * A pokedex where each slot refreshes independently: TAKE_LATEST with a lane
 * key aborts only the superseded request OF THAT SLOT; refreshing slot 2 never
 * cancels slot 1's in-flight fetch. The `aborted` event tells you WHY a run was
 * discarded ('superseded' | 'cancelled' | 'take-first-busy' | 'disabled').
 *
 * Run with: npx tsx examples/concurrency-lanes.ts
 */
import { allSettled, createWatch, fork } from 'effector';
import { createQuery, createRequestFx, type AbortReason } from '../src';

interface Pokemon {
  name: string;
  height: number;
  weight: number;
}

// abort-aware effect: the per-run AbortSignal reaches fetch, so a superseded
// request is actually cancelled on the wire, not just ignored
const fetchPokemonFx = createRequestFx(
  async ({ slot, pokemon }: { slot: number; pokemon: string }, { signal }) => {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${pokemon}`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: Pokemon = await res.json();
    return { slot, name: data.name, weight: data.weight };
  },
);

const slotQuery = createQuery({
  effect: fetchPokemonFx,
  // lanes: runs for the same slot compete; different slots are independent.
  // Without `key` the second slot's start would abort the first slot's fetch.
  concurrency: { strategy: 'TAKE_LATEST', key: ({ slot }) => String(slot) },
});

async function main() {
  const scope = fork();
  createWatch({
    unit: slotQuery.aborted,
    scope,
    fn: ({ params, reason }: { params: { slot: number; pokemon: string }; reason: AbortReason }) =>
      console.log(`✗ slot ${params.slot} (${params.pokemon}): ${reason}`),
  });
  createWatch({
    unit: slotQuery.finished.done,
    scope,
    fn: ({ result }) => console.log(`✓ slot ${result.slot}: ${result.name}, ${result.weight}hg`),
  });

  // slot 1 starts fetching...
  const slot1 = allSettled(slotQuery.start, { scope, params: { slot: 1, pokemon: 'pikachu' } });

  // ...the user flips slot 2 twice: only slot 2's own first request is
  // superseded — slot 1's fetch keeps flying
  const slot2a = allSettled(slotQuery.start, { scope, params: { slot: 2, pokemon: 'bulbasaur' } });
  const slot2b = allSettled(slotQuery.start, { scope, params: { slot: 2, pokemon: 'charmander' } });

  await Promise.all([slot1, slot2a, slot2b]);
  // ✗ slot 2 (bulbasaur): superseded   <- only slot 2's first run lost its lane
  // ✓ slot 2: charmander, 85hg
  // ✓ slot 1: pikachu, 60hg            <- survived both slot-2 starts

  // explicit cancel still sweeps every lane
  const a = allSettled(slotQuery.start, { scope, params: { slot: 1, pokemon: 'mew' } });
  const b = allSettled(slotQuery.start, { scope, params: { slot: 2, pokemon: 'mewtwo' } });
  await allSettled(slotQuery.cancel, { scope });
  await Promise.all([a, b]);
  // ✗ slot 1 (mew): cancelled
  // ✗ slot 2 (mewtwo): cancelled
}

main().catch((err) => {
  console.error('demo failed:', err);
});
