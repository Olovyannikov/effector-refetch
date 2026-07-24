---
'effector-refetch': minor
---

`QUEUE` concurrency strategy — serialized runs.

`concurrency: 'QUEUE'` executes runs strictly one after another: the next
starts only when the previous settles, failures don't break the chain, and
settles arrive in start order. Combined with a lane `key`, serialization is
per lane. `cancel`/`reset` flush the waiting runs — they abort with reason
`'cancelled'` (so `startAsync` rejects instead of hanging). The classic use
case: mutations whose writes must not interleave —
`createMutation({ effect: saveFx, concurrency: 'QUEUE' })`.
