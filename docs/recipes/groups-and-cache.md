# Groups & cache access

## Invalidate a group of queries

A [factory](/recipes/defaults) registers every query it creates, so you can refetch them
together — the effector-flavored equivalent of `queryClient.invalidateQueries`:

```ts
import { createQueryFactory } from 'effector-refetch';

const { createQuery, invalidate } = createQueryFactory();

const todos = createQuery({ effect: fetchTodosFx });
const profile = createQuery({ effect: fetchProfileFx });

// refetch every query that has run
invalidate();

// or narrow with a predicate (receives the query object)
invalidate({ predicate: (q) => q === todos });
```

`invalidate` is a plain event — scope-correct and composable:
`sample({ clock: loggedOut, target: invalidate })`. Only queries that have already run are
refetched, with their last params.

In SSR / tests it carries an optional payload, so `allSettled` needs `params` spelled out:

```ts
await allSettled(invalidate, { scope, params: undefined }); // all
await allSettled(invalidate, { scope, params: { predicate: (q) => q === todos } });
```

Need separate groups? Use multiple factories.

## Cancel a group of queries

The same registry backs `cancel`, which aborts the in-flight runs of every query the factory
created:

```ts
const { createQuery, cancel } = createQueryFactory();

cancel(); // abort whatever is in flight
await allSettled(cancel, { scope }); // SSR / tests
```

It takes no predicate, unlike `invalidate`: cancelling an idle query is already a no-op, so
"cancel all" costs nothing, and narrowing to one query is just `todos.cancel()`. Mutations are
not registered by the factory and are unaffected.

Its natural pair is a framework abort in an SSR loader — see
[Cancelling requests](/recipes/cancellation#bridging-an-outside-abortsignal-ssr-loaders).

## Read & write cache imperatively

```ts
import { getQueryData, setQueryData } from 'effector-refetch';

const todos = getQueryData(todosQuery); // current $data
setQueryData(todosQuery, (prev) => [...(prev ?? []), newTodo]); // value or (prev) => next
```

These read/write the no-scope store — for a single client app. The `(prev) => next`
updater is applied inside the store reducer (`__.updateData`), so it reads `prev`
without `getState`. In scoped code read `scope.getState(query.$data)` and write into a
scope with:

```ts
import { allSettled } from 'effector';

allSettled(todosQuery.__.updateData, { scope, params: (prev) => [...(prev ?? []), newTodo] });
```

For mutation-driven edits prefer the [`update`](/api/mutations#update) /
[`optimisticUpdate`](/recipes/optimistic) operators (they're scope-correct).

## gcTime?

TanStack's `gcTime` evicts cache entries once they have no observers. effector-refetch
doesn't track observers (queries are plain units, not subscriptions), so the closest knob
is age-based eviction on the adapter: `inMemoryCache({ maxAge })` /
`localStorageCache({ maxAge })`, plus `maxEntries` for an LRU cap.
