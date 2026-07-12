import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { attachQueryLogger, createQuery, type QueryLogEntry } from '../src';

describe('attachQueryLogger', () => {
  it('logs start -> run -> done with duration', async () => {
    const entries: QueryLogEntry[] = [];
    const fx = createEffect(async (n: number) => n * 2);
    const query = createQuery({ effect: fx });
    attachQueryLogger(query, { name: 'q', handler: (e) => entries.push(e), now: () => 1000 });

    const scope = fork();
    await allSettled(query.start, { scope, params: 5 });

    const types = entries.map((e) => e.type);
    expect(types).toEqual(['start', 'run', 'done']);
    expect(entries[1]).toMatchObject({ type: 'run', params: 5, attempt: 0 });
    expect(entries[2]).toMatchObject({ type: 'done', params: 5, durationMs: 0 });
  });

  it('logs retries and the final failure', async () => {
    const entries: QueryLogEntry[] = [];
    let calls = 0;
    const fx = createEffect(async (): Promise<number> => {
      calls++;
      throw new Error('boom');
    });
    const query = createQuery({ effect: fx, retry: { times: 2, delay: 0 } });
    attachQueryLogger(query, { name: 'q', handler: (e) => entries.push(e) });

    const scope = fork();
    await allSettled(query.start, { scope });

    const types = entries.map((e) => e.type);
    // start, run, retry, run, retry, run, fail
    expect(types.filter((t) => t === 'run').length).toBe(3);
    expect(types.filter((t) => t === 'retry').length).toBe(2);
    expect(types[types.length - 1]).toBe('fail');
    expect(entries[entries.length - 1]).toMatchObject({ type: 'fail' });
  });

  it('logs cache hit/miss', async () => {
    const entries: QueryLogEntry[] = [];
    const fx = createEffect(async (n: number) => n);
    const query = createQuery({ effect: fx, cache: true });
    attachQueryLogger(query, { handler: (e) => entries.push(e) });

    const scope = fork();
    await allSettled(query.start, { scope, params: 1 }); // miss -> run -> done
    await allSettled(query.start, { scope, params: 1 }); // hit

    expect(entries.some((e) => e.type === 'cache-miss')).toBe(true);
    expect(entries.some((e) => e.type === 'cache-hit')).toBe(true);
  });

  it('computes durations per run under concurrent (TAKE_EVERY) runs', async () => {
    const entries: QueryLogEntry[] = [];
    let t = 0;
    const resolvers = new Map<string, (v: string) => void>();
    const fx = createEffect((key: string) => new Promise<string>((res) => resolvers.set(key, res)));
    const query = createQuery({ effect: fx, concurrency: 'TAKE_EVERY' });
    attachQueryLogger(query, { name: 'q', handler: (e) => entries.push(e), now: () => t });

    const scope = fork();
    t = 100;
    const pa = allSettled(query.start, { scope, params: 'a' }); // run a @ 100
    t = 200;
    const pb = allSettled(query.start, { scope, params: 'b' }); // run b @ 200

    t = 300;
    resolvers.get('a')!('a'); // done a @ 300
    await new Promise((r) => setTimeout(r, 0)); // let done-a log (allSettled waits for the whole scope)
    t = 500;
    resolvers.get('b')!('b'); // done b @ 500
    await Promise.all([pa, pb]);

    const doneA = entries.find((e) => e.type === 'done' && e.params === 'a');
    const doneB = entries.find((e) => e.type === 'done' && e.params === 'b');
    expect(doneA?.durationMs).toBe(200); // from run a's own timestamp, not run b's
    expect(doneB?.durationMs).toBe(300);
  });

  it('duration on retry is measured from the last run', async () => {
    const entries: QueryLogEntry[] = [];
    let t = 0;
    const now = () => (t += 100); // run1 -> 100, run2 -> 200, done -> 300
    let calls = 0;
    const fx = createEffect(async () => {
      calls++;
      if (calls === 1) throw new Error('flaky');
      return calls;
    });
    const query = createQuery({ effect: fx, retry: { times: 2, delay: 0 } });
    attachQueryLogger(query, { name: 'q', handler: (e) => entries.push(e), now });

    const scope = fork();
    await allSettled(query.start, { scope });

    const done = entries.find((e) => e.type === 'done');
    expect(done?.durationMs).toBe(100); // 300 - 200 (the retry run), not 300 - 100
  });

  it('scope option isolates the log to that fork', async () => {
    const entries: QueryLogEntry[] = [];
    const fx = createEffect(async (n: number) => n);
    const query = createQuery({ effect: fx });
    const scopeA = fork();
    const scopeB = fork();
    attachQueryLogger(query, { handler: (e) => entries.push(e), scope: scopeA });

    await allSettled(query.start, { scope: scopeA, params: 1 });
    await allSettled(query.start, { scope: scopeB, params: 2 });

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.params === 1)).toBe(true); // nothing from scope B
  });

  it('unsubscribe stops logging', async () => {
    const entries: QueryLogEntry[] = [];
    const fx = createEffect(async (n: number) => n);
    const query = createQuery({ effect: fx });
    const stop = attachQueryLogger(query, { handler: (e) => entries.push(e) });
    stop();

    const scope = fork();
    await allSettled(query.start, { scope, params: 1 });
    expect(entries).toHaveLength(0);
  });
});
