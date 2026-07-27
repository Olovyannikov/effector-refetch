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

  it('keeps still-used names without an effector-refetch equivalent on @farfetched/core, annotated', () => {
    const out = run(`
import { createQuery, declareParams, attachOperation } from '@farfetched/core';
const q = createQuery({ effect: fx });
const params = declareParams<number>();
const attached = attachOperation(q);
`);
    expect(out).toMatch(/import\s*{\s*createQuery\s*}\s*from 'effector-refetch'/);
    expect(out).toMatch(/import\s*{\s*declareParams,\s*attachOperation\s*}\s*from '@farfetched\/core'/);
    expect(out).toContain('TODO(effector-refetch-codemod): declareParams, attachOperation');
  });

  it('silently drops unknown names that are no longer referenced anywhere', () => {
    const out = run(`
import { createQuery, declareParams } from '@farfetched/core';
const q = createQuery({ effect: fx });
`);
    expect(out).toMatch(/import\s*{\s*createQuery\s*}\s*from 'effector-refetch'/);
    expect(out).not.toContain('declareParams');
    expect(out).not.toContain('@farfetched/core');
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

  it('migrates the createJsonQuery shape: drops declareParams, hoists response.mapData/validate', () => {
    const out = run(`
import { createJsonQuery, declareParams } from '@farfetched/core';
const q = createJsonQuery({
  params: declareParams<{ id: number }>(),
  request: { url: '/api/user', method: 'GET' },
  response: {
    contract: userContract,
    mapData: ({ result }) => result.user,
    validate: ({ result }) => result.ok,
  },
});
`);
    // params dropped, typing pointer left behind
    expect(out).not.toContain('declareParams');
    expect(out).toContain('createJsonQuery<{ id: number }, Response>');
    // mapData/validate hoisted to the top level, contract stays in response
    expect(out).toMatch(/mapData: \(\{ result \}\) => result\.user/);
    expect(out).toMatch(/validate: \(\{ result \}\) => result\.ok/);
    // contract stays as the only thing left inside response
    expect(out).toMatch(/response: \{\s*contract: userContract\s*\}/);
    // the now-unused declareParams import vanished entirely (no TODO for it)
    expect(out).toMatch(/import\s*{\s*createJsonQuery\s*}\s*from 'effector-refetch'/);
    expect(out).not.toContain('@farfetched/core');
  });

  it('flags sourced response.mapData and unknown response fields instead of hoisting', () => {
    const out = run(`
import { createJsonQuery } from '@farfetched/core';
const q = createJsonQuery({
  request: { url: '/x', method: 'GET' },
  response: {
    mapData: { source: $lang, fn: (lang, { result }) => result[lang] },
    status: { expected: [200] },
  },
});
`);
    expect(out).toContain('response.mapData with { source } has no equivalent');
    expect(out).toContain('response.status has no equivalent');
    // the sourced mapData is left in place for hand-migration
    expect(out).toMatch(/response:[\s\S]*mapData:[\s\S]*source: \$lang/);
  });

  it('rewrites unused chainRoute(...startChain(q)) to attachToRoute and cleans the imports', () => {
    const out = run(`
import { chainRoute } from 'atomic-router';
import { startChain } from '@farfetched/atomic-router';
import { createQuery } from '@farfetched/core';
const postQuery = createQuery({ effect: fx });
chainRoute({ route: postRoute, ...startChain(postQuery) });
`);
    expect(out).toContain('attachToRoute({ route: postRoute, query: postQuery });');
    expect(out).not.toContain('chainRoute');
    expect(out).not.toContain('startChain');
    expect(out).not.toContain('@farfetched/atomic-router');
    expect(out).not.toContain(`'atomic-router'`);
    // attachToRoute joined the effector-refetch import
    expect(out).toMatch(/import\s*{\s*createQuery,\s*attachToRoute\s*}\s*from 'effector-refetch'/);
  });

  it('freshChain rewrites too, with a note about the freshness gate', () => {
    const out = run(`
import { chainRoute } from 'atomic-router';
import { freshChain } from '@farfetched/atomic-router';
import { createQuery } from '@farfetched/core';
const q = createQuery({ effect: fx });
chainRoute({ route: r, ...freshChain(q) });
`);
    expect(out).toContain('attachToRoute({ route: r, query: q });');
    expect(out).toContain('pair the query with cache({ staleAfter })');
  });

  it('annotates a USED chained route instead of rewriting (gating semantics differ)', () => {
    const out = run(`
import { chainRoute } from 'atomic-router';
import { startChain } from '@farfetched/atomic-router';
import { createQuery } from '@farfetched/core';
const q = createQuery({ effect: fx });
const loadedRoute = chainRoute({ route: postRoute, ...startChain(q) });
`);
    // the chained call survives, with a TODO explaining the difference
    expect(out).toContain('const loadedRoute = chainRoute({ route: postRoute, ...startChain(q) });');
    expect(out).toContain('gates the route on the query settling');
    // imports stay (still referenced), the farfetched router import gets a pointer
    expect(out).toContain(`from 'atomic-router'`);
    expect(out).toContain('left-over @farfetched/atomic-router usage');
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
