<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { createEffect } from 'effector';
import { useUnit } from 'effector-vue/composition';
// import straight from source so the demo needs no build step
import { createBarrier, createInfiniteQuery } from '../../../../src';

const tab = ref<'demo' | 'code'>('demo');

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- simulated protected, paginated API ----
let token: 'valid' | 'expired' = 'valid';

const refreshTokenFx = createEffect(async () => {
  await sleep(1200);
  token = 'valid';
});

// locking runs the refresh once; the barrier re-opens when it settles
const authBarrier = createBarrier({ perform: refreshTokenFx });

const fetchPageFx = createEffect(async ({ pageParam }: { params: void; pageParam: number }) => {
  await sleep(450);
  if (token !== 'valid') {
    // lock where the 401 is observed — an HTTP layer would do exactly this
    authBarrier.lock();
    throw new HttpError(401);
  }
  return {
    items: Array.from({ length: 3 }, (_, i) => ({
      id: pageParam * 3 + i,
      title: `post #${pageParam * 3 + i}`,
    })),
    next: pageParam < 4 ? pageParam + 1 : null,
  } satisfies PostsPage;
});

const feed = createInfiniteQuery<void, number, PostsPage, HttpError>({
  effect: fetchPageFx,
  initialPageParam: 0,
  getNextPageParam: ({ lastPage, lastPageParam }) => (lastPage.next ? lastPageParam + 1 : null),
  barrier: authBarrier, // page fetches wait while the token is being refreshed
  retry: { times: 1, filter: ({ error }) => error.status === 401 }, // …and the 401 page is replayed
});

// ---- UI state ----
const {
  pages,
  hasNext,
  status,
  pending,
  fetchingNext,
  refetching,
  locked,
  start,
  fetchNext,
  refetchAll,
  reset,
} = useUnit({
  pages: feed.$pages,
  hasNext: feed.$hasNextPage,
  status: feed.$status,
  pending: feed.$pending,
  fetchingNext: feed.$isFetchingNextPage,
  refetching: feed.$isRefetching,
  locked: authBarrier.$locked,
  start: feed.start,
  fetchNext: feed.fetchNext,
  refetchAll: feed.refetchAll,
  reset: feed.reset,
});

const tokenView = ref<'valid' | 'expired'>(token);

type Kind = 'ok' | 'fail' | 'barrier' | 'info';
const log = ref<Array<{ text: string; kind: Kind }>>([]);
const push = (text: string, kind: Kind) => {
  log.value = [...log.value.slice(-11), { text, kind }];
};

const unsubs: Array<() => void> = [];
unsubs.push(
  // fires per attempt that actually reaches the "network" — the replayed page shows up twice
  fetchPageFx.watch(({ pageParam }) => push(`→ GET /posts?page=${pageParam}`, 'info')),
  fetchPageFx.done.watch(({ params }) => push(`✓ 200 page ${params.pageParam}`, 'ok')),
  fetchPageFx.failData.watch((error) => {
    if ((error as HttpError).status === 401) push('✗ 401 on the page → barrier.lock', 'fail');
  }),
  authBarrier.$locked.updates.watch((isLocked) =>
    push(
      isLocked
        ? 'barrier LOCKED — refresh runs once, the page retry queues up'
        : 'barrier UNLOCKED — the queued page resumes',
      'barrier',
    ),
  ),
  refreshTokenFx.done.watch(() => {
    tokenView.value = 'valid';
    push('✓ token refreshed', 'ok');
  }),
  feed.finished.fail.watch(() => push('✗ feed failed (retry exhausted / refetchAll)', 'fail')),
);
onUnmounted(() => unsubs.forEach((u) => u()));

const expire = () => {
  token = 'expired';
  tokenView.value = 'expired';
  push('token expired — the next page will 401', 'info');
};
</script>

<template>
  <div class="iab">
    <div class="iab__tabs">
      <button class="iab__tab" :class="{ active: tab === 'demo' }" @click="tab = 'demo'">Demo</button>
      <button class="iab__tab" :class="{ active: tab === 'code' }" @click="tab = 'code'">Code</button>
    </div>

    <div v-show="tab === 'demo'" class="iab__panel">
      <div class="iab__bar">
        <button v-if="pages.length === 0" class="iab__btn iab__btn--go" :disabled="pending" @click="start()">
          Load feed
        </button>
        <template v-else>
          <button class="iab__btn iab__btn--go" :disabled="!hasNext || pending" @click="fetchNext()">
            {{ fetchingNext ? 'Loading…' : hasNext ? 'Load next page' : 'All loaded' }}
          </button>
          <button class="iab__btn" :disabled="pending" @click="refetchAll()">
            {{ refetching ? 'Reloading…' : 'Refetch all' }}
          </button>
          <button class="iab__btn" @click="reset()">Reset</button>
        </template>
        <button class="iab__btn iab__btn--expire" @click="expire()">Expire token</button>
      </div>

      <div class="iab__badges">
        <span class="iab__badge" :class="tokenView === 'valid' ? 'is-ok' : 'is-bad'">
          token: {{ tokenView }}
        </span>
        <span class="iab__badge" :class="locked ? 'is-bad' : 'is-ok'">
          barrier: {{ locked ? 'locked' : 'open' }}
        </span>
        <span class="iab__badge">status: {{ status }}{{ pending ? ' ⟳' : '' }}</span>
        <span class="iab__badge">pages: {{ pages.length }}</span>
      </div>

      <p class="iab__hint">
        Load a page or two, press <em>Expire token</em>, then <em>Load next page</em>: the
        <code>401</code> locks the barrier, the refresh runs <strong>once</strong>, and the page
        <strong>retry waits at the barrier</strong> — when it opens, the page loads and appends as if nothing
        happened. <em>Refetch all</em> with an expired token shows the other half: the window reload waits on
        the barrier too, but it is not retried, so the old pages stay on screen and the error surfaces in
        <code>$status</code>.
      </p>

      <div v-if="pages.length" class="iab__feed">
        <div v-for="post in pages.flatMap((p) => p.items)" :key="post.id" class="iab__post">
          {{ post.title }}
        </div>
      </div>

      <div class="iab__log">
        <span v-if="log.length === 0" class="iab__logempty">no activity yet — press “Load feed”</span>
        <div
          v-for="(e, i) in log"
          :key="i"
          :class="{
            'is-fail': e.kind === 'fail',
            'is-barrier': e.kind === 'barrier',
            'is-ok': e.kind === 'ok',
          }"
        >
          {{ e.text }}
        </div>
      </div>
    </div>

    <div v-show="tab === 'code'" class="iab__code">
      <slot name="code" />
    </div>
  </div>
</template>

<style scoped>
.iab {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  margin: 16px 0;
}
.iab__tabs {
  display: flex;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.iab__tab {
  padding: 8px 18px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 13px;
}
.iab__tab.active {
  color: var(--vp-c-brand-1);
  box-shadow: inset 0 -2px 0 var(--vp-c-brand-1);
}
.iab__panel {
  padding: 14px;
}
.iab__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.iab__btn {
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 13px;
}
.iab__btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.iab__btn--go {
  border-color: var(--vp-c-brand-1);
}
.iab__btn--expire {
  border-color: #e03131;
  margin-left: auto;
}
.iab__badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.iab__badge {
  font:
    12px/1.6 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
}
.iab__badge.is-ok {
  border-color: #2f9e44;
  color: #2f9e44;
}
.iab__badge.is-bad {
  border-color: #e03131;
  color: #e03131;
}
.iab__hint {
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin: 12px 0;
}
.iab__feed {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.iab__post {
  font:
    12px/1.6 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.iab__log {
  font:
    12px/1.5 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  background: var(--vp-c-bg-alt);
  border-radius: 8px;
  padding: 8px 10px;
  min-height: 40px;
  max-height: 170px;
  overflow: auto;
}
.iab__logempty {
  color: var(--vp-c-text-3);
}
.iab__log .is-fail {
  color: #e03131;
}
.iab__log .is-ok {
  color: #2f9e44;
}
.iab__log .is-barrier {
  color: #f08c00;
}
.iab__code :deep(div[class*='language-']) {
  margin: 0;
  border-radius: 0;
}
</style>
