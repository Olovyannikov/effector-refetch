<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { useUnit } from 'effector-vue/composition';
// import straight from source so the demo needs no build step
import { createQuery, createRequestFx, RequestError } from '../../../../src';

const tab = ref<'demo' | 'code'>('demo');

// countries.trevorblades.com — a real public GraphQL API, CORS-open, no key
const ENDPOINT = 'https://countries.trevorblades.com/';

interface Country {
  name: string;
  capital: string | null;
  currency: string | null;
  emoji: string;
  languages: Array<{ name: string }>;
}

interface GraphqlResponse<Data> {
  data?: Data;
  errors?: Array<{ message: string }>;
}

const COUNTRY_DOCUMENT = `
  query Country($code: ID!) {
    country(code: $code) {
      name
      capital
      currency
      emoji
      languages { name }
    }
  }
`;

// the recipe's idiom: one document -> an Abortable effect that takes its variables
const getCountryFx = createRequestFx<{ code: string }, { country: Country | null }>(
  async (variables, { signal }) => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: COUNTRY_DOCUMENT, variables }),
      signal,
    });
    const json = (await res.json()) as GraphqlResponse<{ country: Country | null }>;
    // GraphQL-level errors become a RequestError — retry/$error/inspect treat them like HTTP ones
    if (json.errors?.length) {
      throw new RequestError(json.errors[0].message, { status: res.status, data: json.errors });
    }
    return json.data as { country: Country | null };
  },
);

const countryQuery = createQuery({
  effect: getCountryFx,
  cache: true, // repeated picks resolve from cache — no network
  concurrency: 'TAKE_LATEST', // rapid clicking? only the last pick wins
  mapData: ({ result }) => result.country,
});

const { country, error, pending, initialLoading, params, start } = useUnit({
  country: countryQuery.$data,
  error: countryQuery.$error,
  pending: countryQuery.$pending,
  initialLoading: countryQuery.$isInitialLoading,
  params: countryQuery.$params,
  start: countryQuery.start,
});

const CODES = ['BR', 'DE', 'JP', 'FR', 'UA', 'US'];

// a tiny fetched-vs-cache log, fed by the query's inspect events
const log = ref<string[]>([]);
const pushLog = (line: string) => {
  log.value = [...log.value.slice(-3), line];
};

const subs = [
  countryQuery.__.inspect.cacheMiss.watch(({ params }) =>
    pushLog(`${params.code} — cache miss, fetching over the network…`),
  ),
  countryQuery.__.inspect.cacheHit.watch(({ params }) =>
    pushLog(`${params.code} — cache hit, instant, no network`),
  ),
  countryQuery.finished.done.watch(({ params, result }) => {
    if (result) pushLog(`${params.code} — done: ${result.name}`);
  }),
];
onUnmounted(() => subs.forEach((s) => s.unsubscribe()));
</script>

<template>
  <div class="gcd">
    <div class="gcd__tabs">
      <button class="gcd__tab" :class="{ active: tab === 'demo' }" @click="tab = 'demo'">Demo</button>
      <button class="gcd__tab" :class="{ active: tab === 'code' }" @click="tab = 'code'">Code</button>
    </div>

    <div v-show="tab === 'demo'" class="gcd__panel">
      <div class="gcd__bar">
        <button
          v-for="code in CODES"
          :key="code"
          class="gcd__btn"
          :class="{ 'gcd__btn--active': params?.code === code }"
          @click="start({ code })"
        >
          {{ code }}
        </button>
        <span class="gcd__status">
          {{ pending ? 'loading…' : error ? 'error' : country ? 'done' : 'pick a country' }}
        </span>
      </div>

      <div v-if="initialLoading" class="gcd__skeleton">▒▒▒ asking GraphQL for the country ▒▒▒</div>

      <div v-else-if="error" class="gcd__error">
        <strong>Request failed:</strong> {{ (error as Error).message ?? String(error) }}
      </div>

      <div v-else-if="country" class="gcd__card" :class="{ 'gcd__card--dim': pending }">
        <span class="gcd__flag">{{ country.emoji }}</span>
        <div class="gcd__facts">
          <strong>{{ country.name }}</strong>
          <span>Capital: {{ country.capital ?? '—' }}</span>
          <span>Currency: {{ country.currency ?? '—' }}</span>
          <span>Languages: {{ country.languages.map((l) => l.name).join(', ') || '—' }}</span>
        </div>
      </div>

      <p v-else class="gcd__hint">
        Pick a country — one GraphQL document wrapped in <code>createRequestFx</code>, GraphQL
        <code>errors</code> thrown as a <code>RequestError</code>, <code>mapData</code> unwrapping
        <code>data.country</code>.
      </p>

      <div v-if="log.length" class="gcd__log">
        <div v-for="(line, i) in log" :key="i">{{ line }}</div>
      </div>

      <p class="gcd__hint">
        <code>cache: true</code> — repeated picks are instant: click an already-visited country and the log
        shows a cache hit with no network request.
      </p>
    </div>

    <div v-show="tab === 'code'" class="gcd__code">
      <slot name="code" />
    </div>
  </div>
</template>

<style scoped>
.gcd {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  margin: 16px 0;
}
.gcd__tabs {
  display: flex;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.gcd__tab {
  padding: 8px 18px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 13px;
}
.gcd__tab.active {
  color: var(--vp-c-brand-1);
  box-shadow: inset 0 -2px 0 var(--vp-c-brand-1);
}
.gcd__panel {
  padding: 14px;
}
.gcd__bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.gcd__btn {
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 13px;
  font-family: ui-monospace, Menlo, monospace;
}
.gcd__btn--active {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.gcd__status {
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-left: auto;
}
.gcd__skeleton {
  font:
    13px/1.5 ui-monospace,
    Menlo,
    monospace;
  color: var(--vp-c-text-3);
  padding: 20px 0;
  text-align: center;
}
.gcd__error {
  font-size: 13px;
  color: var(--vp-c-danger-1);
  border: 1px solid var(--vp-c-danger-1);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.gcd__card {
  display: flex;
  align-items: center;
  gap: 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  padding: 12px 14px;
  margin-bottom: 12px;
}
.gcd__card--dim {
  opacity: 0.6;
}
.gcd__flag {
  font-size: 40px;
  line-height: 1;
}
.gcd__facts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: var(--vp-c-text-1);
}
.gcd__facts span {
  color: var(--vp-c-text-2);
}
.gcd__log {
  font:
    12px/1.6 ui-monospace,
    Menlo,
    monospace;
  color: var(--vp-c-text-3);
  border-top: 1px dashed var(--vp-c-divider);
  padding-top: 8px;
  margin-bottom: 8px;
}
.gcd__hint {
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin: 8px 0 0;
}
.gcd__code :deep(div[class*='language-']) {
  margin: 0;
  border-radius: 0;
}
</style>
