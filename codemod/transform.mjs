import { Node, Project, QuoteKind, SyntaxKind } from 'ts-morph';

const FARFETCHED = '@farfetched/core';
const TARGET = 'effector-refetch';
const TODO = '// TODO(effector-refetch-codemod):';

// standalone operators that fold into the inline factory config
const FOLDABLE = new Set(['retry', 'cache', 'concurrency', 'timeout']);

// factories whose object-literal config accepts the folded options inline
const FACTORIES = new Set(['createQuery', 'createMutation', 'createJsonQuery', 'createJsonMutation']);

// Names exported by effector-refetch's main entry (values and types). Anything a
// farfetched file imports that is NOT here has no drop-in equivalent — it stays
// on the original import with a TODO instead of becoming a broken import.
const KNOWN_EXPORTS = new Set([
  // factories & composition
  'createQuery',
  'createMutation',
  'createQueryFactory',
  'createInfiniteQuery',
  'combineQueries',
  'connectQuery',
  // operators
  'concurrency',
  'retry',
  'cache',
  'timeout',
  'debounce',
  'fallback',
  'keepFresh',
  'applyBarrier',
  // http & validation
  'createJsonQuery',
  'createJsonMutation',
  'createJsonRequestFx',
  'createRequestFx',
  'HTTP_METHODS',
  'RequestError',
  'normalizeRequestError',
  'isRequestError',
  'isHttpError',
  'isTimeoutError',
  'ValidationError',
  'isValidationError',
  'createContract',
  'zodContract',
  'standardSchemaContract',
  'runtypesContract',
  'ioTsContract',
  // cache & data access
  '$queryCache',
  'inMemoryCache',
  'localStorageCache',
  'sessionStorageCache',
  'voidCache',
  'dehydrate',
  'hydrate',
  'getQueryData',
  'setQueryData',
  // browser / barriers / routing / triggers
  'refetchOnWindowFocus',
  'refetchOnReconnect',
  'createNetworkBarrier',
  'createBarrier',
  'attachToRoute',
  'isTrigger',
  // invalidation & updates
  'invalidate',
  'invalidateTag',
  'update',
  'optimisticUpdate',
  // misc
  'linearDelay',
  'exponentialDelay',
  '$queryDefaults',
  'setQueryDefaults',
  'attachQueryLogger',
  'stableStringify',
  // common shared type names
  'Query',
  'Mutation',
  'Contract',
  'RetryConfig',
  'CacheConfig',
  'ConcurrencyStrategy',
  'Trigger',
  'Barrier',
]);

// farfetched validation adapters -> same-name (or renamed) main-entry exports
const CONTRACT_PACKAGES = {
  '@farfetched/zod': { zodContract: 'zodContract' },
  '@farfetched/io-ts': { ioTsContract: 'ioTsContract' },
  '@farfetched/runtypes': { runtypeContract: 'runtypesContract', runtypesContract: 'runtypesContract' },
};

// farfetched `Time` strings ('5min', '1h', …) — effector-refetch wants numbers
const TIME_STRING = /['"`]\s*\d+\s*(ms|sec|min|h|d)\s*['"`]/;

/** Prepend a `// TODO(effector-refetch-codemod): …` line to a statement (idempotent per message). */
function annotate(stmt, message) {
  const text = stmt.getText();
  const full = stmt.getFullText();
  if (full.includes(message)) return false;
  stmt.replaceWithText(`${TODO} ${message}\n${text}`);
  return true;
}

/**
 * Migrate one ts-morph SourceFile in place. Returns whether anything changed.
 *
 *  - rewrites imports from `@farfetched/core` to `effector-refetch`, keeping names
 *    with no effector-refetch equivalent on the original import (annotated);
 *  - rewrites `@farfetched/{zod,io-ts,runtypes}` contract imports to the main entry;
 *  - folds `retry` / `cache` / `concurrency` / `timeout` operator calls into the
 *    inline config of `createQuery` / `createMutation` / `createJson*` targets
 *    (last call wins, matching farfetched's runtime order), removing the calls
 *    and now-unused imports;
 *  - annotates known-incompatible shapes (`update(q, {...})`, `keepFresh` with
 *    `automatically`, `createBarrier({ active })`, farfetched `Time` strings,
 *    `retry.otherwise` / `retry.mapParams`) instead of silently migrating them.
 */
export function transformSourceFile(sf) {
  let changed = false;

  // 1) validation adapter packages: @farfetched/zod -> effector-refetch (zodContract), …
  for (const imp of sf.getImportDeclarations()) {
    const renames = CONTRACT_PACKAGES[imp.getModuleSpecifierValue()];
    if (!renames) continue;
    const named = imp.getNamedImports();
    const known = named.every((spec) => renames[spec.getName()]);
    if (!known || named.length === 0) {
      annotate(
        imp,
        `no effector-refetch equivalent for this adapter — see createContract / standardSchemaContract`,
      );
      changed = true;
      continue;
    }
    for (const spec of named) {
      const to = renames[spec.getName()];
      // keep local identifiers stable: `runtypeContract` -> `runtypesContract as runtypeContract`
      if (to !== spec.getName() && !spec.getAliasNode()) spec.setAlias(spec.getName());
      if (to !== spec.getName()) spec.setName(to);
    }
    imp.setModuleSpecifier(TARGET);
    changed = true;
  }

  // 2) @farfetched/core -> effector-refetch, but only for names that exist there.
  //    Unknown names (declareParams, attachOperation, …) stay behind, annotated.
  for (const imp of sf.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== FARFETCHED) continue;
    const named = imp.getNamedImports();
    const unknown = named.filter((spec) => !KNOWN_EXPORTS.has(spec.getName()));
    if (unknown.length === 0 || named.length === 0) {
      imp.setModuleSpecifier(TARGET);
    } else {
      const movable = named.filter((spec) => KNOWN_EXPORTS.has(spec.getName()));
      if (movable.length > 0) {
        sf.insertImportDeclaration(imp.getChildIndex(), {
          moduleSpecifier: TARGET,
          namedImports: movable.map((spec) => spec.getStructure()),
        });
        for (const spec of movable) spec.remove();
      }
      annotate(
        imp,
        `${unknown.map((s) => s.getName()).join(', ')} — no effector-refetch equivalent, migrate by hand`,
      );
    }
    changed = true;
  }

  // 3) map `const q = createQuery({ … })` (and mutation / json factories) to the config literal
  const configs = new Map();
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = vd.getInitializer();
    if (!init || init.getKind() !== SyntaxKind.CallExpression) continue;
    if (!FACTORIES.has(init.getExpression().getText())) continue;
    const arg = init.getArguments()[0];
    if (arg && arg.getKind() === SyntaxKind.ObjectLiteralExpression) configs.set(vd.getName(), arg);
  }

  // 4) fold operator expression-statements into the matching config (last call wins)
  const setOption = (cfg, name, initializer) => {
    const existing = cfg.getProperty(name);
    if (existing)
      existing.setInitializer?.(initializer) ?? existing.replaceWithText(`${name}: ${initializer}`);
    else cfg.addPropertyAssignment({ name, initializer });
  };

  // configs stay live while folding; Time-string warnings are applied afterwards
  // (annotate() rewrites the statement text, which would invalidate the literal)
  const timeWarnings = new Set();

  for (const stmt of sf.getStatements()) {
    if (stmt.getKind() !== SyntaxKind.ExpressionStatement) continue;
    const call = stmt.getExpression();
    if (call.getKind() !== SyntaxKind.CallExpression) continue;
    const name = call.getExpression().getText();
    if (!FOLDABLE.has(name)) continue;

    const args = call.getArguments();
    const cfg = configs.get(args[0]?.getText());
    if (!cfg) continue; // dynamic target — leave the operator call untouched

    const opt = args[1];
    const optIsObject = opt && opt.getKind() === SyntaxKind.ObjectLiteralExpression;

    if (name === 'concurrency') {
      if (!optIsObject) continue; // unexpected shape — leave it
      const props = opt.getProperties().map((p) => p.getName?.());
      const extras = props.filter((p) => p !== 'strategy' && p !== 'key');
      if (extras.length > 0) {
        // e.g. farfetched's `abortAll` — wire it by hand (sample -> q.cancel)
        if (annotate(stmt, `'${extras.join("', '")}' has no inline equivalent — wire it by hand`))
          changed = true;
        continue;
      }
      const strategy = opt.getProperty('strategy')?.getInitializer()?.getText();
      if (!strategy) continue;
      // `{ strategy }` alone -> bare strategy value; `{ strategy, key }` -> the object as-is
      setOption(cfg, 'concurrency', props.includes('key') ? opt.getText() : strategy);
    } else if (name === 'timeout') {
      // farfetched: timeout(q, { after: X }) — inline wants the plain duration
      const after = optIsObject ? opt.getProperty('after')?.getInitializer()?.getText() : opt?.getText();
      if (!after) continue;
      setOption(cfg, 'timeout', after);
    } else {
      if (name === 'retry' && optIsObject) {
        const bad = ['otherwise', 'mapParams'].filter((p) => opt.getProperty(p));
        if (bad.length > 0) {
          if (
            annotate(stmt, `retry '${bad.join("', '")}' has no equivalent — handle via query.finished.fail`)
          )
            changed = true;
          continue;
        }
      }
      setOption(cfg, name, opt ? opt.getText() : 'true');
    }
    if (TIME_STRING.test(opt?.getText() ?? '')) timeWarnings.add(cfg);
    stmt.remove();
    changed = true;
  }
  for (const cfg of timeWarnings) {
    const holder = cfg.getFirstAncestorByKind(SyntaxKind.VariableStatement);
    if (holder && annotate(holder, `farfetched Time strings ('5min') must become numbers (ms)`))
      changed = true;
  }

  // 5) annotate calls whose farfetched shape differs from effector-refetch's
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.wasForgotten()) continue;
    const callee = call.getExpression().getText();
    const args = call.getArguments();
    const stmt =
      call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement) ??
      call.getFirstAncestorByKind(SyntaxKind.VariableStatement);
    if (!stmt) continue;

    if (callee === 'update' && args.length === 2) {
      if (annotate(stmt, `effector-refetch update() takes { query, on, fn } — rewrite this call`))
        changed = true;
    } else if (callee === 'keepFresh' && args[1]?.getKind() === SyntaxKind.ObjectLiteralExpression) {
      if (args[1].getProperty('automatically')) {
        if (annotate(stmt, `'automatically' has no equivalent — pass { source } or { triggers } instead`))
          changed = true;
      }
    } else if (callee === 'createBarrier' && args[0]?.getKind() === SyntaxKind.ObjectLiteralExpression) {
      if (args[0].getProperty('active')) {
        if (annotate(stmt, `createBarrier({ active }) has no equivalent — express the gate via { perform }`))
          changed = true;
      }
    } else if (callee === 'applyBarrier' && args[1]?.getKind() === SyntaxKind.ObjectLiteralExpression) {
      // farfetched: applyBarrier(q, { barrier }) -> positional applyBarrier(q, barrier)
      const props = args[1].getProperties();
      const barrier = args[1].getProperty('barrier');
      if (barrier && props.length === 1) {
        const inner = barrier.getInitializer?.()?.getText() ?? barrier.getName();
        args[1].replaceWithText(inner);
        changed = true;
      } else if (barrier) {
        if (annotate(stmt, `applyBarrier takes (query, barrier) — extra options need hand-migration`))
          changed = true;
      }
    }
  }

  // 6) drop operator names from the import if they are no longer referenced
  for (const imp of sf.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== TARGET) continue;
    for (const spec of imp.getNamedImports()) {
      const local = spec.getName();
      if (!FOLDABLE.has(local)) continue;
      // count real reference positions — excluding the import specifier itself and
      // object-literal property *names* (the folded `retry:`/`cache:`/… keys,
      // which are identifiers with the same text but a different symbol)
      const uses = sf.getDescendantsOfKind(SyntaxKind.Identifier).filter((id) => {
        if (id.getText() !== local) return false;
        const p = id.getParent();
        if (Node.isImportSpecifier(p)) return false;
        if (Node.isPropertyAssignment(p) && p.getNameNode() === id) return false;
        if (Node.isShorthandPropertyAssignment(p)) return false;
        return true;
      }).length;
      if (uses === 0) {
        spec.remove();
        changed = true;
      }
    }
    if (imp.getNamedImports().length === 0 && !imp.getDefaultImport() && !imp.getNamespaceImport()) {
      imp.remove();
      changed = true;
    }
  }

  return changed;
}

/** Transform a code string and return the result (used by tests). */
export function migrateCode(code, fileName = 'input.tsx') {
  const project = new Project({
    useInMemoryFileSystem: true,
    manipulationSettings: { quoteKind: QuoteKind.Single },
  });
  const sf = project.createSourceFile(fileName, code, { overwrite: true });
  transformSourceFile(sf);
  return sf.getFullText();
}
