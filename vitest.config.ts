import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // react() enables the automatic JSX runtime in .tsx tests;
  // vue() compiles any Vue SFCs / handles effector-vue interop.
  // (No solid plugin: the Solid binding/devtools use solid-js/h — no JSX.)
  plugins: [react(), vue()],
  // Resolve solid-js to its browser/client build so `solid-js/web`'s `render`
  // works in the happy-dom tests (otherwise the server build throws).
  resolve: {
    conditions: ['browser', 'development'],
    // The openapi-plugin test imports GENERATED code whose `import ... from
    // 'effector-refetch'` must resolve to this repo's sources, not dist.
    alias: [
      { find: /^effector-refetch$/, replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    // DOM-needing files opt in per-file via `// @vitest-environment happy-dom`;
    // everything else runs in the default node environment.
    environment: 'node',
    include: ['test/**/*.{test,spec}.{ts,tsx}'],
    // effector-vue's ESM does a default-import of `vue`; inlining lets vite
    // apply interop so it loads under vitest. solid-js is inlined so the
    // browser-condition resolution above applies to it too.
    server: { deps: { inline: ['effector-vue', 'solid-js', 'effector-solid'] } },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      // Barrel re-exports and the codemod (its own package, tested separately).
      exclude: ['src/index.ts'],
      // Floors a few points below current (stmts/lines ~96, fns ~93, branches ~90)
      // — a regression guard with headroom, not a brittle exact-match gate.
      thresholds: {
        lines: 93,
        functions: 90,
        statements: 93,
        branches: 87,
      },
    },
  },
});
