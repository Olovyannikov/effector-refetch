import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no type declarations
import { migrateCode } from '../codemod/transform.mjs';

const run = (code: string): string => migrateCode(code) as string;

describe('farfetched → effector-refetch codemod', () => {
  it('rewrites the import source', () => {
    const out = run(`import { createQuery, connectQuery } from '@farfetched/core';`);
    expect(out).toContain(`from 'effector-refetch'`);
    expect(out).not.toContain('@farfetched/core');
    expect(out).toContain('createQuery');
    expect(out).toContain('connectQuery');
  });

  it('folds retry/cache/concurrency operators into the createQuery config', () => {
    const out = run(`
import { createQuery, retry, cache, concurrency } from '@farfetched/core';
const userQuery = createQuery({ effect: fetchUserFx });
retry(userQuery, { times: 3 });
cache(userQuery, { staleAfter: 60000 });
concurrency(userQuery, { strategy: 'TAKE_LATEST' });
`);
    // operators folded inline
    expect(out).toContain('retry: { times: 3 }');
    expect(out).toContain('cache: { staleAfter: 60000 }');
    expect(out).toContain("concurrency: 'TAKE_LATEST'");
    // standalone calls removed
    expect(out).not.toMatch(/retry\(userQuery/);
    expect(out).not.toMatch(/cache\(userQuery/);
    expect(out).not.toMatch(/concurrency\(userQuery/);
    // now-unused operator imports dropped → only createQuery left in the import
    expect(out).toMatch(/import\s*{\s*createQuery\s*}\s*from 'effector-refetch'/);
  });

  it('cache() with no options folds to cache: true', () => {
    const out = run(`
import { createQuery, cache } from '@farfetched/core';
const q = createQuery({ effect: fx });
cache(q);
`);
    expect(out).toContain('cache: true');
    expect(out).not.toMatch(/cache\(q\)/);
  });

  it('leaves operators on a dynamic/unknown target untouched', () => {
    const out = run(`
import { createQuery, retry } from '@farfetched/core';
retry(someExternalQuery, { times: 2 });
`);
    // can't statically fold -> keep the call and the import
    expect(out).toMatch(/retry\(someExternalQuery/);
    expect(out).toContain('retry');
    expect(out).toContain(`from 'effector-refetch'`);
  });

  it('does not touch non-farfetched imports', () => {
    const code = `import { createStore } from 'effector';\nconst $x = createStore(0);\n`;
    expect(run(code)).toContain(`from 'effector'`);
  });

  it('a conflicting operator call overwrites the inline option (last wins, like farfetched runtime)', () => {
    const out = run(`
import { createQuery, concurrency } from '@farfetched/core';
const q = createQuery({ effect: fx, concurrency: 'TAKE_FIRST' });
concurrency(q, { strategy: 'TAKE_EVERY' });
`);
    // the operator ran after createQuery -> its strategy is the effective one
    expect(out).toContain("concurrency: 'TAKE_EVERY'");
    expect(out).not.toContain('TAKE_FIRST');
    expect(out).not.toMatch(/concurrency\(q/);
  });

  it('folds concurrency with a lane key as the object form', () => {
    const out = run(`
import { createQuery, concurrency } from '@farfetched/core';
const q = createQuery({ effect: fx });
concurrency(q, { strategy: 'TAKE_LATEST', key: (p) => p.id });
`);
    expect(out).toContain("concurrency: { strategy: 'TAKE_LATEST', key: (p) => p.id }");
    expect(out).not.toMatch(/^concurrency\(q/m);
  });

  it('keeps a concurrency call with unknown extras and annotates it', () => {
    const out = run(`
import { createQuery, concurrency } from '@farfetched/core';
const q = createQuery({ effect: fx });
concurrency(q, { strategy: 'TAKE_LATEST', abortAll });
`);
    expect(out).toMatch(/concurrency\(q, \{ strategy: 'TAKE_LATEST', abortAll \}\)/);
    expect(out).toContain("TODO(effector-refetch-codemod): 'abortAll'");
  });

  it('folds timeout, translating the farfetched { after } shape', () => {
    const out = run(`
import { createQuery, timeout } from '@farfetched/core';
const q = createQuery({ effect: fx });
timeout(q, { after: 5000 });
`);
    expect(out).toContain('timeout: 5000');
    expect(out).not.toMatch(/timeout\(q/);
    expect(out).not.toMatch(/import\s*{[^}]*timeout[^}]*}/);
  });

  it('folds operators into createMutation and createJsonQuery configs too', () => {
    const out = run(`
import { createMutation, createJsonQuery, retry, cache } from '@farfetched/core';
const m = createMutation({ effect: fx });
retry(m, { times: 2 });
const jq = createJsonQuery({ request: { url: '/x', method: 'GET' } });
cache(jq, { staleAfter: 1000 });
`);
    expect(out).toContain('retry: { times: 2 }');
    expect(out).toContain('cache: { staleAfter: 1000 }');
    expect(out).not.toMatch(/retry\(m/);
    expect(out).not.toMatch(/cache\(jq/);
  });

  it('keeps names without an effector-refetch equivalent on @farfetched/core, annotated', () => {
    const out = run(`
import { createQuery, declareParams, attachOperation } from '@farfetched/core';
const q = createQuery({ effect: fx });
`);
    expect(out).toMatch(/import\s*{\s*createQuery\s*}\s*from 'effector-refetch'/);
    expect(out).toMatch(/import\s*{\s*declareParams,\s*attachOperation\s*}\s*from '@farfetched\/core'/);
    expect(out).toContain('TODO(effector-refetch-codemod): declareParams, attachOperation');
  });

  it('rewrites contract adapter packages to the main entry (with the runtypes rename)', () => {
    const out = run(`
import { zodContract } from '@farfetched/zod';
import { runtypeContract } from '@farfetched/runtypes';
`);
    expect(out).toMatch(/import\s*{\s*zodContract\s*}\s*from 'effector-refetch'/);
    expect(out).toMatch(/import\s*{\s*runtypesContract as runtypeContract\s*}\s*from 'effector-refetch'/);
    expect(out).not.toContain('@farfetched/zod');
    expect(out).not.toContain('@farfetched/runtypes');
  });

  it('annotates incompatible shapes instead of migrating them silently', () => {
    const out = run(`
import { createQuery, update, keepFresh, retry } from '@farfetched/core';
const q = createQuery({ effect: fx });
update(q, { on: doneFx, by: { success: () => ({ result: [] }) } });
keepFresh(q, { automatically: true });
retry(q, { times: 3, otherwise: failFx });
`);
    expect(out).toContain('update() takes { query, on, fn }');
    expect(out).toContain("'automatically' has no equivalent");
    expect(out).toContain("retry 'otherwise' has no equivalent");
    // the incompatible retry call is kept, not half-migrated
    expect(out).toMatch(/retry\(q, \{ times: 3, otherwise: failFx \}\)/);
  });

  it('rewrites the applyBarrier object form to positional and warns on Time strings', () => {
    const out = run(`
import { createQuery, cache, applyBarrier } from '@farfetched/core';
const q = createQuery({ effect: fx });
cache(q, { staleAfter: '5min' });
applyBarrier(q, { barrier: authBarrier });
`);
    expect(out).toContain('applyBarrier(q, authBarrier)');
    expect(out).toContain("Time strings ('5min') must become numbers");
    expect(out).toContain("cache: { staleAfter: '5min' }"); // folded, but flagged above
  });
});
