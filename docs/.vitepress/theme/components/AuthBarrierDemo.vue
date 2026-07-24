<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { createEffect, sample } from 'effector';
import { useUnit } from 'effector-vue/composition';
// import straight from source so the demo needs no build step
import { createBarrier, createQuery, createRequestFx } from '../../../../src';

const tab = ref<'demo' | 'code'>('demo');

interface Payload {
  id: number;
  secret: string;
}
type ApiError = Error & { status: number };

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      rej(new DOMException('aborted', 'AbortError'));
    });
  });

// ---- simulated protected API ----
// the "server" checks this token; while it's expired every request 401s
let token: 'valid' | 'expired' = 'valid';

const fetchDataFx = createRequestFx(async (id: number, { signal }) => {
  await sleep(500, signal);
  if (token !== 'valid') {
    throw Object.assign(new Error('Unauthorized'), { status: 401 }) as ApiError;
  }
  return { id, secret: `data-${id}` } satisfies Payload;
});

// the refresh: runs ONCE per lock (the barrier re-opens when it settles)
const refreshTokenFx = createEffect(async () => {
  await sleep(1200);
  token = 'valid';
});

const authBarrier = createBarrier({ perform: refreshTokenFx });

const dataQuery = createQuery({
  effect: fetchDataFx,
  barrier: authBarrier, // every run — including retries — waits while it's locked
  retry: 1, // the 401 attempt is replayed after the refresh
  concurrency: 'TAKE_EVERY',
});

// canonical wiring from the auth-barrier recipe: a 401 on the raw effect locks
// the barrier (finished.fail would fire only AFTER retries are exhausted)
sample({
  clock: fetchDataFx.failData,
  filter: (error) => (error as ApiError).status === 401,
  target: authBarrier.lock,
});

// ---- UI state ----
const { locked, status, data, pending } = useUnit({
  locked: authBarrier.$locked,
  status: dataQuery.$status,
  data: dataQuery.$data,
  pending: dataQuery.$pending,
});

const tokenView = ref<'valid' | 'expired'>(token);

type Kind = 'ok' | 'fail' | 'barrier' | 'info';
const log = ref<Array<{ text: string; kind: Kind }>>([]);
const push = (text: string, kind: Kind) => {
  log.value = [...log.value.slice(-11), { text, kind }];
};

const unsubs: Array<() => void> = [];
unsubs.push(
  // fires only when a run actually reaches the "network" — queued retries show up here again
  fetchDataFx.watch((id) => push(`→ GET /secret #${id}`, 'info')),
  fetchDataFx.done.watch(({ result }) => push(`✓ 200 ok: ${result.secret}`, 'ok')),
  fetchDataFx.failData.watch((error) => {
    if ((error as ApiError).status === 401) push('✗ 401 Unauthorized → barrier.lock', 'fail');
  }),
  authBarrier.$locked.updates.watch((isLocked) =>
    push(
      isLocked
        ? 'barrier LOCKED — refreshTokenFx runs once, retries queue up'
        : 'barrier UNLOCKED — queued requests resume',
      'barrier',
    ),
  ),
  refreshTokenFx.done.watch(() => {
    tokenView.value = 'valid';
    push('✓ token refreshed', 'ok');
  }),
  dataQuery.finished.fail.watch(() => push('✗ query failed (retry exhausted)', 'fail')),
);
onUnmounted(() => unsubs.forEach((u) => u()));

let seq = 1;
const fetchOne = () => dataQuery.start(seq++);
const fetchThree = () => {
  dataQuery.start(seq++);
  dataQuery.start(seq++);
  dataQuery.start(seq++);
};
const expire = () => {
  token = 'expired';
  tokenView.value = 'expired';
  push('token expired — next requests will 401', 'info');
};
</script>

<template>
  <div class="ab">
    <div class="ab__tabs">
      <button class="ab__tab" :class="{ active: tab === 'demo' }" @click="tab = 'demo'">Demo</button>
      <button class="ab__tab" :class="{ active: tab === 'code' }" @click="tab = 'code'">Code</button>
    </div>

    <div v-show="tab === 'demo'" class="ab__panel">
      <div class="ab__bar">
        <button class="ab__btn ab__btn--fetch" @click="fetchOne()">Fetch</button>
        <button class="ab__btn ab__btn--fetch" @click="fetchThree()">Fetch ×3</button>
        <button class="ab__btn ab__btn--expire" @click="expire()">Expire token</button>
      </div>

      <div class="ab__badges">
        <span class="ab__badge" :class="tokenView === 'valid' ? 'is-ok' : 'is-bad'">
          token: {{ tokenView }}
        </span>
        <span class="ab__badge" :class="locked ? 'is-bad' : 'is-ok'">
          barrier: {{ locked ? 'locked' : 'open' }}
        </span>
        <span class="ab__badge">status: {{ status }}{{ pending ? ' ⟳' : '' }}</span>
        <span class="ab__badge">data: {{ data ? data.secret : '—' }}</span>
      </div>

      <p class="ab__hint">
        Press <em>Expire token</em>, then <em>Fetch ×3</em>: the first <code>401</code> locks the barrier,
        <code>refreshTokenFx</code> runs <strong>once</strong>, and the retried requests wait at the barrier —
        when it unlocks, all of them resume and succeed.
      </p>

      <div class="ab__log">
        <span v-if="log.length === 0" class="ab__logempty">no activity yet — press “Fetch”</span>
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

    <div v-show="tab === 'code'" class="ab__code">
      <slot name="code" />
    </div>
  </div>
</template>

<style scoped>
.ab {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  margin: 16px 0;
}
.ab__tabs {
  display: flex;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.ab__tab {
  padding: 8px 18px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 13px;
}
.ab__tab.active {
  color: var(--vp-c-brand-1);
  box-shadow: inset 0 -2px 0 var(--vp-c-brand-1);
}
.ab__panel {
  padding: 14px;
}
.ab__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.ab__btn {
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 13px;
}
.ab__btn--fetch {
  border-color: var(--vp-c-brand-1);
}
.ab__btn--expire {
  border-color: #e03131;
}
.ab__badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.ab__badge {
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
.ab__badge.is-ok {
  border-color: #2f9e44;
  color: #2f9e44;
}
.ab__badge.is-bad {
  border-color: #e03131;
  color: #e03131;
}
.ab__hint {
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin: 12px 0;
}
.ab__log {
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
.ab__logempty {
  color: var(--vp-c-text-3);
}
.ab__log .is-fail {
  color: #e03131;
}
.ab__log .is-ok {
  color: #2f9e44;
}
.ab__log .is-barrier {
  color: #f08c00;
}
.ab__code :deep(div[class*='language-']) {
  margin: 0;
  border-radius: 0;
}
</style>
