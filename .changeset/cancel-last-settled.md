---
'effector-refetch': patch
---

`cancel` now restores the last SETTLED status instead of guessing from
`data != null`: cancelling a refetch that followed a failure (with stale data
still on screen) stays `'fail'` — it used to flip to `'done'` and hide the
failure. First-run cancels still settle to `'initial'`, post-success cancels
to `'done'`.
