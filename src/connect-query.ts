import { combine, sample } from 'effector';
import type { ParamsOf, Query, ResultOf } from './types';

type SourceCtx<P, R> = { result: R; params: P | null };

interface SingleNoParams<SP, SR, SE> {
  source: Query<SP, any, SE, SR>;
  target: Query<void, any, any, any>;
  filter?: (ctx: SourceCtx<SP, SR>) => boolean;
}
interface SingleWithFn<SP, SR, SE, TP> {
  source: Query<SP, any, SE, SR>;
  fn: (ctx: SourceCtx<SP, SR>) => { params: TP };
  target: Query<TP, any, any, any>;
  filter?: (ctx: SourceCtx<SP, SR>) => boolean;
}

type Sources = Record<string, Query<any, any, any, any>>;
type MultiCtx<S extends Sources> = {
  [K in keyof S]: { result: ResultOf<S[K]>; params: ParamsOf<S[K]> | null };
};
interface MultiNoParams<S extends Sources> {
  source: S;
  target: Query<void, any, any, any>;
  filter?: (ctx: MultiCtx<S>) => boolean;
}
interface MultiWithFn<S extends Sources, TP> {
  source: S;
  fn: (ctx: MultiCtx<S>) => { params: TP };
  target: Query<TP, any, any, any>;
  filter?: (ctx: MultiCtx<S>) => boolean;
}

export function connectQuery<SP, SR, SE>(config: SingleNoParams<SP, SR, SE>): void;
export function connectQuery<SP, SR, SE, TP>(config: SingleWithFn<SP, SR, SE, TP>): void;
export function connectQuery<S extends Sources>(config: MultiNoParams<S>): void;
export function connectQuery<S extends Sources, TP>(config: MultiWithFn<S, TP>): void;
export function connectQuery(config: any): void {
  const { source, target, fn, filter } = config;

  // single source: Query has a `.start` trigger, so it's not a plain Sources record
  const isSingle = source && typeof source === 'object' && 'finished' in source;

  // user callbacks run in pure positions — a throw must not kill the source query's
  // propagation (other subscribers of finished.done ride the same tick)
  const guardFilter = (check: () => boolean): boolean => {
    try {
      return check();
    } catch {
      return false;
    }
  };

  if (isSingle) {
    const q = source as Query<any, any, any, any>;
    const compute = (clk: any) => (fn ? fn({ result: clk.result, params: clk.params }).params : undefined);
    sample({
      clock: q.finished.done,
      filter: (clk: any) =>
        guardFilter(() => {
          if (filter && !filter({ result: clk.result, params: clk.params })) return false;
          compute(clk); // probe: a throwing fn drops the connection instead of the tick
          return true;
        }),
      fn: compute,
      target: target.start as any,
    });
    return;
  }

  // multiple sources
  const keys = Object.keys(source) as string[];
  const queries = source as Sources;

  const $ctx = combine(
    keys.reduce<Record<string, any>>((acc, k) => {
      acc[k] = combine({ result: queries[k].$data, params: queries[k].$params });
      return acc;
    }, {}),
  );
  const $allDone = combine(
    keys.map((k) => queries[k].$status),
    (statuses) => statuses.every((s) => s === 'done'),
  );

  sample({
    clock: keys.map((k) => queries[k].finished.done),
    source: { ctx: $ctx, allDone: $allDone },
    filter: ({ ctx, allDone }) =>
      guardFilter(() => {
        if (!allDone || (filter && !filter(ctx))) return false;
        if (fn) fn(ctx); // probe
        return true;
      }),
    fn: ({ ctx }) => (fn ? fn(ctx).params : undefined),
    target: target.start as any,
  });
}
