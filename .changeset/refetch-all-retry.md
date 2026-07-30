---
'effector-refetch': minor
---

`refetchAll` now retries the pages of the window reload. It runs its own sequential loop
outside the page query, so the graph retry never reached it: a 401 mid-window locked the
barrier and refreshed the token, but nothing replayed the page and the whole reload failed
with an already-renewed token. The loop now runs the attempts itself, using the same `retry`
config the page fetches use (times / delay / filter) and waiting on the `barrier` before every
attempt, so the replay picks up the fresh token. `retry.times` is read through the effect's
source, so a `Store<number>` stays fork-correct.

This supersedes the "`refetchAll` … is not retried" note from the previous release.
