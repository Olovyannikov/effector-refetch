import { describe, it, expect } from 'vitest';
import { allSettled, createWatch, fork } from 'effector';
import { createMutation, createQuery, type AbortReason } from '../src';
import { deferredEffect } from './support/harness';

describe('QUEUE strategy', () => {
  it('serializes runs: the next starts only after the previous settles', async () => {
    const d = deferredEffect<number, string>();
    const query = createQuery({ effect: d.fx, concurrency: 'QUEUE' });
    const scope = fork();

    const p1 = allSettled(query.start, { scope, params: 1 });
    const p2 = allSettled(query.start, { scope, params: 2 });
    const p3 = allSettled(query.start, { scope, params: 3 });
    expect(d.started).toEqual([1]); // 2 and 3 wait in the lane queue

    d.resolve(0, 'v1');
    await new Promise((r) => setTimeout(r, 0));
    expect(d.started).toEqual([1, 2]);

    d.resolve(1, 'v2');
    await new Promise((r) => setTimeout(r, 0));
    expect(d.started).toEqual([1, 2, 3]);

    d.resolve(2, 'v3');
    await Promise.all([p1, p2, p3]);
    expect(scope.getState(query.$data)).toBe('v3'); // settles in start order, last wins
    expect(scope.getState(query.$status)).toBe('done');
  });

  it('a failure does not break the chain', async () => {
    const d = deferredEffect<number, string>();
    const query = createQuery({ effect: d.fx, concurrency: 'QUEUE' });
    const scope = fork();

    const p1 = allSettled(query.start, { scope, params: 1 });
    const p2 = allSettled(query.start, { scope, params: 2 });

    d.reject(0, new Error('first failed'));
    await new Promise((r) => setTimeout(r, 0));
    expect(d.started).toEqual([1, 2]); // the queue kept moving

    d.resolve(1, 'v2');
    await Promise.all([p1, p2]);
    expect(scope.getState(query.$data)).toBe('v2');
    expect(scope.getState(query.$status)).toBe('done');
  });

  it('queues are per lane under a lane key', async () => {
    const d = deferredEffect<{ lane: string; n: number }, string>();
    const query = createQuery({
      effect: d.fx,
      concurrency: { strategy: 'QUEUE', key: ({ lane }) => lane },
    });
    const scope = fork();

    const pa1 = allSettled(query.start, { scope, params: { lane: 'a', n: 1 } });
    const pa2 = allSettled(query.start, { scope, params: { lane: 'a', n: 2 } });
    const pb1 = allSettled(query.start, { scope, params: { lane: 'b', n: 1 } });

    // lane b runs immediately, in parallel with lane a's head; a2 waits
    expect(d.started.map((p) => `${p.lane}${p.n}`)).toEqual(['a1', 'b1']);

    d.resolveAll('done');
    await new Promise((r) => setTimeout(r, 0));
    d.resolveAll('done');
    await Promise.all([pa1, pa2, pb1]);
    expect(d.started.map((p) => `${p.lane}${p.n}`)).toEqual(['a1', 'b1', 'a2']);
  });

  it('cancel flushes the queue: waiting runs abort as "cancelled" and startAsync rejects', async () => {
    const d = deferredEffect<number, string>();
    const query = createQuery({ effect: d.fx, concurrency: 'QUEUE' });
    const scope = fork();
    const reasons: AbortReason[] = [];
    createWatch({ unit: query.aborted, scope, fn: ({ reason }) => reasons.push(reason) });

    const p1 = allSettled(query.startAsync, { scope, params: 1 });
    const p2 = allSettled(query.startAsync, { scope, params: 2 }); // queued, never starts
    expect(d.started).toEqual([1]);

    const pc = allSettled(query.cancel, { scope });
    d.resolve(0, 'late'); // let the in-flight zombie settle so the scope can idle
    const [o1, o2] = (await Promise.all([p1, p2, pc].slice(0, 2))) as Array<{
      status: string;
      value: unknown;
    }>;
    await pc;

    expect(d.started).toEqual([1]); // the queued run never executed
    expect(o2.status).toBe('fail');
    expect(String(o2.value)).toContain('cancelled');
    expect(reasons).toContain('cancelled');
    void o1;
  });

  it('serialized writes: mutations with QUEUE apply in order', async () => {
    const applied: string[] = [];
    const d = deferredEffect<string, string>();
    const saveMutation = createMutation({ effect: d.fx, concurrency: 'QUEUE' });
    const scope = fork();
    createWatch({ unit: saveMutation.finished.done, scope, fn: ({ result }) => applied.push(result) });

    const p1 = allSettled(saveMutation.mutate, { scope, params: 'w1' });
    const p2 = allSettled(saveMutation.mutate, { scope, params: 'w2' });
    expect(d.started).toEqual(['w1']); // w2 waits — no concurrent writes

    d.resolve(0, 'saved:w1');
    await new Promise((r) => setTimeout(r, 0));
    d.resolve(1, 'saved:w2');
    await Promise.all([p1, p2]);

    expect(applied).toEqual(['saved:w1', 'saved:w2']); // strict start order
  });
});
