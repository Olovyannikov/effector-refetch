import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import {
  createQuery,
  createRequestFx,
  RequestError,
  ValidationError,
  isRequestError,
  isHttpError,
  isTimeoutError,
  isValidationError,
} from '../src';

describe('error guards', () => {
  it('isRequestError narrows RequestError only', () => {
    expect(isRequestError(new RequestError('x'))).toBe(true);
    expect(isRequestError(new ValidationError(['bad'], null))).toBe(false);
    expect(isRequestError(new Error('plain'))).toBe(false);
    expect(isRequestError('nope')).toBe(false);
    expect(isRequestError(null)).toBe(false);
  });

  it('isValidationError narrows ValidationError only', () => {
    expect(isValidationError(new ValidationError(['bad'], null))).toBe(true);
    expect(isValidationError(new RequestError('x'))).toBe(false);
    expect(isValidationError(new Error('plain'))).toBe(false);
  });

  it('isHttpError checks status, a code, and a predicate', () => {
    const notFound = new RequestError('nf', { status: 404 });
    const server = new RequestError('boom', { status: 503 });
    const noStatus = new RequestError('offline'); // network error, no status

    expect(isHttpError(notFound)).toBe(true);
    expect(isHttpError(noStatus)).toBe(false);
    expect(isHttpError(notFound, 404)).toBe(true);
    expect(isHttpError(notFound, 500)).toBe(false);
    expect(isHttpError(server, (s) => s >= 500)).toBe(true);
    expect(isHttpError(notFound, (s) => s >= 500)).toBe(false);
    expect(isHttpError(new Error('plain'), 404)).toBe(false);
  });

  it('isTimeoutError matches the timeout reason marker', () => {
    expect(isTimeoutError(new RequestError('t', { reason: 'timeout' }))).toBe(true);
    expect(isTimeoutError(new RequestError('nf', { status: 404 }))).toBe(false);
    expect(isTimeoutError(new Error('plain'))).toBe(false);
  });

  it('narrows a real query $error (HTTP) end to end', async () => {
    // createRequestFx normalizes a thrown ofetch/axios-shaped error into RequestError
    const fx = createRequestFx(async () => {
      throw { message: 'Not found', response: { status: 404, data: { msg: 'nope' } } };
    });
    const q = createQuery({ effect: fx });
    const scope = fork();
    await allSettled(q.start, { scope, params: undefined });

    const error = scope.getState(q.$error);
    expect(isHttpError(error, 404)).toBe(true);
    expect(isTimeoutError(error)).toBe(false);
    expect(isValidationError(error)).toBe(false);
  });
});
