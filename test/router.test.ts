import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createEvent, fork } from 'effector';
import { createQuery, attachToRoute } from '../src';

describe('attachToRoute', () => {
  it('starts the query on route open (with mapped params) and resets on close', async () => {
    let calls = 0;
    const fx = createEffect(async (id: number) => {
      calls++;
      return `user-${id}`;
    });
    const query = createQuery({ effect: fx });

    const opened = createEvent<{ params: { id: string } }>();
    const closed = createEvent();
    attachToRoute({
      route: { opened, closed },
      query,
      mapParams: ({ params }) => Number(params.id),
    });

    const scope = fork();
    await allSettled(opened, { scope, params: { params: { id: '5' } } });
    expect(calls).toBe(1);
    expect(scope.getState(query.$data)).toBe('user-5');
    expect(scope.getState(query.$params)).toBe(5);

    await allSettled(closed, { scope, params: undefined });
    expect(scope.getState(query.$status)).toBe('initial'); // reset on close
  });

  it('resetOnClose: false leaves the data in place', async () => {
    const fx = createEffect(async (id: number) => id);
    const query = createQuery({ effect: fx });
    const opened = createEvent<{ params: number }>();
    const closed = createEvent();
    attachToRoute({ route: { opened, closed }, query, resetOnClose: false });

    const scope = fork();
    await allSettled(opened, { scope, params: { params: 1 } });
    await allSettled(closed, { scope, params: undefined });
    expect(scope.getState(query.$status)).toBe('done'); // kept
  });
});

describe('attachToRoute — updated wiring', () => {
  it('re-starts the query when the open route receives new params', async () => {
    const { createEvent } = await import('effector');
    const opened = createEvent<{ params: { id: string } }>();
    const updated = createEvent<{ params: { id: string } }>();
    const closed = createEvent();
    const seen: number[] = [];
    const fx = createEffect(async (id: number) => {
      seen.push(id);
      return id;
    });
    const query = createQuery({ effect: fx });
    attachToRoute({
      route: { opened, updated, closed },
      query,
      mapParams: ({ params }) => Number(params.id),
    });
    const scope = fork();

    await allSettled(opened, { scope, params: { params: { id: '1' } } });
    await allSettled(updated, { scope, params: { params: { id: '2' } } });
    expect(seen).toEqual([1, 2]);
    expect(scope.getState(query.$data)).toBe(2);
  });

  it('restartOnUpdate: false ignores param changes', async () => {
    const { createEvent } = await import('effector');
    const opened = createEvent<{ params: { id: string } }>();
    const updated = createEvent<{ params: { id: string } }>();
    const seen: number[] = [];
    const fx = createEffect(async (id: number) => {
      seen.push(id);
      return id;
    });
    const query = createQuery({ effect: fx });
    attachToRoute({
      route: { opened, updated },
      query,
      mapParams: ({ params }) => Number(params.id),
      restartOnUpdate: false,
    });
    const scope = fork();

    await allSettled(opened, { scope, params: { params: { id: '1' } } });
    await allSettled(updated, { scope, params: { params: { id: '2' } } });
    expect(seen).toEqual([1]);
  });
});

describe('attachToRoute — real @effector/router', () => {
  it('drives a query through actual navigation: open, param change, close', async () => {
    const { createRoute, createRouter, historyAdapter } = await import('@effector/router');
    const { createMemoryHistory } = await import('history');

    const userRoute = createRoute({ path: '/users/:id' });
    const homeRoute = createRoute({ path: '/' });
    const router = createRouter({ routes: [homeRoute, userRoute] });

    const seen: string[] = [];
    const fx = createEffect(async (id: string) => {
      seen.push(id);
      return `user-${id}`;
    });
    const query = createQuery({ effect: fx });
    attachToRoute({
      route: userRoute,
      query,
      mapParams: (opened) => (opened as { params: { id: string } }).params.id,
    });

    const scope = fork();
    await allSettled(router.setHistory, {
      scope,
      params: historyAdapter(createMemoryHistory({ initialEntries: ['/'] })),
    });

    await allSettled(userRoute.open, { scope, params: { params: { id: '1' } } });
    expect(seen).toEqual(['1']);
    expect(scope.getState(query.$data)).toBe('user-1');

    await allSettled(userRoute.open, { scope, params: { params: { id: '2' } } }); // updated
    expect(seen).toEqual(['1', '2']);
    expect(scope.getState(query.$data)).toBe('user-2');

    await allSettled(homeRoute.open, { scope, params: {} }); // closes userRoute
    expect(scope.getState(query.$data)).toBeNull(); // reset
    expect(scope.getState(query.$status)).toBe('initial');
  });
});
