// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { Component, Suspense, type ReactNode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createEffect, fork } from 'effector';
import { Provider } from 'effector-react';
import { createQuery } from '../src';
import { useSuspenseQuery } from '../src/react';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <span>boundary: {this.state.error.message}</span> : this.props.children;
  }
}

describe('useSuspenseQuery', () => {
  afterEach(() => cleanup());

  it('suspends while loading, then renders the data', async () => {
    const fx = createEffect(
      (id: number) =>
        new Promise<{ name: string }>((res) => setTimeout(() => res({ name: `user-${id}` }), 30)),
    );
    const query = createQuery({ effect: fx });

    function View() {
      const data = useSuspenseQuery(query, 5);
      return <span>{data.name}</span>;
    }

    render(
      <Suspense fallback={<span>loading…</span>}>
        <View />
      </Suspense>,
    );

    // auto-started and suspended → fallback first
    expect(screen.getByText('loading…')).toBeTruthy();

    // resolves → data shown
    await waitFor(() => expect(screen.getByText('user-5')).toBeTruthy());
  });

  it('suspends and resolves under a forked scope Provider (scope-aware settle)', async () => {
    const fx = createEffect(
      (id: number) =>
        new Promise<{ name: string }>((res) => setTimeout(() => res({ name: `user-${id}` }), 30)),
    );
    const query = createQuery({ effect: fx });
    const scope = fork();

    function View() {
      const data = useSuspenseQuery(query, 7);
      return <span>{data.name}</span>;
    }

    render(
      <Provider value={scope}>
        <Suspense fallback={<span>loading…</span>}>
          <View />
        </Suspense>
      </Provider>,
    );

    expect(screen.getByText('loading…')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('user-7')).toBeTruthy());
    // the run (and its settle, observed via the scoped createWatch) happened in the fork
    expect(scope.getState(query.$status)).toBe('done');
  });

  it('does not reuse a settled suspense promise for a later pending cycle (no render busy-loop)', async () => {
    const resolvers: Array<(v: { name: string }) => void> = [];
    const fx = createEffect((_id: number) => new Promise<{ name: string }>((res) => resolvers.push(res)));
    const query = createQuery({ effect: fx });

    let renders = 0;
    function View() {
      renders++;
      const data = useSuspenseQuery(query, 1);
      return <span>{data.name}</span>;
    }
    const ui = (
      <Suspense fallback={<span>loading…</span>}>
        <View />
      </Suspense>
    );

    // mount -> suspend -> unmount BEFORE the settle (the cached promise is orphaned)
    const first = render(ui);
    expect(screen.getByText('loading…')).toBeTruthy();
    first.unmount();

    // cycle 1 settles: the orphaned cached promise resolves
    resolvers[0]({ name: 'first' });
    await new Promise((r) => setTimeout(r, 0));

    // a new pending cycle begins, then the component mounts again
    query.refresh(1);
    renders = 0;
    render(ui);
    expect(screen.getByText('loading…')).toBeTruthy();

    // with a stale RESOLVED promise in the cache React would retry-render in a hot loop here
    await new Promise((r) => setTimeout(r, 20));
    expect(renders).toBeLessThan(10);

    resolvers[1]({ name: 'second' });
    await waitFor(() => expect(screen.getByText('second')).toBeTruthy());
  });

  it('throws to the nearest Error Boundary on failure', async () => {
    const fx = createEffect((): Promise<number> => Promise.reject(new Error('nope')));
    const query = createQuery({ effect: fx });

    function View() {
      const n = useSuspenseQuery(query); // void params -> no second argument
      return <span>{n}</span>;
    }

    render(
      <ErrorBoundary>
        <Suspense fallback={<span>loading…</span>}>
          <View />
        </Suspense>
      </ErrorBoundary>,
    );

    await waitFor(() => expect(screen.getByText('boundary: nope')).toBeTruthy());
  });
});

describe('useSuspenseQuery — cancel while suspended (audit regression)', () => {
  afterEach(() => cleanup());

  it('a cancelled data-less query does not hang in the fallback: the retry render restarts it', async () => {
    const { allSettled } = await import('effector');
    let calls = 0;
    const resolvers: Array<(v: string) => void> = [];
    const fx = createEffect((_: void) => {
      calls++;
      return new Promise<string>((res) => resolvers.push(res));
    });
    const query = createQuery({ effect: fx });
    const scope = fork();

    function View() {
      const v = useSuspenseQuery(query);
      return <span>value: {v}</span>;
    }
    render(
      <Provider value={scope}>
        <Suspense fallback={<span>loading</span>}>
          <View />
        </Suspense>
      </Provider>,
    );
    expect(screen.getByText('loading')).toBeTruthy();
    expect(calls).toBe(1);

    // cancel the in-flight run: no data, status back to initial. Before the fix the
    // suspense promise never resolved and the component hung in the fallback forever.
    // NOT awaited: the first run's promise never settles (non-abortable effect), so the
    // scope never goes idle — which is exactly the hardest flavor of this bug.
    const cancelled = allSettled(query.cancel, { scope });

    // the retry render auto-restarts the query...
    await waitFor(() => expect(calls).toBe(2));
    // ...and the second run's data renders normally
    resolvers[1]('recovered');
    await waitFor(() => expect(screen.getByText('value: recovered')).toBeTruthy());

    resolvers[0]('stale'); // let the zombie run settle so the scope can idle
    await cancelled;
  });
});
