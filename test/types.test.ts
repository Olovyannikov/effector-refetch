import { describe, it, expect, expectTypeOf } from 'vitest';
import { createEffect, createStore, type Event, type EventCallable, type Store } from 'effector';
import {
  createQuery,
  createMutation,
  createInfiniteQuery,
  type AbortReason,
  type QueryDefaults,
} from '../src';

/**
 * Type-level tests for the heavily generic public signatures. `expectTypeOf`
 * assertions and `@ts-expect-error` negatives are enforced by the repo's
 * `tsc --noEmit` (test files are type-checked), so a signature regression
 * fails the typecheck step — no extra runner needed.
 */

const fetchUserFx = createEffect(async (id: number) => ({ id, name: 'ada' }));

describe('type-level: createQuery', () => {
  it('infers Params / Result / Mapped through the chain', () => {
    const query = createQuery({ effect: fetchUserFx });

    expectTypeOf(query.start).toEqualTypeOf<EventCallable<number>>();
    expectTypeOf(query.$data).toEqualTypeOf<Store<{ id: number; name: string } | null>>();
    expectTypeOf(query.finished.done).toEqualTypeOf<
      Event<{ params: number; result: { id: number; name: string } }>
    >();
    expectTypeOf(query.aborted).toEqualTypeOf<Event<{ params: number; reason: AbortReason }>>();

    // mapData changes the store type, not the effect result
    const mapped = createQuery({ effect: fetchUserFx, mapData: ({ result }) => result.name });
    expectTypeOf(mapped.$data).toEqualTypeOf<Store<string | null>>();

    // valid configs that only need to typecheck (created for real is fine)
    createQuery({ effect: fetchUserFx, fallback: { id: 0, name: 'anonymous' } });
    createQuery({ effect: fetchUserFx, concurrency: { key: (id) => String(id) } });
    createQuery({ effect: fetchUserFx, enabled: createStore(true) });

    expect(true).toBe(true); // the assertions above are compile-time
  });

  it('rejects malformed configs (compile-time only, never executed)', () => {
    const negatives = () => {
      // @ts-expect-error — either `effect` or `handler` is required
      createQuery({ retry: 3 });
      // @ts-expect-error — concurrency strategy is a closed union
      createQuery({ effect: fetchUserFx, concurrency: 'TAKE_ALL' });
      // @ts-expect-error — fallback of the wrong shape
      createQuery({ effect: fetchUserFx, fallback: 'nope' });
      // @ts-expect-error — a plain boolean is not a reactive gate
      createQuery({ effect: fetchUserFx, enabled: true });
    };
    void negatives; // deliberately not called: malformed configs may throw at runtime
    expect(true).toBe(true);
  });
});

describe('type-level: createMutation / createInfiniteQuery', () => {
  it('mutation mirrors the query typing', () => {
    const mutation = createMutation({ effect: createEffect(async (text: string) => ({ ok: true, text })) });
    expectTypeOf(mutation.mutate).toEqualTypeOf<EventCallable<string>>();
    expectTypeOf(mutation.$data).toEqualTypeOf<Store<{ ok: boolean; text: string } | null>>();
    expect(true).toBe(true);
  });

  it('infinite query threads PageParam / Page types', () => {
    interface Page {
      items: string[];
      next: number | null;
    }
    const fetchPage = createEffect(
      async ({ pageParam }: { params: { q: string }; pageParam: number }): Promise<Page> => ({
        items: [String(pageParam)],
        next: pageParam + 1,
      }),
    );
    const pages = createInfiniteQuery({
      effect: fetchPage,
      initialPageParam: 0,
      getNextPageParam: ({ lastPage }) => lastPage.next,
    });
    expectTypeOf(pages.$pages).toEqualTypeOf<Store<Page[]>>();
    expectTypeOf(pages.fetchNext).toEqualTypeOf<EventCallable<void>>();

    createInfiniteQuery({
      effect: fetchPage,
      initialPageParam: 0,
      // @ts-expect-error — getNextPageParam must return the PageParam type (or null)
      getNextPageParam: () => 'not-a-number',
    });
    expect(true).toBe(true);
  });
});

describe('type-level: $queryDefaults', () => {
  it('accepts only the supported keys', () => {
    const good: QueryDefaults = { concurrency: 'TAKE_EVERY', retry: 2, staleAfter: 1000, timeout: 5000 };
    expect(good).toBeTruthy();
    // @ts-expect-error — unknown default key
    const bad: QueryDefaults = { debounce: 100 };
    void bad;
  });
});
