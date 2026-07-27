---
'effector-refetch': minor
---

SSR store-layer transfer works without the effector babel/SWC plugin: public query stores
(`$data` / `$status` / `$error` / `$params` / `$stale` / `$lastSettled`, infinite queries'
`$infinite` / `$params`, `$queryDefaults`) now carry explicit stable sids (`er/<name>/$data`),
so `serialize(scope)` → `fork({ values })` restores state on the client with no loading flash —
bundler plugins never process a prebuilt `node_modules` dist, so this previously silently
transferred nothing. Internal machinery stores are marked `serialize: 'ignore'` (no more
"store should have sid" console noise). Give queries a stable `name` when server and client
bundles may initialize modules in a different order — sids follow the same namespace as cache
entries.
