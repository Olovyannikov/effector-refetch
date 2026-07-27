import { describe, it, expect } from 'vitest';
import { createEffect, is } from 'effector';
import * as lib from '../src';

/**
 * Lock the public API surface: a rename or an accidental barrel-file removal
 * fails HERE, not in a consumer's build. Extend the lists when the surface
 * legitimately grows — that's the point of the lock.
 */

const FUNCTIONS = [
  // factories
  'createQuery',
  'createMutation',
  'createInfiniteQuery',
  'createQueryFactory',
  'createJsonQuery',
  'createJsonMutation',
  'createRequestFx',
  'createJsonRequestFx',
  'createBarrier',
  'createNetworkBarrier',
  'createContract',
  // operators
  'concurrency',
  'retry',
  'cache',
  'timeout',
  'debounce',
  'fallback',
  'keepFresh',
  'applyBarrier',
  // wiring
  'connectQuery',
  'combineQueries',
  'invalidate',
  'invalidateTag',
  'update',
  'optimisticUpdate',
  'attachToRoute',
  'attachQueryLogger',
  // cache access & SSR
  'getQueryData',
  'setQueryData',
  'inMemoryCache',
  'localStorageCache',
  'sessionStorageCache',
  'voidCache',
  'dehydrate',
  'hydrate',
  // browser triggers
  'refetchOnWindowFocus',
  'refetchOnReconnect',
  // contracts & guards
  'zodContract',
  'ioTsContract',
  'runtypesContract',
  'superstructContract',
  'typedContract',
  'standardSchemaContract',
  'isRequestError',
  'isHttpError',
  'isTimeoutError',
  'isValidationError',
  'isTrigger',
  'normalizeRequestError',
  // utils
  'linearDelay',
  'exponentialDelay',
  'stableStringify',
] as const;

const STORES = ['$queryCache', '$queryDefaults'] as const;
const EVENTS = ['setQueryDefaults'] as const;
const CLASSES = ['RequestError', 'ValidationError'] as const;

describe('public API surface', () => {
  it('every documented export exists with the right kind', () => {
    for (const name of FUNCTIONS) {
      expect(typeof (lib as Record<string, unknown>)[name], name).toBe('function');
    }
    for (const name of STORES) {
      expect(is.store((lib as Record<string, unknown>)[name]), name).toBe(true);
    }
    for (const name of EVENTS) {
      expect(is.event((lib as Record<string, unknown>)[name]), name).toBe(true);
    }
    for (const name of CLASSES) {
      const C = (lib as Record<string, unknown>)[name] as new (...args: never[]) => unknown;
      expect(typeof C, name).toBe('function');
      expect(C.prototype instanceof Error, `${name} extends Error`).toBe(true);
    }
    expect(typeof lib.HTTP_METHODS, 'HTTP_METHODS').toBe('object');
  });

  it('nothing undocumented leaks from the barrel', () => {
    const known = new Set<string>([...FUNCTIONS, ...STORES, ...EVENTS, ...CLASSES, 'HTTP_METHODS']);
    const actual = Object.keys(lib).filter((k) => k !== 'default');
    const unknown = actual.filter((k) => !known.has(k));
    expect(unknown, 'new exports must be added to the surface lock').toEqual([]);
  });

  it('a query instance exposes the documented unit shape', () => {
    const query = lib.createQuery({ effect: createEffect(async (n: number) => n) });

    for (const key of ['start', 'refresh', 'refetch', 'prefetch', 'reset', 'cancel'] as const) {
      expect(is.event(query[key]), key).toBe(true);
    }
    expect(is.effect(query.startAsync), 'startAsync').toBe(true);
    for (const key of [
      '$state',
      '$data',
      '$error',
      '$status',
      '$pending',
      '$isInitialLoading',
      '$isRefetching',
      '$stale',
      '$isPlaceholderData',
      '$enabled',
      '$params',
    ] as const) {
      expect(is.store(query[key]), key).toBe(true);
    }
    for (const key of ['done', 'fail', 'finally', 'success', 'failure', 'skip'] as const) {
      expect(is.event(query.finished[key]), `finished.${key}`).toBe(true);
    }
    expect(is.event(query.aborted), 'aborted').toBe(true);

    const shape = query['@@unitShape']();
    for (const key of Object.keys(shape)) {
      expect(is.unit(shape[key as keyof typeof shape]), `@@unitShape.${key}`).toBe(true);
    }
    expect(typeof query['@@trigger']).toBe('function');
  });

  it('a mutation instance exposes the documented unit shape', () => {
    const mutation = lib.createMutation({ effect: createEffect(async (n: number) => n) });
    for (const key of ['start', 'mutate', 'reset', 'cancel'] as const) {
      expect(is.event(mutation[key]), key).toBe(true);
    }
    expect(is.effect(mutation.startAsync), 'startAsync').toBe(true);
    expect(is.effect(mutation.mutateAsync), 'mutateAsync').toBe(true);
    for (const key of ['$data', '$error', '$status', '$pending', '$params'] as const) {
      expect(is.store(mutation[key]), key).toBe(true);
    }
  });
});
