---
'effector-refetch': minor
---

`createInfiniteQuery`: `prefetch(params)` — warm a feed that is not on screen yet.

`start` was the only way to load a collapsed sidebar or the next tab ahead of time, and a failure there rendered a list the user never opened as broken. `prefetch` loads the first page in the background: on success the window is filled exactly as `start` would fill it (pages, cursors, `$params`, `$status: 'done'`); on failure nothing is touched, so the next real `start` is still a cold first load.

It is a no-op once the feed has pages or while a real run is in flight, a `start` arriving mid-flight wins (the prefetched page is discarded), and a locked barrier holds it. Reported by the new `$isPrefetching`, deliberately outside `$pending` so a background warm-up never reads as loading.
