#!/usr/bin/env node
import { Project, QuoteKind } from 'ts-morph';
import { transformSourceFile } from './transform.mjs';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry') || argv.includes('-d');
const patterns = argv.filter((a) => !a.startsWith('-'));

if (patterns.length === 0) {
  console.error('Migrate farfetched usage to effector-refetch.\n');
  console.error('Usage: effector-refetch-codemod <glob…> [--dry]');
  console.error('  e.g. effector-refetch-codemod "src/**/*.{ts,tsx}"');
  process.exit(1);
}

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  manipulationSettings: { quoteKind: QuoteKind.Single },
});
project.addSourceFilesAtPaths(patterns);

const files = project.getSourceFiles();
if (files.length === 0) {
  console.error(`No files matched: ${patterns.join(', ')}`);
  process.exit(1);
}

let changed = 0;
for (const sf of files) {
  if (transformSourceFile(sf)) {
    changed++;
    if (dry) console.log(`would update  ${sf.getFilePath()}`);
    else sf.saveSync();
  }
}

console.log(`\n${dry ? 'Would update' : 'Updated'} ${changed} of ${files.length} file(s).`);
if (dry) console.log('(dry run — no files written)');
