import { is } from 'effector';
import { createBaseQuery } from './base-query';
import { wireTagInvalidation } from './invalidate';
import { cache, concurrency, retry } from './operators';
import type {
  CreateQueryConfig,
  CreateQueryHandlerConfig,
  CreateQueryMappedConfig,
  Query,
  QuerySource,
  SourcedConfig,
} from './types';

/**
 * Build a query on top of a real effect, then apply the inline `concurrency` /
 * `retry` / `cache` options. Constants go through the standalone operators
 * (`concurrency()` / `retry()` / `cache()`); inline `Store` values are wired as
 * reactive, fork-correct sourced config.
 *
 * With `mapParams` (+ optional `source` stores, read fork-correctly), public
 * params are mapped into the effect's params before every run — the
 * `attach({ source, mapParams })` idiom that also works for abortable
 * (`createRequestFx`) effects. The cache key is computed from the mapped params.
 */
export function createQuery<
  Params,
  EffectParams,
  Result,
  Error = unknown,
  Mapped = Result,
  Src extends QuerySource | undefined = undefined,
>(
  config: CreateQueryMappedConfig<Params, EffectParams, Src, Result, Error, Mapped>,
): Query<Params, Result, Error, Mapped>;
export function createQuery<Params, Result, Error = unknown, Mapped = Result>(
  config: CreateQueryConfig<Params, Result, Error, Mapped>,
): Query<Params, Result, Error, Mapped>;
export function createQuery<Params, Result, Error = unknown, Mapped = Result>(
  config: CreateQueryHandlerConfig<Params, Result, Error, Mapped>,
): Query<Params, Result, Error, Mapped>;
export function createQuery<Params, Result, Error = unknown, Mapped = Result>(
  config:
    | CreateQueryConfig<Params, Result, Error, Mapped>
    | CreateQueryHandlerConfig<Params, Result, Error, Mapped>
    | CreateQueryMappedConfig<Params, unknown, QuerySource | undefined, Result, Error, Mapped>,
): Query<Params, Result, Error, Mapped> {
  const c = config.concurrency;
  const r = config.retry;
  const ca = config.cache;
  const to = config.timeout;

  // collect reactive (sourced) stores from inline options
  const sourced: SourcedConfig = {};
  if (is.store(c)) sourced.strategy = c;
  if (r != null && typeof r === 'object' && is.store(r.times)) sourced.retryTimes = r.times;
  if (ca != null && typeof ca === 'object' && is.store(ca.staleAfter)) sourced.staleAfter = ca.staleAfter;
  if (is.store(to)) sourced.timeout = to;

  // the mapped-config extras (`source` / `mapParams`) are read loosely by the engine
  const query = createBaseQuery<Params, Result, Error, Mapped>(
    config as CreateQueryConfig<Params, Result, Error, Mapped>,
    sourced,
  );

  // constants via the standalone operators; sourced stores already wired above
  if (!is.store(c)) concurrency(query, { strategy: c ?? 'TAKE_LATEST' });
  if (r != null) retry(query, r);
  if (ca) cache(query, ca);
  if (typeof to === 'number') query.__.setTimeout(to);

  // validation: contract + custom validate
  const { contract, validate } = config;
  if (contract || validate) {
    const checks: Array<(result: unknown, params: Params) => string[] | null> = [];
    if (contract) {
      checks.push((result) => (contract.isData(result) ? null : contract.getErrorMessages(result)));
    }
    if (validate) {
      checks.push((result, params) => {
        const verdict = validate({ result: result as Result, params });
        if (verdict === true || verdict == null) return null;
        if (verdict === false) return ['Validation failed'];
        return verdict;
      });
    }
    query.__.setValidate((result, params) => {
      for (const check of checks) {
        const messages = check(result, params);
        if (messages) return messages;
      }
      return null;
    });
  }

  if (config.tags?.length) wireTagInvalidation(query, config.tags);

  return query;
}
