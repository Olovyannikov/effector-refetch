import { createStore, is, sample, type Effect, type Event, type EventCallable, type Store } from 'effector';
import type { Mutation, Query } from './types';

// A query or infinite query — anything exposing a readable `$data` plus a
// `__.setData` write seam. Regular queries own a writable `$data`; an
// `InfiniteQuery` derives `$data`/`$pages` from one source store, so patches go
// through `__.setData` instead of targeting the (derived) store directly.
export type Patchable<QM> = {
  $data: Store<QM | null>;
  __: { setData: EventCallable<QM | null> };
};

type DoneTrigger<P, R> = Query<P, any, any, R> | Mutation<P, any, any, R>;

export interface UpdateFromOperation<QM, P, R> {
  /** Query (or infinite query) whose data is patched. */
  query: Patchable<QM>;
  /** A Mutation or Query — patch runs on its success. */
  on: DoneTrigger<P, R>;
  /** Compute the new query data from current data + the trigger's result/params. */
  fn: (ctx: { data: QM | null; result: R; params: P }) => QM;
}

export interface UpdateFromEvent<QM, T> {
  query: Patchable<QM>;
  /** A raw Event or Effect — patch runs when it fires (effect: on success). */
  on: Event<T> | Effect<any, T, any>;
  fn: (ctx: { data: QM | null; payload: T }) => QM;
}

/**
 * Patch a query's data directly from a mutation result — no refetch. Works on
 * regular and infinite queries (for the latter, `data` is the page array).
 *
 *   update({ query: todosQuery, on: addTodo, fn: ({ data, result }) => [...(data ?? []), result] });
 */
export function update<QM, P, R>(config: UpdateFromOperation<QM, P, R>): void;
export function update<QM, T>(config: UpdateFromEvent<QM, T>): void;
export function update(config: any): void {
  const { query, on, fn } = config;
  const setData = query.__.setData as EventCallable<any>;
  const isOperation = on && typeof on === 'object' && 'finished' in on;

  if (isOperation) {
    sample({
      clock: on.finished.done as Event<any>,
      source: query.$data,
      fn: (data: any, p: any) => fn({ data, result: p.result, params: p.params }),
      target: setData,
    });
    return;
  }

  const clock: Event<any> = is.effect(on) ? on.done : on;
  sample({
    clock,
    source: query.$data,
    fn: (data: any, payload: any) => fn({ data, payload }),
    target: setData,
  });
}

export interface OptimisticUpdateConfig<QM, P, R> {
  /** Query (or infinite query) whose data is patched optimistically. */
  query: Patchable<QM>;
  /** Mutation that drives the optimistic update. */
  on: Mutation<P, R, any, any>;
  /** Apply the optimistic value when the mutation starts. */
  update: (ctx: { data: QM | null; params: P }) => QM;
  /** Reconcile with the server result on success (defaults to keeping the optimistic value). */
  commit?: (ctx: { data: QM | null; result: R; params: P }) => QM;
  /**
   * Roll back to the pre-mutation value when the optimistic write isn't committed —
   * on failure, and on `cancel` / `reset` while the update is still in flight. Default: true.
   */
  rollbackOnFailure?: boolean;
}

/**
 * Optimistic update: patch the data immediately on mutation start, roll back on
 * failure (and on `cancel` / `reset` while in flight), and optionally reconcile
 * with the server result on success. Works on regular and infinite queries.
 *
 * Assumes effectively-serial mutations per query (the common case); heavily
 * interleaved concurrent mutations on the same query can clobber each other's
 * rollback snapshot.
 */
export function optimisticUpdate<QM, P, R>(config: OptimisticUpdateConfig<QM, P, R>): void {
  const { query, on, update: apply, commit, rollbackOnFailure = true } = config;
  const setData = query.__.setData as EventCallable<any>;

  // snapshot previous value, then apply the optimistic one (snapshot first)
  const $rollback = createStore<QM | null>(null, { skipVoid: false });
  sample({ clock: on.start, source: query.$data, target: $rollback });
  sample({
    clock: on.start,
    source: query.$data,
    fn: (data: QM | null, params: P) => apply({ data, params }),
    target: setData,
  });

  if (rollbackOnFailure) {
    // track whether an optimistic write is currently in flight, so cancel/reset
    // before a start (or after a settle) can't wipe data with a stale snapshot
    const $active = createStore(false)
      .on(on.start, () => true)
      .on([on.finished.done, on.finished.fail], () => false);

    sample({ clock: on.finished.fail, source: $rollback, target: setData });
    sample({
      clock: [on.cancel, on.reset],
      source: { active: $active, rb: $rollback },
      filter: ({ active }) => active,
      fn: ({ rb }) => rb,
      target: setData,
    });
  }

  if (commit) {
    sample({
      clock: on.finished.done,
      source: query.$data,
      fn: (data: QM | null, p: { params: P; result: R }) =>
        commit({ data, result: p.result, params: p.params }),
      target: setData,
    });
  }
}
