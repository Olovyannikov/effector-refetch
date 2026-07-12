// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { allSettled, createEffect, fork } from 'effector';
import { Provider, useUnit } from 'effector-react';
import { createQuery } from '../src';
import { useQuery } from '../src/react';

describe('useQuery (React binding)', () => {
  afterEach(() => cleanup());

  it('reflects query state and binds triggers to the scope', async () => {
    const fx = createEffect(async (id: number) => `user-${id}`);
    const query = createQuery({ effect: fx });

    function View() {
      const { data, status, isPending, isInitialLoading, isRefetching } = useQuery(query);
      const load = isInitialLoading ? 'first' : isRefetching ? 'refetch' : 'idle';
      return (
        <div>
          <span data-testid="status">{isPending ? 'pending' : status}</span>
          <span data-testid="data">{data ?? 'null'}</span>
          <span data-testid="load">{load}</span>
        </div>
      );
    }

    const scope = fork();
    render(
      <Provider value={scope}>
        <View />
      </Provider>,
    );

    expect(screen.getByTestId('status').textContent).toBe('initial');
    expect(screen.getByTestId('data').textContent).toBe('null');

    await act(async () => {
      await allSettled(query.start, { scope, params: 7 });
    });

    expect(screen.getByTestId('status').textContent).toBe('done');
    expect(screen.getByTestId('data').textContent).toBe('user-7');
  });

  it('triggers fired from the component update the scoped state', async () => {
    const fx = createEffect(async (id: number) => id * 10);
    const query = createQuery({ effect: fx });

    let startFn: (id: number) => void = () => {};
    function View() {
      const { data, start } = useQuery(query);
      startFn = start;
      return <span data-testid="data">{String(data ?? 'null')}</span>;
    }

    const scope = fork();
    render(
      <Provider value={scope}>
        <View />
      </Provider>,
    );

    await act(async () => {
      startFn(4);
    });

    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('40'));
    expect(scope.getState(query.$data)).toBe(40);
  });

  it('useUnit(query) works directly via the @@unitShape protocol', async () => {
    let calls = 0;
    const fx = createEffect(async (id: number) => {
      calls++;
      return `v${id}-${calls}`;
    });
    const query = createQuery({ effect: fx });

    let refetchFn: (id: number) => void = () => {};
    function View() {
      // exactly the shape the user asked for
      const { pending, refetch, data } = useUnit(query);
      refetchFn = refetch;
      return <span data-testid="cell">{`${pending ? 'pending' : 'idle'}:${data ?? 'null'}`}</span>;
    }

    const scope = fork();
    render(
      <Provider value={scope}>
        <View />
      </Provider>,
    );

    expect(screen.getByTestId('cell').textContent).toBe('idle:null');

    await act(async () => {
      await allSettled(query.start, { scope, params: 1 });
    });
    expect(screen.getByTestId('cell').textContent).toBe('idle:v1-1');

    // refetch fired from the component re-runs the effect
    await act(async () => {
      refetchFn(1);
    });
    await waitFor(() => expect(screen.getByTestId('cell').textContent).toBe('idle:v1-2'));
    expect(calls).toBe(2);
  });
});
