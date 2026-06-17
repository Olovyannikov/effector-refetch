import { createEvent, sample, type EventCallable, type Store } from 'effector';
import { createQuery } from './create-query';
import { createMutation } from './create-mutation';
import type {
  CacheConfig,
  ConcurrencyStrategy,
  CreateMutationConfig,
  CreateMutationHandlerConfig,
  CreateQueryConfig,
  CreateQueryHandlerConfig,
  Mutation,
  Query,
  RetryConfig,
} from './types';
import type { Barrier } from './barrier';

/** Policy options applied to every query/mutation built by a factory. */
export interface QueryFactoryDefaults {
  retry?: number | RetryConfig<any>;
  cache?: boolean | CacheConfig<any>;
  concurrency?: ConcurrencyStrategy | Store<ConcurrencyStrategy>;
  refetchInterval?: number | Store<number>;
  structuralSharing?: boolean;
  enabled?: Store<boolean>;
  debug?: boolean;
  barrier?: Barrier;
}

/** Payload for a factory's group invalidation. */
export interface InvalidatePayload {
  /** Only refetch queries for which this returns true (receives the query object). */
  predicate?: (query: Query<any, any, any, any>) => boolean;
}

export interface QueryFactory {
  createQuery: typeof createQuery;
  createMutation: typeof createMutation;
  /** Refetch all queries this factory created (that have run); pass a `predicate` to narrow. */
  invalidate: EventCallable<InvalidatePayload | void>;
  /** Queries created by this factory. */
  queries: ReadonlyArray<Query<any, any, any, any>>;
  defaults: QueryFactoryDefaults;
}

/**
 * Bake shared defaults into `createQuery` / `createMutation`. Per-call options
 * override the defaults. This is the effector-flavored alternative to a global
 * `QueryClient` — e.g. make every query poll, or retry, by default:
 *
 *   const { createQuery } = createQueryFactory({ refetchInterval: 30_000, retry: 2 });
 *   const todos = createQuery({ effect: fetchTodosFx }); // polls + retries by default
 */
export function createQueryFactory(defaults: QueryFactoryDefaults = {}): QueryFactory {
  // mutations ignore query-only policies (cache / refetchInterval / enabled)
  const mutationDefaults = {
    retry: defaults.retry,
    concurrency: defaults.concurrency,
    debug: defaults.debug,
    barrier: defaults.barrier,
  };

  const invalidate = createEvent<InvalidatePayload | void>();
  const registry: Array<Query<any, any, any, any>> = [];

  function factoryQuery<Params, Result, Error = unknown, Mapped = Result>(
    config:
      | CreateQueryConfig<Params, Result, Error, Mapped>
      | CreateQueryHandlerConfig<Params, Result, Error, Mapped>,
  ): Query<Params, Result, Error, Mapped> {
    // branch so each call hits the matching createQuery overload with full type
    // checking (a factory config is structurally a subset of a query config)
    const query =
      'effect' in config
        ? createQuery<Params, Result, Error, Mapped>({ ...defaults, ...config })
        : createQuery<Params, Result, Error, Mapped>({ ...defaults, ...config });
    registry.push(query);
    // group invalidation: refetch (with last params) if it has run and matches the predicate
    sample({
      clock: invalidate,
      source: { params: query.$params, status: query.$status },
      filter: ({ status }, payload) =>
        status !== 'initial' && (payload && payload.predicate ? payload.predicate(query) : true),
      fn: ({ params }) => params as Params,
      target: query.refetch,
    });
    return query;
  }

  function factoryMutation<Params, Result, Error = unknown, Mapped = Result>(
    config:
      | CreateMutationConfig<Params, Result, Error, Mapped>
      | CreateMutationHandlerConfig<Params, Result, Error, Mapped>,
  ): Mutation<Params, Result, Error, Mapped> {
    return 'effect' in config
      ? createMutation<Params, Result, Error, Mapped>({ ...mutationDefaults, ...config })
      : createMutation<Params, Result, Error, Mapped>({ ...mutationDefaults, ...config });
  }

  return {
    createQuery: factoryQuery as typeof createQuery,
    createMutation: factoryMutation as typeof createMutation,
    invalidate,
    queries: registry,
    defaults,
  };
}
