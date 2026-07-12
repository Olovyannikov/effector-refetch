/**
 * Demo: $isInitialLoading vs $isRefetching — skeleton on the first load,
 * a corner spinner over the data on background refetches.
 *
 *   $pending          — ANY run in flight
 *   $isInitialLoading — in flight, no real data yet (placeholder doesn't count)
 *   $isRefetching     — in flight over existing data (refetch / polling / SWR)
 *
 * Run with: npx tsx examples/loading-flags.ts
 */
import { allSettled, combine, createEffect, fork } from 'effector';
import { createQuery } from '../src';

const userQuery = createQuery({
  effect: createEffect(async (id: number) => {
    await new Promise((r) => setTimeout(r, 50));
    return { id, name: `user-${id}` };
  }),
});

// what a UI would render, derived in one place
const $view = combine(
  userQuery.$isInitialLoading,
  userQuery.$isRefetching,
  userQuery.$data,
  (skeleton, spinner, data) => (skeleton ? '▒▒▒ skeleton ▒▒▒' : `${data?.name ?? '—'}${spinner ? ' ⟳' : ''}`),
);

async function main() {
  const scope = fork();

  const first = allSettled(userQuery.start, { scope, params: 1 });
  console.log(scope.getState($view)); // ▒▒▒ skeleton ▒▒▒  — first load, no data yet
  await first;
  console.log(scope.getState($view)); // user-1            — settled

  const refetch = allSettled(userQuery.refetch, { scope, params: 1 });
  console.log(scope.getState($view)); // user-1 ⟳          — data stays visible, spinner on top
  await refetch;
  console.log(scope.getState($view)); // user-1
}

main();
