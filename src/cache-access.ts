import type { Query } from './types';

/**
 * Read a query's current data imperatively (no-scope store — for a single client
 * app; in scoped code read `scope.getState(query.$data)` instead).
 */
export function getQueryData<Params, Result, Error, Mapped>(
  query: Query<Params, Result, Error, Mapped>,
): Mapped | null {
  return query.$data.getState();
}

/**
 * Write a query's `$data` imperatively — a value, or an updater `(prev) => next`.
 * Useful for optimistic edits outside the `update` / `optimisticUpdate` operators.
 *
 *   setQueryData(todosQuery, (todos) => [...(todos ?? []), newTodo]);
 *
 * The updater form is applied inside the store reducer (`__.updateData`), so `prev`
 * is read without `getState`; fired raw it targets the no-scope store (single-client),
 * and `allSettled(query.__.updateData, { scope, params: updater })` writes into a scope.
 */
export function setQueryData<Params, Result, Error, Mapped>(
  query: Query<Params, Result, Error, Mapped>,
  updater: (Mapped | null) | ((prev: Mapped | null) => Mapped | null),
): void {
  if (typeof updater === 'function') {
    query.__.updateData(updater as (prev: Mapped | null) => Mapped | null);
  } else {
    query.__.setData(updater);
  }
}
