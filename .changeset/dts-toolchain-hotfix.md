---
'effector-refetch': patch
---

Hotfix for 0.19.1, which shipped with **empty type declarations** (every `dist/*.d.ts` was a
bare `export { }` — `Module '"effector-refetch"' has no exported member 'createQuery'`): the
d.ts rollup silently produces empty stubs on TypeScript 6, which had just become the build
toolchain. The declarations pipeline is pinned back to TypeScript 5.9 (the fast native TS 7
typecheck is unaffected), and the build now fails loudly if the rolled-up declarations are
empty or missing key exports, so this class of release can't ship again.
