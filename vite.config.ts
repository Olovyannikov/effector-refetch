import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

/**
 * Library build. Two entry points:
 *   - effector-refetch        -> dist/index.{mjs,cjs}
 *   - effector-refetch/react  -> dist/react.{mjs,cjs}
 * Peer deps are left external so consumers dedupe their own copies.
 */
export default defineConfig({
  build: {
    target: 'es2020',
    sourcemap: true,
    lib: {
      entry: {
        index: 'src/index.ts',
        react: 'src/react.ts',
        vue: 'src/vue.ts',
        solid: 'src/solid.ts',
        devtools: 'src/devtools.tsx',
        'devtools-vue': 'src/devtools-vue.ts',
        'devtools-solid': 'src/devtools-solid.ts',
        tanstack: 'src/tanstack.ts',
        apollo: 'src/apollo.ts',
        openapi: 'src/openapi.ts',
      },
      formats: ['es', 'cjs'],
      fileName: (format, entry) => `${entry}.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      external: [
        'effector',
        'effector-react',
        'effector-vue',
        'effector-vue/composition',
        'effector-solid',
        'react',
        'react-dom',
        'vue',
        'solid-js',
        'solid-js/h',
        'solid-js/web',
        '@hey-api/openapi-ts',
      ],
    },
  },
  // rollupTypes: bundle each entry's .d.ts into one self-contained file (no
  // extensionless relative imports), so node16/nodenext type resolution works.
  plugins: [dts({ include: ['src'], rollupTypes: true })],
});
