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
