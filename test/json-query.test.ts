import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { allSettled, fork } from 'effector';
import { createContract, createJsonQuery, RequestError, ValidationError } from '../src';

const fakeRes = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  json: async () => body,
});

let lastUrl = '';
let lastInit: RequestInit | undefined;
const originalFetch = globalThis.fetch;

function stub(status: number, body: unknown) {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    lastUrl = String(url);
    lastInit = init;
    return fakeRes(status, body) as unknown as Response;
  }) as typeof fetch;
}

describe('createJsonQuery', () => {
  beforeEach(() => {
    lastUrl = '';
    lastInit = undefined;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('GET: builds url + query string and returns json', async () => {
    stub(200, [{ id: 1 }]);
    const q = createJsonQuery<{ q: string }, { id: number }[]>({
      request: {
        url: 'https://api.test/products',
        query: ({ q }) => ({ search: q, limit: 10 }),
      },
    });
    const scope = fork();
    await allSettled(q.start, { scope, params: { q: 'phone' } });

    expect(lastUrl).toContain('https://api.test/products?');
    expect(lastUrl).toContain('search=phone');
    expect(lastUrl).toContain('limit=10');
    expect(scope.getState(q.$data)).toEqual([{ id: 1 }]);
    expect(scope.getState(q.$status)).toBe('done');
  });

  it('url as a function of params', async () => {
    stub(200, { id: 7 });
    const q = createJsonQuery<{ id: number }, { id: number }>({
      request: { url: ({ id }) => `https://api.test/users/${id}` },
    });
    const scope = fork();
    await allSettled(q.start, { scope, params: { id: 7 } });
    expect(lastUrl).toBe('https://api.test/users/7');
  });

  it('POST: sends a JSON body and content-type', async () => {
    stub(200, { id: 1, name: 'Rick' });
    const q = createJsonQuery<{ name: string }, { id: number; name: string }>({
      request: { url: 'https://api.test/users', method: 'POST', body: (p) => p },
    });
    const scope = fork();
    await allSettled(q.start, { scope, params: { name: 'Rick' } });

    expect(lastInit?.method).toBe('POST');
    expect(JSON.parse(String(lastInit?.body))).toEqual({ name: 'Rick' });
    expect((lastInit?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('non-2xx -> RequestError with status and parsed body', async () => {
    stub(404, { message: 'not found' });
    const q = createJsonQuery({ request: { url: 'https://api.test/x' } });
    const scope = fork();
    await allSettled(q.start, { scope });

    expect(scope.getState(q.$status)).toBe('fail');
    const err = scope.getState(q.$error) as RequestError;
    expect(err).toBeInstanceOf(RequestError);
    expect(err.status).toBe(404);
    expect(err.data).toEqual({ message: 'not found' });
  });

  it('mapData reshapes the response before $data; validate rejects bad payloads', async () => {
    stub(200, { user: { id: 1, name: 'ada' }, ok: true });
    const q = createJsonQuery<void, { user: { id: number; name: string }; ok: boolean }, string>({
      request: { url: 'https://api.test/me' },
      mapData: ({ result }) => result.user.name,
      validate: ({ result }) => result.ok || ['not ok'],
    });
    const scope = fork();
    await allSettled(q.start, { scope });
    expect(scope.getState(q.$data)).toBe('ada'); // Mapped type, not the raw response

    stub(200, { user: { id: 1, name: 'ada' }, ok: false });
    await allSettled(q.refresh, { scope });
    expect(scope.getState(q.$status)).toBe('fail');
    expect((scope.getState(q.$error) as ValidationError).validationErrors).toEqual(['not ok']);
  });

  it('validates the response with a contract', async () => {
    stub(200, { id: 'bad' });
    const q = createJsonQuery<void, { id: number }>({
      request: { url: 'https://api.test/x' },
      response: {
        contract: createContract<{ id: number }>({
          isData: (raw) => typeof (raw as any)?.id === 'number',
          getErrorMessages: () => ['id must be a number'],
        }),
      },
    });
    const scope = fork();
    await allSettled(q.start, { scope });
    expect(scope.getState(q.$status)).toBe('fail');
    expect((scope.getState(q.$error) as ValidationError).validationErrors).toEqual(['id must be a number']);
  });
});
