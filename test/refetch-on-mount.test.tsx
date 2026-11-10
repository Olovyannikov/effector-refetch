// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { createEffect } from 'effector';
import { createQuery } from '../src';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(p: () => boolean) {
  for (let i = 0; i < 50 && !p(); i++) await tick();
}

// A query that has already run once (status 'done', params recorded), no scope.
async function ranQuery() {
  let calls = 0;
  const fx = createEffect(async (id: number) => {
    calls++;
    return `v${id}-${calls}`;
  });
  const query = createQuery({ effect: fx });
  query.start(1);
  await until(() => query.$status.getState() === 'done');
  return { query, calls: () => calls };
}

describe('refetchOnMount', () => {
  describe('React', () => {
    afterEach(async () => (await import('@testing-library/react')).cleanup());

    it("'always' refetches with the last params on mount; default does nothing", async () => {
      const { render } = await import('@testing-library/react');
      const { useQuery } = await import('../src/react');

      const a = await ranQuery();
      function ViewA() {
        useQuery(a.query, { refetchOnMount: 'always' });
        return null;
      }
      render(<ViewA />);
      await until(() => a.calls() === 2);
      expect(a.calls()).toBe(2);

      const b = await ranQuery();
      function ViewB() {
        useQuery(b.query); // no option
        return null;
      }
      render(<ViewB />);
      await tick(20);
      expect(b.calls()).toBe(1); // untouched
    });
  });

  describe('React (void query)', () => {
    afterEach(async () => (await import('@testing-library/react')).cleanup());

    it("'always' refetches a query without params on mount", async () => {
      const { render } = await import('@testing-library/react');
      const { useQuery } = await import('../src/react');
      let calls = 0;
      const fx = createEffect(async () => ++calls);
      const query = createQuery({ effect: fx });
      query.start();
      await until(() => query.$status.getState() === 'done');

      function View() {
        useQuery(query, { refetchOnMount: 'always' });
        return null;
      }
      render(<View />);
      await until(() => calls === 2);
      expect(calls).toBe(2);
    });
  });

  describe('Vue', () => {
    it("'always' refetches on mount", async () => {
      const { mount } = await import('@vue/test-utils');
      const { defineComponent } = await import('vue');
      const { useQuery } = await import('../src/vue');

      const { query, calls } = await ranQuery();
      const Comp = defineComponent({
        setup() {
          useQuery(query, { refetchOnMount: 'always' });
          return () => null;
        },
      });
      mount(Comp, { attachTo: document.body });
      await until(() => calls() === 2);
      expect(calls()).toBe(2);
    });
  });

  describe('Solid', () => {
    it("'always' refetches on mount", async () => {
      const { render } = await import('solid-js/web');
      const h = (await import('solid-js/h')).default;
      const { useQuery } = await import('../src/solid');

      const { query, calls } = await ranQuery();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const dispose = render(
        h(() => {
          useQuery(query, { refetchOnMount: 'always' });
          return null;
        }),
        host,
      );
      await until(() => calls() === 2);
      expect(calls()).toBe(2);
      dispose();
      host.remove();
    });
  });
});
