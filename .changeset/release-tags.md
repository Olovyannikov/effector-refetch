---
'effector-refetch': patch
---

Release automation: the publish now tags `v<version>`.

`scripts/release.mjs` publishes with `pnpm publish`, which never created git tags — so no version in this repository's history had one. It now creates and pushes an annotated `v<version>` after a successful publish, and the step is self-healing: a version that is published but untagged gets its tag on the next run.

A failed tag push warns instead of failing the job — the package is on npm either way, and a red release job over a missing tag reads as "the release broke".
