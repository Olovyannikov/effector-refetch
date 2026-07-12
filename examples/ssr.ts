/**
 * SSR: fetch on the server, hand the data to the client with no refetch/flicker,
 * then persist it in the browser.
 *
 * Queries are declared once at module level — `$queryCache` isolates the cache
 * per request, so concurrent SSR requests never see each other's entries.
 *
 * Two layers travel from server to client:
 *   1. store state ($data / $status / …) — effector's `serialize(scope)` → `fork({ values })`;
 *   2. the query *cache* (the per-request adapter) — our `dehydrate` → `hydrate`.
 *
 * On the client we also persist across reloads, shown two ways:
 *   - cache layer: use `localStorageCache` as the scope adapter (survives reloads);
 *   - store layer: `effector-storage`'s `persist($data)` (the store survives reloads).
 *
 * Illustrative (fake effect + payload); wire into your real SSR framework.
 */
import { allSettled, createEffect, fork, serialize, type StoreWritable } from 'effector';
import { persist } from 'effector-storage/local';
import {
  $queryCache,
  createQuery,
  inMemoryCache,
  localStorageCache,
  dehydrate,
  hydrate,
  type DehydratedEntry,
} from '../src';

interface Todo {
  id: number;
  title: string;
}

const fetchTodosFx = createEffect(
  (userId: number): Promise<Todo[]> => fetch(`/api/users/${userId}/todos`).then((r) => r.json()),
);

// module-level, shared by all requests — the ADAPTER is per-request via $queryCache.
// A stable `name` namespaces this query's entries inside the shared scope adapter.
export const todosQuery = createQuery({
  effect: fetchTodosFx,
  cache: { staleAfter: 60_000 },
  name: 'todos',
});

interface SsrPayload {
  values: Record<string, unknown>; // effector store values
  cache: DehydratedEntry[]; // this request's cache snapshot
}

// ---- server ----
export async function renderOnServer(userId: number): Promise<SsrPayload> {
  const cache = inMemoryCache(); // one adapter per request — full isolation
  const scope = fork({ values: [[$queryCache, cache]] });
  await allSettled(todosQuery.start, { scope, params: userId });

  return {
    values: serialize(scope), // $data, $status, … per scope ($queryCache is excluded)
    cache: dehydrate(cache), // exactly this request's entries
  };
}

// ---- client ----
export async function bootstrapOnClient(payload: SsrPayload) {
  // cache layer: a localStorage-backed adapter that ALSO survives reloads
  const cache = localStorageCache({ version: 1, maxAge: 60_000 });
  hydrate(cache, payload.cache); // warm it with the server's entries (storedAt preserved)

  // $data / $status restored — UI renders immediately, no loading flash, no refetch;
  // then point $queryCache of this scope at the client adapter (stores are callable)
  const scope = fork({ values: payload.values });
  await allSettled($queryCache, { scope, params: cache });

  // store layer: keep $data in localStorage across reloads (effector-storage).
  // $data is exposed read-only but is writable at runtime — cast for persist.
  persist({ store: todosQuery.$data as StoreWritable<Todo[] | null>, key: 'todos:data' });

  return { scope };
}

// usage (server): const payload = await renderOnServer(1); // -> inline into HTML as JSON
// usage (client): const { scope } = bootstrapOnClient(window.__SSR__);
