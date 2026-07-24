/**
 * @effector/router integration: start a query when its route opens, re-start it
 * when the route's params change (/users/1 -> /users/2), reset it on close —
 * via the same `attachToRoute` glue that works for atomic-router.
 *
 * Run with: npx tsx examples/effector-router.ts
 */
import { allSettled, createEffect, fork } from 'effector';
import { createRoute, createRouter, historyAdapter } from '@effector/router';
import { createMemoryHistory } from 'history';
import { createQuery, attachToRoute } from '../src';

const fetchUserFx = createEffect(async (id: string) => {
  await new Promise((r) => setTimeout(r, 30));
  return { id, name: `user-${id}` };
});
const userQuery = createQuery({ effect: fetchUserFx });

const homeRoute = createRoute({ path: '/' });
const userRoute = createRoute({ path: '/users/:id' }); // Route<{ id: string }>
const router = createRouter({ routes: [homeRoute, userRoute] });

attachToRoute({
  route: userRoute,
  query: userQuery,
  mapParams: (opened) => (opened as { params: { id: string } }).params.id,
  // restartOnUpdate: true (default) — param changes re-start the query
  // resetOnClose: true (default)
});

async function main() {
  const scope = fork();
  // the router does nothing until it gets a history (memory history here)
  await allSettled(router.setHistory, {
    scope,
    params: historyAdapter(createMemoryHistory({ initialEntries: ['/'] })),
  });

  await allSettled(userRoute.open, { scope, params: { params: { id: '1' } } });
  console.log('opened /users/1 ->', scope.getState(userQuery.$data)); // { id: '1', name: 'user-1' }

  await allSettled(userRoute.open, { scope, params: { params: { id: '2' } } });
  console.log('params changed ->', scope.getState(userQuery.$data)); // { id: '2', name: 'user-2' }

  await allSettled(homeRoute.open, { scope, params: {} });
  console.log('closed ->', scope.getState(userQuery.$data), scope.getState(userQuery.$status)); // null initial
}

main().catch((e) => console.error('demo failed:', e));
