import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, createEvent, createStore, fork } from 'effector';
import { createQuery, keepFresh } from '../src';

describe('keepFresh', () => {
  it('refetches with the last params when a source changes', async () => {
    let calls = 0;
    const fx = createEffect(async (id: number) => {
      calls++;
      return `v${id}-${calls}`;
    });
    const query = createQuery({ effect: fx });

    const setFilter = createEvent<string>();
    const $filter = createStore('a').on(setFilter, (_s, v) => v);
    keepFresh(query, { source: $filter });

    const scope = fork();
    await allSettled(query.start, { scope, params: 1 });
    expect(calls).toBe(1);

    // change the source → refetch with last params (1)
    await allSettled(setFilter, { scope, params: 'b' });
    expect(calls).toBe(2);
    expect(scope.getState(query.$data)).toBe('v1-2');
    expect(scope.getState(query.$params)).toBe(1);
  });

  it('is a no-op before the query has run', async () => {
    let calls = 0;
    const fx = createEffect(async () => {
      calls++;
      return 1;
    });
    const query = createQuery({ effect: fx });
    const setFilter = createEvent<string>();
    const $filter = createStore('a').on(setFilter, (_s, v) => v);
    keepFresh(query, { source: $filter });

    const scope = fork();
    await allSettled(setFilter, { scope, params: 'b' }); // query never started
    expect(calls).toBe(0);
    expect(scope.getState(query.$status)).toBe('initial');
  });

  it('refetches a query without params (void) when the source changes', async () => {
    let calls = 0;
    const fx = createEffect(async () => {
      calls++;
      return calls;
    });
    const query = createQuery({ effect: fx });
    const setLocale = createEvent<string>();
    const $locale = createStore('ru').on(setLocale, (_s, v) => v);
    keepFresh(query, { source: $locale });

    const scope = fork();
    await allSettled(query.start, { scope });
    expect(calls).toBe(1);
    // effector never stores `undefined`, so $params stays null for void queries
    expect(scope.getState(query.$params)).toBeNull();

    await allSettled(setLocale, { scope, params: 'en' });
    expect(calls).toBe(2);
    expect(scope.getState(query.$data)).toBe(2);
  });
});
