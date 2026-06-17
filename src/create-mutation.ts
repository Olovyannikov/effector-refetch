import type { EventCallable } from 'effector';
import { createQuery } from './create-query';
import type { CreateMutationConfig, CreateMutationHandlerConfig, Mutation } from './types';

/**
 * A Mutation is a write-flavored Query: same effect-first engine (status,
 * retry, concurrency, lifecycle) but without cache / refresh / stale, and with
 * a `mutate` alias. Concurrency defaults to TAKE_EVERY so independent writes
 * don't cancel each other.
 */
export function createMutation<Params, Result, Error = unknown, Mapped = Result>(
  config: CreateMutationConfig<Params, Result, Error, Mapped>,
): Mutation<Params, Result, Error, Mapped>;
export function createMutation<Params, Result, Error = unknown, Mapped = Result>(
  config: CreateMutationHandlerConfig<Params, Result, Error, Mapped>,
): Mutation<Params, Result, Error, Mapped>;
export function createMutation<Params, Result, Error = unknown, Mapped = Result>(
  config:
    | CreateMutationConfig<Params, Result, Error, Mapped>
    | CreateMutationHandlerConfig<Params, Result, Error, Mapped>,
): Mutation<Params, Result, Error, Mapped> {
  // A mutation config is structurally a subset of a query config (no cache /
  // contract / stale / etc.), so each branch is assignable to the matching
  // createQuery overload — narrowing on `'effect' in config` keeps full type
  // checking instead of an `as never` escape hatch.
  // TAKE_EVERY by default so independent writes don't cancel each other.
  const query =
    'effect' in config
      ? createQuery<Params, Result, Error, Mapped>({
          ...config,
          concurrency: config.concurrency ?? 'TAKE_EVERY',
        })
      : createQuery<Params, Result, Error, Mapped>({
          ...config,
          concurrency: config.concurrency ?? 'TAKE_EVERY',
        });

  const mutate = query.start;

  return {
    start: query.start,
    mutate,
    reset: query.reset,
    cancel: query.cancel,

    $data: query.$data,
    $error: query.$error,
    $status: query.$status,
    $pending: query.$pending,
    $params: query.$params,

    finished: query.finished,
    aborted: query.aborted,

    __: query.__,

    '@@unitShape': () => ({
      data: query.$data,
      error: query.$error,
      status: query.$status,
      pending: query.$pending,
      params: query.$params,
      start: query.start as EventCallable<Params>,
      mutate: mutate as EventCallable<Params>,
      reset: query.reset,
      cancel: query.cancel,
    }),

    '@@trigger': query['@@trigger'],
  };
}
