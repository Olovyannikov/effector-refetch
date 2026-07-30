/**
 * Infinite query + auth barrier: a 401 on a page pauses the feed, refreshes the
 * token once, and replays the failed page.
 *
 * The pieces:
 *   - `barrier` gates every page fetch (start / fetchNext / fetchPrevious);
 *   - `retry` is what actually replays the page that got the 401 — the barrier
 *     only makes the replay WAIT for the refresh;
 *   - the lock is fired where the 401 is observed (the HTTP layer), scope-bound
 *     because that code runs outside effector's call stack.
 *
 * Run: npx tsx examples/infinite-auth-barrier.ts
 */
import { allSettled, createEffect, fork, scopeBind } from 'effector';
import { createBarrier, createInfiniteQuery } from '../src';

interface Post {
  id: number;
  title: string;
}
interface PostsPage {
  items: Post[];
  next: number | null;
}
class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

// ---- fake protected API (no network, so the example is deterministic) ----
let token: 'valid' | 'expired' = 'expired'; // start expired: the very first page 401s
let requests = 0;

async function getPosts(page: number): Promise<PostsPage> {
  requests += 1;
  if (token !== 'valid') throw new HttpError(401);
  return {
    items: [{ id: page, title: `post on page ${page}` }],
    next: page < 3 ? page + 1 : null,
  };
}

const refreshTokenFx = createEffect(async () => {
  console.log('  … refreshing the token');
  token = 'valid';
});

// locking runs the refresh; the barrier re-opens when it settles (success OR failure)
const authBarrier = createBarrier({ perform: refreshTokenFx });

const fetchPostsPageFx = createEffect(
  async ({ pageParam }: { params: void; pageParam: number }): Promise<PostsPage> => {
    try {
      return await getPosts(pageParam);
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        // `scopeBind`: this handler is outside effector's call stack once it awaits,
        // and an unbound call would lock the scope-less app instead of this fork
        scopeBind(authBarrier.lock, { safe: true })();
      }
      throw error;
    }
  },
);

const feed = createInfiniteQuery<void, number, PostsPage, HttpError>({
  effect: fetchPostsPageFx,
  initialPageParam: 1,
  getNextPageParam: ({ lastPage, lastPageParam }) => (lastPage.next ? lastPageParam + 1 : null),
  barrier: authBarrier,
  // without this the 401 page is simply lost — the barrier alone never re-runs anything
  retry: { times: 1, filter: ({ error }) => error.status === 401 },
});

async function main() {
  const scope = fork();
  const show = (label: string) =>
    console.log(
      `${label}: pages=${scope.getState(feed.$pages).length}`,
      `status=${scope.getState(feed.$status)}`,
      `hasNext=${scope.getState(feed.$hasNextPage)}`,
      `requests=${requests}`,
    );

  // page 1 fails with 401 -> barrier locks -> refresh -> the retry waits, then succeeds
  await allSettled(feed.start, { scope, params: undefined });
  show('after start');

  await allSettled(feed.fetchNext, { scope });
  await allSettled(feed.fetchNext, { scope });
  show('after two fetchNext');

  // the window reload waits on the barrier before EVERY page, so a refresh that
  // starts mid-window holds the remaining pages (it is not retried, though)
  token = 'expired';
  await allSettled(feed.refetchAll, { scope });
  show('after refetchAll with an expired token');
  console.log('  error:', String(scope.getState(feed.$error)));

  // barriers are per-scope: locking one fork leaves the others running (SSR requests
  // don't pause each other). Shown on a manual barrier — `perform` would re-open this
  // one before we could look at it.
  const manual = createBarrier();
  const a = fork();
  const b = fork();
  await allSettled(manual.lock, { scope: a });
  console.log(
    'manual barrier — scope a:',
    a.getState(manual.$locked),
    '| scope b:',
    b.getState(manual.$locked),
  );
}

main().catch((e) => console.error('demo failed:', e));
