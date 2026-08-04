---
'effector-refetch': minor
---

The OpenAPI plugin can now generate infinite queries. Opt in with `infinite` and every paginated
operation gets a `createInfiniteQuery` twin next to its plain query, with the cursor wired into
the SDK call's query params. Operations are picked by the spec's own pagination flag (hey-api
marks `page` / `offset` / `cursor` / …), overridable via `match` and `pageParam`.

The one thing a spec cannot describe — where the next cursor lives in the response — stays
yours: `getNextPageParam` (and the optional `getPreviousPageParam`) is a `{ module, name }` the
generated file imports, and every option except `match` / `suffix` also takes a function, so one
config can serve several pagination styles. First-page values default by cursor name (`page` →
`1`, `offset` / `start` → `0`, otherwise `null`); a `null` cursor makes the page param nullable
and the first request goes out without the parameter at all.
