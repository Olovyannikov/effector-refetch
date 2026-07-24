---
'effector-refetch': patch
---

Retry budgets are now per-run, not per-query. The attempts counter rides in
the run payload (like `runId`), so concurrent runs — lanes, TAKE_EVERY (the
mutation default) — never share or reset each other's retry counts, and
`delay(attempt)` receives each run's own attempt number. The debounce wait and
the retry pause also got separate effects, so a debounce sleep completing no
longer clears another run's retrying flag.
