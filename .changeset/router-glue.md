---
'effector-refetch': minor
---

`attachToRoute` now works with @effector/router and re-starts on param changes.

- The route shape is generalized: any object with `opened` / `updated` / `closed`
  fits — both atomic-router's `RouteInstance` and @effector/router's `Route`
  satisfy it structurally, payload extras (`query`, `replace`) ride into
  `mapParams` untouched.
- New: `restartOnUpdate` (default `true`) — when the open route receives new
  params (`/users/1` -> `/users/2`), the query re-starts. Previously param
  changes were silently ignored; set `restartOnUpdate: false` for the old
  behavior.
- @effector/router's "opened fires on every open() call" semantics are handled:
  only a closed -> open transition starts via `opened`, param changes go via
  `updated` — no double requests.
