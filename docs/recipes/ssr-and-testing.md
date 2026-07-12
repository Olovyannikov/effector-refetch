# SSR & testing

Because a query is plain effector under the hood, `fork()` + `allSettled()` work as
usual — no special test utilities.

## Testing a query

```ts
import { fork, allSettled } from 'effector';

const scope = fork();
await allSettled(query.start, { scope, params: 1 });
expect(scope.getState(query.$data)).toEqual(/* ... */);
```

## SSR

```ts
const scope = fork();
await allSettled(query.start, { scope, params: req.params });
const html = renderToString(/* app */, scope);
const serialized = serialize(scope); // effector serialize — $data / $status / …
```

Bindings are scope-aware: React via `<Provider value={scope}>`, Vue via the
`EffectorScopePlugin({ scope })`.

### Isolating the cache per request (`$queryCache`)

By default a query's cache adapter is module-level — shared by every scope. For multi-tenant
SSR set **`$queryCache`** per fork: every query in that scope reads/writes an isolated adapter,
so concurrent requests can never see each other's data:

```ts
import { $queryCache, inMemoryCache, dehydrate, hydrate } from 'effector-refetch';

// server — one adapter per request
const cache = inMemoryCache();
const scope = fork({ values: [[$queryCache, cache]] });
await allSettled(todosQuery.start, { scope });
const payload = { values: serialize(scope), cache: dehydrate(cache) };

// client
const clientCache = inMemoryCache();
hydrate(clientCache, payload.cache); // storedAt preserved → staleAfter ages correctly
const clientScope = fork({ values: [...fromJSON(payload.values), [$queryCache, clientCache]] });
// $data restored by serialize, cached keys hit instead of refetching
```

Inside a shared scope adapter, entries are namespaced per query — `name` ?? the effect's sid
?? a creation counter. Give queries stable **`name`s** (or use the effector babel/SWC plugin
for sids) when the server and client bundles may initialize modules in a different order.
`$queryCache` is excluded from `serialize(scope)` automatically.

Only adapters that can enumerate entries (e.g. `inMemoryCache`) are dehydratable; web-storage
adapters already persist themselves. Without `$queryCache` everything works as before — the
per-query adapter is used (fine for a single-client app). Barriers remain global by design.

### Persisting on the client

Two complementary ways to keep data across reloads in the browser:

- **Cache layer** — use `localStorageCache` / `sessionStorageCache` as the adapter; the query
  cache survives reloads (and `version` lets you invalidate old data).
- **Store layer** — persist `$data` directly with [`effector-storage`](https://github.com/yumauri/effector-storage):

  ```ts
  import { persist } from 'effector-storage/local';
  persist({ store: todosQuery.$data as StoreWritable<Todo[] | null>, key: 'todos:data' });
  ```

  (`$data` is read-only in the public type but writable at runtime — cast for `persist`.)

Full runnable flow: [`examples/ssr.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/ssr.ts).

## Notes

- Sourced config (`Store` for `concurrency` / `retry.times` / `cache.staleAfter` / `enabled`)
  is **fork-correct** — each scope sees its own value.
- Cache isolation for SSR: set `$queryCache` per fork (above). Without it, cache adapters
  hold module-level state shared across scopes.
- In-flight `AbortController`s are tracked per query _instance_; avoid sharing one query
  instance across concurrent SSR requests if you also call `cancel`.
