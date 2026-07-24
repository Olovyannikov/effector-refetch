import { describe, it, expect } from 'vitest';
import { createEffect } from 'effector';
import { inspectGraph } from 'effector/inspect';
import { createQuery } from '../src';

/** Collect the names of all units created while running `build`. */
function namesCreatedBy(build: () => void): string[] {
  const names: string[] = [];
  const sub = inspectGraph({
    fn: (d) => {
      if (d.type === 'unit' && d.name) names.push(d.name);
    },
  });
  build();
  sub.unsubscribe();
  return names;
}

describe('deep devtools labelling', () => {
  it('names the internal seam units under the query `name`', () => {
    const names = namesCreatedBy(() => {
      const fx = createEffect(async (id: number) => id);
      createQuery({ effect: fx, name: 'user', cache: true, retry: 1 });
    });

    // public surface
    expect(names).toContain('user.$status');
    expect(names).toContain('user.$data');
    expect(names).toContain('user.runFx');
    expect(names).toContain('user.finished.done');
    // internal seams: lookup / concurrency / dedupe / retry / failure
    for (const seam of [
      'user.requested',
      'user.proceed',
      'user.toExec',
      'user.lookupFx',
      'user.toRun',
      'user.rawDone',
      'user.acceptedDone',
      'user.scheduleRetry',
      'user.failed',
      'user.finalFail',
      'user.$runId',
      'user.$retryWaits',
    ]) {
      expect(names).toContain(seam);
    }
  });

  it('leaves internal units unnamed when no `name`/`debug` is given', () => {
    const names = namesCreatedBy(() => {
      createQuery({ effect: createEffect(async () => 1) });
    });
    // none of our seam labels leak in without an explicit name
    expect(names.some((n) => n.endsWith('.lookupFx') || n.endsWith('.scheduleRetry'))).toBe(false);
  });

  it('`debug: true` labels units under the `query` namespace', () => {
    const names = namesCreatedBy(() => {
      createQuery({ effect: createEffect(async () => 1), debug: true });
    });
    expect(names).toContain('query.runFx');
    expect(names).toContain('query.requested');
  });
});
