import { is, type EventCallable } from 'effector';
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
  // TAKE_EVERY by default so independent writes don't cancel each other — including
  // the object form when only a lane `key` is given.
  const cc = config.concurrency;
  const concurrencyOpt =
    cc == null
      ? ('TAKE_EVERY' as const)
      : typeof cc === 'object' && !is.store(cc) && cc.strategy == null
        ? { ...cc, strategy: 'TAKE_EVERY' as const }
        : cc;
  const query =
    'effect' in config
      ? createQuery<Params, Result, Error, Mapped>({ ...config, concurrency: concurrencyOpt })
      : createQuery<Params, Result, Error, Mapped>({ ...config, concurrency: concurrencyOpt });

  const mutate = query.start;
  // eslint-disable-next-line effector/enforce-effect-naming-convention -- public API alias: `mutation.mutateAsync(params)`
  const mutateAsync = query.startAsync;

  return {
    start: query.start,
    startAsync: query.startAsync,
    mutate,
    mutateAsync,
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
      startAsync: query.startAsync,
      mutate: mutate as EventCallable<Params>,
      mutateAsync,
      reset: query.reset,
      cancel: query.cancel,
    }),

    '@@trigger': query['@@trigger'],
  };
}
