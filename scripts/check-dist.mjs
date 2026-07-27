// Sanity gate for the build output: the d.ts rollup (vite-plugin-dts /
// api-extractor) can silently emit empty `export { }` stubs on an unsupported
// TypeScript version — exactly how the broken 0.19.1 shipped. Fail the build
// loudly instead of publishing typeless declarations.
import { readFileSync, statSync } from 'node:fs';

const MUST_EXPORT = {
  'dist/index.d.ts': ['createQuery', 'createMutation', 'createJsonQuery', 'createRequestFx'],
  'dist/react.d.ts': ['useQuery'],
  'dist/vue.d.ts': ['useQuery'],
  'dist/solid.d.ts': ['useQuery'],
  'dist/tanstack.d.ts': ['withTanstackCache'],
  'dist/apollo.d.ts': ['apolloHandler'],
  'dist/openapi.d.ts': ['defineConfig'],
  'dist/devtools.d.ts': ['EffectorQueryDevtools'],
};

let failed = false;
for (const [file, names] of Object.entries(MUST_EXPORT)) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.error(`check-dist: MISSING ${file}`);
    failed = true;
    continue;
  }
  if (statSync(file).size < 100) {
    console.error(`check-dist: ${file} is suspiciously small (${statSync(file).size} B) — empty rollup?`);
    failed = true;
    continue;
  }
  for (const name of names) {
    if (!text.includes(name)) {
      console.error(`check-dist: ${file} does not mention "${name}"`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('check-dist: declaration output is broken — refusing the build.');
  process.exit(1);
}
console.log('check-dist: declarations look sane.');
