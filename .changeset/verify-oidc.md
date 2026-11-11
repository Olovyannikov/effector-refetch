---
'effector-refetch': patch
---

No runtime changes. A release cut to exercise the publish path end-to-end after switching npm authentication to trusted publishing (OIDC), so a broken release pipeline surfaces now rather than at the next real release. Carries the release-automation docs and the clearer `npm whoami` diagnostic in `release.yml`.
