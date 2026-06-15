import { createEffect } from 'effector';
import type { AbortableEffect } from './types';

export interface RequestContext {
  /**
   * AbortSignal for the request. Pass it to your HTTP client (ofetch/axios).
   * The query owns the controller and aborts it on `cancel` / `reset` and when
   * a TAKE_LATEST request is superseded — so this signal fires for real.
   */
  signal: AbortSignal;
}

/** Normalized request error: works across ofetch (FetchError) and axios (AxiosError). */
export class RequestError extends Error {
  readonly status?: number;
  readonly data?: unknown;
  readonly reason?: unknown;

  constructor(message: string, init?: { status?: number; data?: unknown; reason?: unknown }) {
    super(message);
    this.name = 'RequestError';
    this.status = init?.status;
    this.data = init?.data;
    this.reason = init?.reason;
  }
}

/** True if `e` is a normalized {@link RequestError}. */
export function isRequestError(e: unknown): e is RequestError {
  return e instanceof RequestError;
}

/**
 * True if `e` is an HTTP {@link RequestError} (carries a `status`). Optionally
 * match a specific code or a predicate:
 *
 *   isHttpError(e)          // any error with a status
 *   isHttpError(e, 404)     // exactly 404
 *   isHttpError(e, (s) => s >= 500) // any 5xx
 */
export function isHttpError(e: unknown, status?: number | ((status: number) => boolean)): e is RequestError {
  if (!(e instanceof RequestError) || e.status == null) return false;
  if (status == null) return true;
  return typeof status === 'function' ? status(e.status) : e.status === status;
}

/** True if `e` is a {@link RequestError} produced by a `timeout` (aborted past its deadline). */
export function isTimeoutError(e: unknown): e is RequestError {
  return e instanceof RequestError && e.reason === 'timeout';
}

export function normalizeRequestError(err: unknown): RequestError {
  if (err instanceof RequestError) return err;
  const e = err as {
    message?: string;
    status?: number;
    statusCode?: number;
    data?: unknown;
    response?: { status?: number; data?: unknown };
  };
  const status = e?.response?.status ?? e?.status ?? e?.statusCode;
  const data = e?.response?.data ?? e?.data;
  const message = e?.message ?? 'Request failed';
  return new RequestError(message, { status, data, reason: err });
}

export interface CreateRequestFxOptions {
  name?: string;
  /** Normalize thrown errors into `RequestError` (default: true). */
  normalizeErrors?: boolean;
}

/**
 * Typed request-effect factory. Wrap any HTTP client into an effector Effect:
 *
 *   const getUserFx = createRequestFx<{ id: number }, User>(
 *     ({ id }, { signal }) => ofetch(`/api/users/${id}`, { signal }),
 *   );
 *   const userQuery = createQuery({ effect: getUserFx, cache: true });
 *
 * The resulting effect is a first-class effector unit — visible in devtools,
 * composable with `attach`, and usable as `createQuery({ effect })` /
 * `createMutation({ effect })`.
 */
export function createRequestFx<Params = void, Response = unknown>(
  handler: (params: Params, ctx: RequestContext) => Promise<Response> | Response,
  options: CreateRequestFxOptions = {},
): AbortableEffect<Params, Response, RequestError> {
  const { normalizeErrors = true, name } = options;
  // The query supplies the AbortSignal per run, so cancellation is real.
  const requestFx = createEffect<{ params: Params; signal: AbortSignal }, Response, RequestError>({
    name,
    handler: async ({ params, signal }) => {
      try {
        return await handler(params, { signal });
      } catch (err) {
        throw normalizeErrors ? normalizeRequestError(err) : (err as RequestError);
      }
    },
  });
  return Object.assign(requestFx, { __abortable: true as const });
}
