---
'effector-refetch': minor
---

Two cache options from the reatom comparison:

- `cache: { fillOnAbort: true }` — a superseded in-flight run is allowed to
  finish so its (almost-ready) response still lands in the cache; only its
  connection to `$data`/status is severed. Explicit `cancel`/`reset` aborts
  for real. Validation still gates the write.
- `cache: { swr: { silent: true } }` — a failed background SWR revalidation
  keeps serving the stale entry silently: `$error`/`$status` stay untouched
  ("stale is better than an error banner"), while `finished.fail` still fires
  so observers and `startAsync` learn the truth.
