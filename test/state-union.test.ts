import { describe, it, expect, expectTypeOf } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import { createQuery, type QueryState } from '../src';
import { abortableDeferred } from './support/harness';

type User = { id: number; name: string };
type State = QueryState<number, User, unknown>;

/**
 * Reatom-style state-machine snapshots: assert the ENTIRE $state object at every
 * transition against named constants typed via `satisfies` — each snapshot is both
 * a behavior assertion and a compile-time lock of the union's shape.
 */

const INITIAL = {
  status: 'initial',
  data: null,
  error: null,
  pending: false,
  stale: false,
  isPlaceholderData: false,
  isInitialLoading: false,
  isRefetching: false,
  enabled: true,
  params: null,
} satisfies State;

describe('$state — one discriminated union', () => {
  it('walks initial -> first pending -> done -> refetching -> fail with exact snapshots', async () => {
    const d = abortableDeferred<number, User>();
    const query = createQuery({ effect: d.fx });
    const scope = fork();
    const state = () => scope.getState(query.$state);

    expect(state()).toEqual(INITIAL);

    const p1 = allSettled(query.start, { scope, params: 1 });
    expect(state()).toEqual({
      ...INITIAL,
      status: 'pending',
      pending: true,
      isInitialLoading: true, // no data yet -> skeleton
      params: 1,
    } satisfies State);

    d.resolve(0, { id: 1, name: 'ada' });
    await p1;
    expect(state()).toEqual({
      ...INITIAL,
      status: 'done',
      data: { id: 1, name: 'ada' },
      params: 1,
    } satisfies State);

    const p2 = allSettled(query.refresh, { scope, params: 2 });
    expect(state()).toEqual({
      ...INITIAL,
      status: 'pending',
      data: { id: 1, name: 'ada' }, // keepPreviousData
      pending: true,
      isRefetching: true, // data on screen -> corner spinner, not skeleton
      params: 2,
    } satisfies State);

    d.reject(1, new Error('boom'));
    await p2;
    const failed = state();
    expect(failed).toEqual({
      ...INITIAL,
      status: 'fail',
      data: { id: 1, name: 'ada' }, // stale data kept
      error: new Error('boom'),
      params: 2,
    } satisfies State);
  });

  it('narrows: done guarantees data, fail guarantees error', async () => {
    const fx = createEffect(async (id: number): Promise<User> => ({ id, name: 'ada' }));
    const query = createQuery({ effect: fx });
    const scope = fork();
    await allSettled(query.start, { scope, params: 1 });

    const state = scope.getState(query.$state);
    if (state.status === 'done') {
      expectTypeOf(state.data).toEqualTypeOf<User>(); // non-null, no cast
      expectTypeOf(state.error).toEqualTypeOf<null>();
      expect(state.data.name).toBe('ada'); // direct access, no `?.`
    } else {
      throw new Error(`expected done, got ${state.status}`);
    }

    // compile-time only: the fail variant pins error to non-null
    const check = (s: State) => {
      if (s.status === 'fail') {
        expectTypeOf(s.error).toEqualTypeOf<unknown>();
        expectTypeOf(s.data).toEqualTypeOf<User | null>();
      }
      if (s.status === 'initial') {
        expectTypeOf(s.error).toEqualTypeOf<null>();
      }
    };
    void check;
  });

  it('cancel restores the last settled variant (integration with #57)', async () => {
    const d = abortableDeferred<number, User>();
    const query = createQuery({ effect: d.fx });
    const scope = fork();

    const p = allSettled(query.start, { scope, params: 1 });
    await allSettled(query.cancel, { scope });
    await p;

    // params keep the last requested value (cleared only by reset) — the variant is initial
    expect(scope.getState(query.$state)).toEqual({ ...INITIAL, params: 1 } satisfies State);
  });
});

describe('status flags ($succeeded / $failed / $finished)', () => {
  it('follow $status through the lifecycle, on queries and mutations', async () => {
    const d = abortableDeferred<number, User>();
    const query = createQuery({ effect: d.fx });
    const scope = fork();
    const flags = () => ({
      succeeded: scope.getState(query.$succeeded),
      failed: scope.getState(query.$failed),
      finished: scope.getState(query.$finished),
    });

    expect(flags()).toEqual({ succeeded: false, failed: false, finished: false });

    const p1 = allSettled(query.start, { scope, params: 1 });
    expect(flags()).toEqual({ succeeded: false, failed: false, finished: false }); // pending
    d.resolve(0, { id: 1, name: 'ada' });
    await p1;
    expect(flags()).toEqual({ succeeded: true, failed: false, finished: true });

    const p2 = allSettled(query.refresh, { scope, params: 2 });
    d.reject(1, new Error('boom'));
    await p2;
    expect(flags()).toEqual({ succeeded: false, failed: true, finished: true });

    await allSettled(query.reset, { scope });
    expect(flags()).toEqual({ succeeded: false, failed: false, finished: false });
  });
});
