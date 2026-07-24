<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useUnit } from 'effector-vue/composition';
// import straight from source so the demo needs no build step
import { createQuery, createMutation, optimisticUpdate } from '../../../../src';

const tab = ref<'demo' | 'code'>('demo');

interface Todo {
  id: number;
  text: string;
  /** true only on the optimistic layer's temp item — never on server items */
  pending?: boolean;
}

// --- simulated server: an in-memory array behind a ~600ms delay ---
let serverTodos: Todo[] = [
  { id: 1, text: 'Read the docs' },
  { id: 2, text: 'Ship the feature' },
];
let nextId = 3;
const rejectWrites = ref(false);
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

const todosQuery = createQuery({
  handler: async (): Promise<Todo[]> => {
    await delay(600);
    return [...serverTodos];
  },
});

// TAKE_EVERY: parallel adds don't cancel each other — each keeps its own optimistic layer
const addTodo = createMutation({
  handler: async (text: string): Promise<Todo> => {
    await delay(600);
    if (rejectWrites.value) throw new Error('server rejected the write');
    const todo = { id: nextId++, text };
    serverTodos = [...serverTodos, todo];
    return todo;
  },
  concurrency: 'TAKE_EVERY',
});

optimisticUpdate({
  query: todosQuery,
  on: addTodo,
  // applied immediately on addTodo.mutate(text)
  update: ({ data, params }) => [...(data ?? []), { id: 0, text: params, pending: true }],
  // reconcile the temp item with the server result on success
  commit: ({ data, result }) => {
    const list = data ?? [];
    const idx = list.findIndex((t) => t.pending && t.text === result.text);
    return idx === -1 ? list : list.map((t, i) => (i === idx ? result : t));
  },
  // rollbackOnFailure defaults to true — a failed add removes ONLY its own layer
});

const { todos, loading, mutate, refresh } = useUnit({
  todos: todosQuery.$data,
  loading: todosQuery.$pending,
  mutate: addTodo.mutate,
  refresh: todosQuery.start,
});

// in-flight params tracked via mutation events, plus the event log
const inFlight = ref(0);
const log = ref<Array<{ text: string; kind: 'opt' | 'ok' | 'fail' }>>([]);
const push = (text: string, kind: 'opt' | 'ok' | 'fail') => {
  log.value = [...log.value.slice(-8), { text, kind }];
};

const unsubs: Array<() => void> = [];
unsubs.push(
  addTodo.mutate.watch((text) => {
    inFlight.value++;
    push(`optimistic-add "${text}" — shown before the server answers`, 'opt');
  }),
  addTodo.finished.done.watch(({ result }) => {
    inFlight.value--;
    push(`committed "${result.text}" — reconciled with server id ${result.id}`, 'ok');
  }),
  addTodo.finished.fail.watch(({ params }) => {
    inFlight.value--;
    push(`rolled back "${params}" — server rejected, only this layer removed`, 'fail');
  }),
  addTodo.aborted.watch(({ params }) => {
    inFlight.value--;
    push(`rolled back "${params}" — run aborted`, 'fail');
  }),
);
onUnmounted(() => unsubs.forEach((u) => u()));
onMounted(() => refresh());

const draft = ref('');
const add = () => {
  const text = draft.value.trim();
  if (!text) return;
  draft.value = '';
  mutate(text);
};
</script>

<template>
  <div class="otd">
    <div class="otd__tabs">
      <button class="otd__tab" :class="{ active: tab === 'demo' }" @click="tab = 'demo'">Demo</button>
      <button class="otd__tab" :class="{ active: tab === 'code' }" @click="tab = 'code'">Code</button>
    </div>

    <div v-show="tab === 'demo'" class="otd__panel">
      <div class="otd__bar">
        <input v-model="draft" class="otd__input" type="text" placeholder="New todo…" @keyup.enter="add()" />
        <button class="otd__btn otd__btn--go" :disabled="!draft.trim()" @click="add()">Add</button>
        <span v-if="inFlight > 0" class="otd__flight">{{ inFlight }} in flight</span>
      </div>

      <label class="otd__switch">
        <input v-model="rejectWrites" type="checkbox" />
        server rejects writes — watch the optimistic item appear, then roll back
      </label>

      <div v-if="loading && !todos" class="otd__skeleton">▒▒▒ loading todos ▒▒▒</div>

      <ul v-else class="otd__list">
        <li
          v-for="(t, i) in todos ?? []"
          :key="t.pending ? `pending-${t.text}-${i}` : t.id"
          class="otd__item"
          :class="{ 'is-pending': t.pending }"
        >
          <span class="otd__mark">{{ t.pending ? '…' : '✓' }}</span>
          {{ t.text }}
          <em v-if="t.pending" class="otd__tag">optimistic</em>
        </li>
      </ul>

      <p class="otd__hint">
        Type and hit <em>Add</em> — the item shows up instantly (dimmed) and solidifies ~600&nbsp;ms later
        when the server commits. Fire several adds quickly: <code>TAKE_EVERY</code> stacks a layer per
        mutation. Check the toggle and one failed add rolls back only its own item.
      </p>

      <div class="otd__log">
        <span v-if="log.length === 0" class="otd__logempty">no activity yet — add a todo</span>
        <div
          v-for="(e, i) in log"
          :key="i"
          :class="{ 'is-opt': e.kind === 'opt', 'is-fail': e.kind === 'fail' }"
        >
          {{ e.text }}
        </div>
      </div>
    </div>

    <div v-show="tab === 'code'" class="otd__code">
      <slot name="code" />
    </div>
  </div>
</template>

<style scoped>
.otd {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  margin: 16px 0;
}
.otd__tabs {
  display: flex;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.otd__tab {
  padding: 8px 18px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 13px;
}
.otd__tab.active {
  color: var(--vp-c-brand-1);
  box-shadow: inset 0 -2px 0 var(--vp-c-brand-1);
}
.otd__panel {
  padding: 14px;
}
.otd__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.otd__input {
  flex: 1;
  min-width: 0;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 13px;
}
.otd__input:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}
.otd__btn {
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 13px;
}
.otd__btn--go {
  border-color: var(--vp-c-brand-1);
}
.otd__btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.otd__flight {
  font-size: 12px;
  color: var(--vp-c-brand-1);
  white-space: nowrap;
}
.otd__switch {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
  margin-bottom: 12px;
  color: var(--vp-c-text-2);
}
.otd__skeleton {
  font:
    13px/1.5 ui-monospace,
    Menlo,
    monospace;
  color: var(--vp-c-text-3);
  padding: 20px 0;
  text-align: center;
}
.otd__list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow: auto;
}
.otd__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  font-size: 13px;
  margin: 0;
}
.otd__item.is-pending {
  opacity: 0.55;
  font-style: italic;
  border-style: dashed;
}
.otd__mark {
  color: var(--vp-c-brand-1);
  width: 14px;
  text-align: center;
}
.otd__tag {
  margin-left: auto;
  font-size: 11px;
  color: var(--vp-c-text-3);
}
.otd__hint {
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin: 0 0 12px;
}
.otd__log {
  font:
    12px/1.5 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  background: var(--vp-c-bg-alt);
  border-radius: 8px;
  padding: 8px 10px;
  min-height: 40px;
  max-height: 140px;
  overflow: auto;
}
.otd__logempty {
  color: var(--vp-c-text-3);
}
.otd__log .is-opt {
  color: #f08c00;
}
.otd__log .is-fail {
  color: #e03131;
}
.otd__code :deep(div[class*='language-']) {
  margin: 0;
  border-radius: 0;
}
</style>
