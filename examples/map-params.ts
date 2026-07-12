/**
 * Demo: inject static / store-held params into every request — the
 * `attach({ source, mapParams })` idiom, without losing real cancellation.
 *
 * Two equivalent levels:
 *   - a plain effector `attach` over a `createRequestFx` effect — the AbortSignal
 *     travels through a synchronous side channel, so cancellation survives;
 *   - `createQuery({ source, mapParams })` — the inline sugar, which additionally
 *     keys the cache by the MAPPED params (a source change — another user logs
 *     in — can never serve a stale entry of the previous one).
 *
 * Run with: npx tsx examples/map-params.ts
 */
import { allSettled, attach, createStore, fork } from 'effector';
import { createQuery, createRequestFx } from '../src';

interface Post {
  id: number;
  title: string;
}

// app-wide state you do NOT want to thread through every `start(...)` call
const $userId = createStore('user-123');

// the real request effect: abort-aware, typed, callable directly
const getPostsFx = createRequestFx<{ search: string; userId: string; limit: number }, Post[]>(
  async ({ search, userId, limit }, { signal }) => {
    const query = new URLSearchParams({ q: search, userId, limit: String(limit) });
    const res = await fetch(`https://api.example.com/posts?${query}`, { signal });
    return res.json();
  },
);

// --- level 1: a reusable mapped effect — just effector's attach -------------
export const getPostsForCurrentUserFx = attach({
  source: { userId: $userId },
  mapParams: (search: string, { userId }) => ({ search, userId, limit: 20 }),
  effect: getPostsFx, // stays abort-aware: TAKE_LATEST / cancel really abort fetch
});

// --- level 2: the sugar — the same, inline on the query ---------------------
export const postsQuery = createQuery({
  effect: getPostsFx,
  source: { userId: $userId },
  mapParams: (search: string, { userId }) => ({ search, userId, limit: 20 }),
  cache: true, // keyed by { search, userId, limit } — the mapped params
  retry: 2,
  concurrency: 'TAKE_LATEST',
});

// the public surface stays minimal: callers pass only what varies
async function main() {
  const scope = fork();
  await allSettled(postsQuery.start, { scope, params: 'effector' });
  console.log(scope.getState(postsQuery.$params)); // 'effector' — public params
  console.log(scope.getState(postsQuery.$data)); // Post[] for user-123
}

main();
