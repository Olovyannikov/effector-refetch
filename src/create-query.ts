import { is } from 'effector';
import { createBaseQuery } from './base-query';
import { wireTagInvalidation } from './invalidate';
import { cache, concurrency, debounce, fallback, retry } from './operators';
import type {
  CreateQueryConfig,
  CreateQueryConfigWithInitial,
  CreateQueryConfigWithInitialMapped,
  CreateQueryHandlerConfig,
  CreateQueryHandlerConfigWithInitial,
  CreateQueryHandlerConfigWithInitialMapped,
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
// `initialData` overloads come first: with initial data `$data` can never be null,
// so the query is typed `Query<..., Mapped, Mapped>` (farfetched-compatible).
// Dedicated interfaces (not `& { initialData }` intersections) keep the
// context-sensitive `mapData` inference intact, and the mapData/no-mapData split
// gives `Mapped` the right inference candidates: a bare `initialData: null` types
// against `Result` instead of collapsing the store type to `null`.
export function createQuery<Params, Result, Error = unknown, Mapped = Result>(
  config: CreateQueryConfigWithInitialMapped<Params, Result, Error, Mapped>,
): Query<Params, Result, Error, Mapped, Mapped>;
export function createQuery<Params, Result, Error = unknown>(
  config: CreateQueryConfigWithInitial<Params, Result, Error>,
): Query<Params, Result, Error, Result, Result>;
export function createQuery<Params, Result, Error = unknown, Mapped = Result>(
  config: CreateQueryHandlerConfigWithInitialMapped<Params, Result, Error, Mapped>,
): Query<Params, Result, Error, Mapped, Mapped>;
export function createQuery<Params, Result, Error = unknown>(
  config: CreateQueryHandlerConfigWithInitial<Params, Result, Error>,
): Query<Params, Result, Error, Result, Result>;
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
  // concurrency: a strategy (string | Store) or the object form { strategy?, key? }
  const cRaw = config.concurrency;
  const cObj = cRaw != null && typeof cRaw === 'object' && !is.store(cRaw) ? cRaw : null;
  // cObj null implies cRaw is not the object form, but TS can't see that through the ternary
  const c = cObj ? cObj.strategy : (cRaw as Exclude<typeof cRaw, { strategy?: unknown }>);
  const r = config.retry;
  const ca = config.cache;
  const to = config.timeout;
  const db = config.debounce;

  // collect reactive (sourced) stores from inline options
  const sourced: SourcedConfig = {};
  if (is.store(c)) sourced.strategy = c;
  if (r != null && typeof r === 'object' && is.store(r.times)) sourced.retryTimes = r.times;
  if (ca != null && typeof ca === 'object' && is.store(ca.staleAfter)) sourced.staleAfter = ca.staleAfter;
  if (is.store(to)) sourced.timeout = to;
  if (is.store(db)) sourced.debounce = db;

  // the mapped-config extras (`source` / `mapParams`) are read loosely by the engine
  const query = createBaseQuery<Params, Result, Error, Mapped>(
    config as CreateQueryConfig<Params, Result, Error, Mapped>,
    sourced,
  );

  // constants via the standalone operators; sourced stores already wired above.
  // An omitted strategy stays unset so the $queryDefaults layer can supply it.
  if (!is.store(c) && c != null) concurrency(query, { strategy: c });
  if (cObj?.key) concurrency(query, { key: cObj.key });
  if (r != null) retry(query, r);
  if (ca) cache(query, ca);
  if (typeof to === 'number') query.__.setTimeout(to);
  if (typeof db === 'number') debounce(query, db);
  if (config.fallback !== undefined) fallback(query, config.fallback);

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
