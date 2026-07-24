---
'effector-refetch': patch
---

Audit follow-ups (hardening + docs):

- infinite query: `setData` patches rederive the cursors and trim `pageParams`
  (no more pages↔params desync); a failed `refetchAll` now reaches `$error` /
  `$status` (the window stays intact).
- barrier: a shared `perform` effect settling from an unrelated call no longer
  unlocks a barrier that never started it.
- React devtools panel attaches its logger scope-aware (`useProvidedScope`);
  Vue/Solid limitation documented. `refetchOnMount: 'always'` no longer
  double-fires under StrictMode.
- web-storage cache evicts corrupt (unparseable) entries on read; factory group
  invalidation survives a throwing predicate.
- docs: browser triggers' JSDoc corrected (`allSettled`, not `scopeBind`);
  polling-hangs-`allSettled` SSR warning in the auto-refetch recipe; the
  AbortSignal side-channel claim softened to synchronous composition;
  `keepFresh` external-trigger scope note; `attachToRoute` hydration note.
