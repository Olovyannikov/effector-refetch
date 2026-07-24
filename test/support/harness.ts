import { createEffect, type Effect } from 'effector';
import { createRequestFx } from '../../src';

/**
 * Deferred-gate handler harness: every call opens a gate keyed by its params;
 * the test resolves/rejects gates explicitly, so async interleavings are
 * driven by hand instead of timers. The abortable flavor also records WHY a
 * run ended (its AbortSignal's state), which plain deferreds can't assert.
 */

export interface DeferredEffect<P, R> {
  fx: Effect<P, R>;
  /** Params of every call, in start order. */
  started: P[];
  /** Resolve the Nth call (start order). */
  resolve: (index: number, value: R) => void;
  /** Reject the Nth call. */
  reject: (index: number, error?: Error) => void;
  /** Resolve every still-open gate with `value`. */
  resolveAll: (value: R) => void;
}

/** Plain effect whose calls wait on explicit gates. */
export function deferredEffect<P, R>(): DeferredEffect<P, R> {
  const started: P[] = [];
  const gates: Array<{ res: (v: R) => void; rej: (e: Error) => void; open: boolean }> = [];
  const fx = createEffect<P, R>(
    (params) =>
      new Promise<R>((res, rej) => {
        started.push(params);
        gates.push({ res, rej, open: true });
      }),
  );
  const settle = (index: number, run: (g: (typeof gates)[number]) => void) => {
    const gate = gates[index];
    if (!gate) throw new Error(`deferredEffect: no call #${index} (saw ${gates.length})`);
    if (!gate.open) throw new Error(`deferredEffect: call #${index} already settled`);
    gate.open = false;
    run(gate);
  };
  return {
    fx,
    started,
    resolve: (i, v) => settle(i, (g) => g.res(v)),
    reject: (i, e = new Error('rejected')) => settle(i, (g) => g.rej(e)),
    resolveAll: (v) => gates.forEach((g, i) => g.open && settle(i, (gate) => gate.res(v))),
  };
}

export interface AbortableDeferred<P, R> extends DeferredEffect<P, R> {
  /** The Nth call's AbortSignal — assert `aborted` and `reason`. */
  signals: AbortSignal[];
}

/**
 * Abort-aware flavor (built on `createRequestFx`): an abort rejects the pending
 * gate with the signal's reason, and `signals[i]` lets the test assert WHICH
 * runs were aborted — not just that data went missing.
 */
export function abortableDeferred<P, R>(): AbortableDeferred<P, R> {
  const started: P[] = [];
  const signals: AbortSignal[] = [];
  const gates: Array<{ res: (v: R) => void; rej: (e: Error) => void; open: boolean }> = [];
  const fx = createRequestFx<P, R>(
    (params, { signal }) =>
      new Promise<R>((res, rej) => {
        started.push(params);
        signals.push(signal);
        const gate = { res, rej, open: true };
        gates.push(gate);
        signal.addEventListener('abort', () => {
          if (!gate.open) return;
          gate.open = false;
          rej(new Error(`aborted:${JSON.stringify(params)}`));
        });
      }),
  );
  const settle = (index: number, run: (g: (typeof gates)[number]) => void) => {
    const gate = gates[index];
    if (!gate) throw new Error(`abortableDeferred: no call #${index} (saw ${gates.length})`);
    if (!gate.open) throw new Error(`abortableDeferred: call #${index} already settled`);
    gate.open = false;
    run(gate);
  };
  return {
    fx,
    started,
    signals,
    resolve: (i, v) => settle(i, (g) => g.res(v)),
    reject: (i, e = new Error('rejected')) => settle(i, (g) => g.rej(e)),
    resolveAll: (v) => gates.forEach((g, i) => g.open && settle(i, (gate) => gate.res(v))),
  };
}
