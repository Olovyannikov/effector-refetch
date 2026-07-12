// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { allSettled, createEffect, fork } from 'effector';
import { Scope } from 'effector';
import { useUnit } from 'effector-vue/composition';
import { EffectorScopePlugin } from 'effector-vue';
import { createQuery } from '../src';
import { useQuery } from '../src/vue';

function mountWithScope(component: ReturnType<typeof defineComponent>, scope: Scope) {
  return mount(component, {
    global: { plugins: [EffectorScopePlugin({ scope }) as never] },
  });
}

describe('useUnit(query) — Vue binding', () => {
  it('reflects state and binds refetch through the @@unitShape protocol', async () => {
    let calls = 0;
    const fx = createEffect(async (id: number) => {
      calls++;
      return `v${id}-${calls}`;
    });
    const query = createQuery({ effect: fx });

    const Comp = defineComponent({
      setup() {
        const { pending, data, refetch } = useUnit(query);
        return { pending, data, refetch };
      },
      render() {
        return h('span', `${this.pending ? 'pending' : 'idle'}:${this.data ?? 'null'}`);
      },
    });

    const scope = fork();
    const wrapper = mountWithScope(Comp, scope);

    expect(wrapper.text()).toBe('idle:null');

    await allSettled(query.start, { scope, params: 1 });
    await nextTick();
    expect(wrapper.text()).toBe('idle:v1-1');

    // refetch fired from the component, bound to the same scope
    (wrapper.vm as unknown as { refetch: (id: number) => void }).refetch(1);
    // wait for the scope-bound effect to settle
    for (let i = 0; i < 20 && scope.getState(query.$data) !== 'v1-2'; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    await nextTick();
    expect(scope.getState(query.$data)).toBe('v1-2');
    expect(wrapper.text()).toBe('idle:v1-2');
    expect(calls).toBe(2);
  });

  it('useQuery helper exposes derived flags', async () => {
    const fx = createEffect(async (id: number) => `user-${id}`);
    const query = createQuery({ effect: fx });

    const Comp = defineComponent({
      setup() {
        const { data, isInitial, isPending, isDone, isInitialLoading, isRefetching } = useQuery(query);
        return { data, isInitial, isPending, isDone, isInitialLoading, isRefetching };
      },
      render() {
        const flag = this.isInitial ? 'initial' : this.isDone ? 'done' : this.isPending ? 'pending' : '?';
        const load = this.isInitialLoading ? 'first' : this.isRefetching ? 'refetch' : 'idle';
        return h('span', `${flag}:${this.data ?? 'null'}:${load}`);
      },
    });

    const scope = fork();
    const wrapper = mountWithScope(Comp, scope);
    expect(wrapper.text()).toBe('initial:null:idle');

    await allSettled(query.start, { scope, params: 3 });
    await nextTick();
    expect(wrapper.text()).toBe('done:user-3:idle');
  });
});
