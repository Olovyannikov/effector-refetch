import { attach, is, type Store } from 'effector';
import { createRequestFx, RequestError } from './request';
import { createQuery } from './create-query';
import { createMutation } from './create-mutation';
import type {
  AbortableEffect,
  CacheConfig,
  ConcurrencyStrategy,
  Mutation,
  Query,
  RetryConfig,
} from './types';
import type { Contract } from './validation';

export const HTTP_METHODS = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
} as const;
export type HttpMethod = (typeof HTTP_METHODS)[keyof typeof HTTP_METHODS];

type QueryValue = string | number | boolean | null | undefined;

/**
 * A request field derived from `params`, a reactive `Store` (read fork-correctly
 * per scope), or `{ source, fn }` to combine a store with params. Stores/`{source}`
 * are wired through `attach` so SSR/`fork` is honored. (A static value is allowed
 * for `url` directly.)
 */
export type Sourced<T, Params> =
  | ((params: Params) => T)
  | Store<T>
  | { source: Store<any>; fn: (source: any, params: Params) => T };

export interface JsonRequest<Params> {
  url: string | Sourced<string, Params>;
  method?: HttpMethod;
  query?: Sourced<Record<string, QueryValue | QueryValue[]>, Params>;
  body?: Sourced<unknown, Params>;
  headers?: Sourced<Record<string, string>, Params>;
}

export interface CreateJsonQueryConfig<Params, Response, Mapped = Response> {
  request: JsonRequest<Params>;
  response?: { contract?: Contract<Response> };
  /** Reshape the (validated) response before it lands in `$data` — same as `createQuery`'s. */
  mapData?: (ctx: { result: Response; params: Params }) => Mapped;
  /** Custom validation: return true/void = ok, false or string[] = invalid — same as `createQuery`'s. */
  validate?: (ctx: { result: Response; params: Params }) => boolean | string[] | void;
  concurrency?: ConcurrencyStrategy | Store<ConcurrencyStrategy>;
  retry?: number | RetryConfig<RequestError>;
  cache?: boolean | CacheConfig<Params>;
  enabled?: Store<boolean>;
  initialData?: Mapped;
  name?: string;
}

function buildQueryString(query: Record<string, QueryValue | QueryValue[]>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v != null) sp.append(key, String(v));
    } else {
      sp.append(key, String(value));
    }
  }
  return sp.toString();
}

type SourcedObj<P> = { source: Store<unknown>; fn: (source: unknown, params: P) => unknown };
const isSourcedObj = <P>(v: unknown): v is SourcedObj<P> =>
  typeof v === 'object' && v != null && 'source' in v && is.store((v as SourcedObj<P>).source);

/** Resolve a request field for one run, given params and the (scoped) source value. */
function resolveField<T, P>(field: unknown, params: P, srcValue: unknown): T | undefined {
  if (field == null) return undefined;
  if (is.store(field)) return srcValue as T;
  if (isSourcedObj<P>(field)) return field.fn(srcValue, params) as T;
  if (typeof field === 'function') return (field as (p: P) => T)(params);
  return field as T; // static value (e.g. a string `url`)
}

const FIELDS = ['url', 'query', 'body', 'headers'] as const;

/**
 * Build an abort-aware request effect from a declarative `request` config. Each
 * field may be sourced from a `Store` (resolved fork-correctly via `attach`).
 * Shared by `createJsonQuery` and `createJsonMutation`.
 */
function buildRequestEffect<Params, Response>(
  request: JsonRequest<Params>,
  method: HttpMethod,
  name?: string,
): AbortableEffect<Params, Response, RequestError> {
  // collect the Store dependencies referenced by the request fields
  const sources: Record<string, Store<unknown>> = {};
  for (const fieldName of FIELDS) {
    const f = request[fieldName] as unknown;
    if (is.store(f)) sources[fieldName] = f;
    else if (isSourcedObj(f)) sources[fieldName] = (f as SourcedObj<Params>).source;
  }
  const hasSources = Object.keys(sources).length > 0;

  // shared per-run logic: build the URL/headers/body and fetch
  const run = async (
    params: Params,
    src: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Response> => {
    const base = resolveField(request.url, params, src.url) as string;
    const qObj = resolveField(request.query, params, src.query) as
      | Record<string, QueryValue | QueryValue[]>
      | undefined;
    const qs = qObj ? buildQueryString(qObj) : '';
    const url = qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base;

    const hasBody = request.body != null && method !== 'GET' && method !== 'DELETE';
    const bodyVal = hasBody ? resolveField(request.body, params, src.body) : undefined;
    const headers: Record<string, string> = {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(resolveField(request.headers, params, src.headers) as Record<string, string> | undefined),
    };

    const res = await fetch(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(bodyVal) : undefined,
      signal,
    });
    if (!res.ok) {
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        /* non-JSON error body */
      }
      throw new RequestError(`HTTP ${res.status} ${res.statusText}`.trim(), { status: res.status, data });
    }
    return (await res.json()) as Response;
  };

  if (!hasSources) {
    return createRequestFx<Params, Response>((params, { signal }) => run(params, {}, signal), { name });
  }

  // attach injects the scoped source values at call time → fork-correct; the
  // AbortSignal flows through the side channel, so plain attach keeps cancellation
  const baseFx = createRequestFx<{ params: Params; src: Record<string, unknown> }, Response>(
    ({ params, src }, { signal }) => run(params, src, signal),
    { name },
  );
  const attachedFx = attach({
    source: sources,
    mapParams: (params: Params, src: Record<string, unknown>) => ({ params, src }),
    effect: baseFx,
  });
  return Object.assign(attachedFx, { __abortable: true as const }) as unknown as AbortableEffect<
    Params,
    Response,
    RequestError
  >;
}

/**
 * Declarative request **effect** over the global `fetch` — the reusable building
 * block behind `createJsonQuery` / `createJsonMutation`. Same `request` shape
 * (sourced fields included), abort-aware, normalized `RequestError`; returns an
 * effect you can pass anywhere (`createQuery` / `createMutation` /
 * `createInfiniteQuery` / `connectQuery`) instead of hand-writing `createRequestFx`.
 *
 *   const getUserFx = createJsonRequestFx<{ id: number }, User>({
 *     url: ({ id }) => `/api/users/${id}`,
 *   });
 */
export function createJsonRequestFx<Params = void, Response = unknown>(
  request: JsonRequest<Params>,
  options: { name?: string } = {},
): AbortableEffect<Params, Response, RequestError> {
  return buildRequestEffect<Params, Response>(request, request.method ?? 'GET', options.name);
}

/**
 * Declarative JSON query over the global `fetch` (no HTTP-client dependency).
 * Builds an abort-aware request effect + a validated query in one call. Each
 * request field may be sourced from a `Store` (fork-correct):
 *
 *   const usersQuery = createJsonQuery({
 *     request: {
 *       url: ({ id }) => `/api/users/${id}`,
 *       headers: { source: $token, fn: (token) => ({ authorization: `Bearer ${token}` }) },
 *     },
 *     response: { contract: zodContract(UserSchema) },
 *   });
 */
// with `initialData` the `$data` store can never be null (farfetched-compatible typing)
export function createJsonQuery<Params = void, Response = unknown, Mapped = Response>(
  config: CreateJsonQueryConfig<Params, Response, Mapped> & { initialData: Mapped },
): Query<Params, Response, RequestError, Mapped, Mapped>;
export function createJsonQuery<Params = void, Response = unknown, Mapped = Response>(
  config: CreateJsonQueryConfig<Params, Response, Mapped>,
): Query<Params, Response, RequestError, Mapped>;
export function createJsonQuery<Params = void, Response = unknown, Mapped = Response>(
  config: CreateJsonQueryConfig<Params, Response, Mapped>,
): Query<Params, Response, RequestError, Mapped> {
  const method = config.request.method ?? 'GET';
  const effectFx = buildRequestEffect<Params, Response>(config.request, method, config.name);

  return createQuery<Params, Response, RequestError, Mapped>({
    effect: effectFx,
    contract: config.response?.contract,
    mapData: config.mapData,
    validate: config.validate,
    concurrency: config.concurrency,
    retry: config.retry,
    cache: config.cache,
    enabled: config.enabled,
    initialData: config.initialData,
    name: config.name,
  });
}

export interface CreateJsonMutationConfig<Params, Response, Mapped = Response> {
  request: JsonRequest<Params>;
  response?: { contract?: Contract<Response> };
  /** Reshape the (validated) response before it lands in `$data` — same as `createMutation`'s. */
  mapData?: (ctx: { result: Response; params: Params }) => Mapped;
  /** Custom validation: return true/void = ok, false or string[] = invalid — same as `createMutation`'s. */
  validate?: (ctx: { result: Response; params: Params }) => boolean | string[] | void;
  concurrency?: ConcurrencyStrategy | Store<ConcurrencyStrategy>;
  retry?: number | RetryConfig<RequestError>;
  name?: string;
}

/**
 * Declarative JSON mutation — the write-side mirror of `createJsonQuery`. Same
 * `request` shape (sourced fields included), defaults to `POST`, returns a
 * `Mutation` (no cache / refresh / stale).
 *
 *   const createUser = createJsonMutation<NewUser, User>({
 *     request: { url: 'https://api/users', body: (u) => u },
 *   });
 *   invalidate({ on: createUser, refetch: usersQuery });
 */
export function createJsonMutation<Params = void, Response = unknown, Mapped = Response>(
  config: CreateJsonMutationConfig<Params, Response, Mapped>,
): Mutation<Params, Response, RequestError, Mapped> {
  const method = config.request.method ?? 'POST';
  const effectFx = buildRequestEffect<Params, Response>(config.request, method, config.name);

  return createMutation<Params, Response, RequestError, Mapped>({
    effect: effectFx,
    contract: config.response?.contract,
    mapData: config.mapData,
    validate: config.validate,
    concurrency: config.concurrency,
    retry: config.retry,
    name: config.name,
  });
}
