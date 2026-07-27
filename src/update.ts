import {
  createEvent,
  createStore,
  is,
  sample,
  type Effect,
  type Event,
  type EventCallable,
  type Store,
} from 'effector';
import { stableStringify } from './utils';
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
  // a throwing user fn skips the patch instead of killing the clock's propagation
  const SKIP = Symbol('skip');
  const guarded = (compute: () => any): any => {
    try {
      return compute();
    } catch {
      return SKIP;
    }
  };
  const wire = (clock: Event<any>, compute: (data: any, payload: any) => any) => {
    const proposed: Event<any> = sample({ clock, source: query.$data, fn: compute });
    sample({ clock: proposed, filter: (v: any) => v !== SKIP, target: setData });
  };

  if (isOperation) {
    wire(on.finished.done as Event<any>, (data: any, p: any) =>
      guarded(() => fn({ data, result: p.result, params: p.params })),
    );
    return;
  }

  wire(is.effect(on) ? on.done : on, (data: any, payload: any) => guarded(() => fn({ data, payload })));
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
   * Roll back the layer when its mutation doesn't succeed — on failure, on an
   * aborted run (`enabled` gate skip, `TAKE_LATEST` supersede), and roll back all
   * in-flight layers on `cancel` / `reset`. With `false` the optimistic value is
   * kept regardless of the outcome. Default: true.
   */
  rollbackOnFailure?: boolean;
}

/**
 * Optimistic update: patch the data immediately on mutation start, roll back on
 * failure/abort, and optionally reconcile with the server result on success.
 * Works on regular and infinite queries.
 *
 * Safe for parallel (`TAKE_EVERY`) mutations: each start snapshots into a shared
 * base and adds its own layer; a settle removes ONLY its layer and the remaining
 * ones are re-applied over the base in start order. When a mutation succeeds, its
 * layer is materialized into the base (`commit` receives the base with this
 * mutation's own optimistic layer applied). A real fetch settling while layers are
 * in flight re-bases the queue onto the fresh data (pending layers re-applied on
 * top), so refetch-during-flight never discards server data. Caveat: with
 * out-of-order settles the layers are re-applied in start order — non-commuting
 * `update` functions may observe a different composition than the server did;
 * reconcile via `commit` or `invalidate` when exact ordering matters.
 */
export function optimisticUpdate<QM, P, R>(config: OptimisticUpdateConfig<QM, P, R>): void {
  const { query, on, update: apply, commit, rollbackOnFailure = true } = config;
  const setData = query.__.setData as EventCallable<any>;

  interface Entry {
    key: string;
    params: P;
  }
  interface Queue {
    base: QM | null;
    entries: Entry[];
    /** The exact object of our last own `setData` write — distinguishes external `$data` updates. */
    written: QM | null;
  }
  const keyOf = (params: P): string => stableStringify(params);
  // a throwing user update()/commit() must not kill the propagation — the failing
  // layer application is skipped (data passes through unchanged for that step)
  const applySafe = (ctx: { data: QM | null; params: P }): QM | null => {
    try {
      return apply(ctx);
    } catch {
      return ctx.data;
    }
  };
  const commitSafe = (ctx: { data: QM | null; result: R; params: P }): QM | null => {
    if (!commit) return ctx.data;
    try {
      return commit(ctx);
    } catch {
      return ctx.data;
    }
  };
  const fold = (base: QM | null, entries: Entry[]): QM | null =>
    entries.reduce<QM | null>((acc, e) => applySafe({ data: acc, params: e.params }), base);
  // remove the FIRST entry with this key (FIFO pairs identical params)
  const without = (entries: Entry[], key: string): Entry[] | null => {
    const idx = entries.findIndex((e) => e.key === key);
    if (idx === -1) return null;
    return entries.filter((_, i) => i !== idx);
  };

  // invariant: query data === queue.entries folded (in start order) over queue.base
  const $queue = createStore<Queue>({ base: null, entries: [], written: null }, { serialize: 'ignore' });
  const applied = createEvent<{ queue: Omit<Queue, 'written'>; data: QM | null }>();
  $queue.on(applied, (_q, { queue, data }) => ({ ...queue, written: data }));
  sample({ clock: applied, fn: ({ data }: { data: QM | null }) => data, target: setData });

  // the QUERY settled a real fetch (or anything else wrote $data) while layers are in
  // flight: re-snapshot the base to the fresh data and re-apply the pending layers —
  // otherwise the next mutation settle folds over a stale base and DISCARDS the fresh
  // server data. Own writes are recognized by object identity (`written`).
  sample({
    clock: query.$data.updates,
    source: $queue,
    filter: (q, data) => q.entries.length > 0 && data !== q.written,
    fn: (q, data) => ({
      queue: { base: data, entries: q.entries },
      data: fold(data, q.entries),
    }),
    target: applied,
  });

  // start: snapshot the base on the first in-flight layer, stack this one on top
  sample({
    clock: on.start,
    source: { q: $queue, data: query.$data },
    fn: ({ q, data }, params: P) => ({
      queue: {
        base: q.entries.length === 0 ? data : q.base,
        entries: [...q.entries, { key: keyOf(params), params }],
      },
      data: applySafe({ data, params }),
    }),
    target: applied,
  });

  // success: materialize this layer into the base, re-apply the remaining ones
  sample({
    clock: on.finished.done as Event<{ params: P; result: R }>,
    source: $queue,
    filter: (q, { params }) => without(q.entries, keyOf(params)) !== null,
    fn: (q, { params, result }) => {
      const remaining = without(q.entries, keyOf(params))!;
      const withOwn = applySafe({ data: q.base, params });
      const base = commitSafe({ data: withOwn, result, params });
      return {
        queue: { base: remaining.length ? base : null, entries: remaining },
        data: fold(base, remaining),
      };
    },
    target: applied,
  });

  // failure or aborted run (enabled skip / TAKE_LATEST supersede): drop this layer
  sample({
    clock: [on.finished.fail as Event<{ params: P }>, on.aborted as Event<{ params: P }>],
    source: $queue,
    filter: (q, { params }) => without(q.entries, keyOf(params)) !== null,
    fn: (q, { params }) => {
      const remaining = without(q.entries, keyOf(params))!;
      // rollbackOnFailure: false -> keep the optimistic value (materialize the layer)
      const base = rollbackOnFailure ? q.base : applySafe({ data: q.base, params });
      return {
        queue: { base: remaining.length ? base : null, entries: remaining },
        data: fold(base, remaining),
      };
    },
    target: applied,
  });

  // cancel/reset: all in-flight layers at once (the per-run `aborted` that follows
  // finds an empty queue and no-ops)
  sample({
    clock: [on.cancel, on.reset],
    source: { q: $queue, data: query.$data },
    filter: ({ q }) => q.entries.length > 0,
    fn: ({ q, data }) => ({
      queue: { base: null, entries: [] as Entry[] },
      data: rollbackOnFailure ? q.base : data,
    }),
    target: applied,
  });
}
