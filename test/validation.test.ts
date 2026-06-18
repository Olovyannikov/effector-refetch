import { describe, it, expect } from 'vitest';
import { allSettled, createEffect, fork } from 'effector';
import {
  createContract,
  createQuery,
  ioTsContract,
  runtypesContract,
  standardSchemaContract,
  ValidationError,
  zodContract,
} from '../src';

describe('validation', () => {
  it('contract: valid response passes through', async () => {
    const contract = createContract<{ id: number }>({
      isData: (raw) => typeof (raw as any)?.id === 'number',
    });
    const fx = createEffect(async () => ({ id: 1 }));
    const q = createQuery({ effect: fx, contract });
    const scope = fork();
    await allSettled(q.start, { scope });
    expect(scope.getState(q.$status)).toBe('done');
    expect(scope.getState(q.$data)).toEqual({ id: 1 });
  });

  it('contract: invalid response becomes a ValidationError', async () => {
    const contract = createContract<{ id: number }>({
      isData: (raw) => typeof (raw as any)?.id === 'number',
      getErrorMessages: () => ['id must be a number'],
    });
    const fx = createEffect(async () => ({ id: 'oops' }) as any);
    const q = createQuery({ effect: fx, contract });
    const scope = fork();
    await allSettled(q.start, { scope });
    expect(scope.getState(q.$status)).toBe('fail');
    const err = scope.getState(q.$error) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.validationErrors).toEqual(['id must be a number']);
    expect(scope.getState(q.$data)).toBeNull();
  });

  it('validate fn: false / string[] mark the response invalid', async () => {
    const fx = createEffect(async (n: number) => n);
    const q = createQuery({
      effect: fx,
      validate: ({ result }) => (result > 0 ? true : ['must be positive']),
    });
    const scope = fork();
    await allSettled(q.start, { scope, params: 5 });
    expect(scope.getState(q.$status)).toBe('done');

    await allSettled(q.start, { scope, params: -1 });
    expect(scope.getState(q.$status)).toBe('fail');
    expect((scope.getState(q.$error) as ValidationError).validationErrors).toEqual(['must be positive']);
  });

  it('zodContract works with a zod-like schema (structural)', async () => {
    // minimal zod-like stub
    const schema = {
      safeParse: (raw: unknown) =>
        typeof (raw as any)?.name === 'string'
          ? { success: true as const, data: raw as { name: string } }
          : {
              success: false as const,
              error: { issues: [{ path: ['name'], message: 'Expected string' }] },
            },
    };
    const contract = zodContract(schema);
    const fx = createEffect(async (ok: boolean) => (ok ? { name: 'Rick' } : { name: 42 }) as any);
    const q = createQuery({ effect: fx, contract });
    const scope = fork();

    await allSettled(q.start, { scope, params: true });
    expect(scope.getState(q.$data)).toEqual({ name: 'Rick' });

    await allSettled(q.start, { scope, params: false });
    expect((scope.getState(q.$error) as ValidationError).validationErrors).toEqual(['name: Expected string']);
  });

  it('standardSchemaContract works with a Standard Schema (sync)', async () => {
    const schema = {
      '~standard': {
        validate: (value: unknown) =>
          typeof value === 'number' ? { value } : { issues: [{ message: 'not a number' }] },
      },
    };
    const contract = standardSchemaContract<number>(schema);
    const fx = createEffect(async (ok: boolean) => (ok ? 7 : 'x') as any);
    const q = createQuery({ effect: fx, contract });
    const scope = fork();

    await allSettled(q.start, { scope, params: true });
    expect(scope.getState(q.$data)).toBe(7);

    await allSettled(q.start, { scope, params: false });
    expect((scope.getState(q.$error) as ValidationError).validationErrors).toEqual(['not a number']);
  });

  it('runtypesContract works with a runtypes-shaped validator', async () => {
    const rt = {
      validate: (raw: unknown) =>
        typeof (raw as { id?: unknown })?.id === 'number'
          ? { success: true as const, value: raw as { id: number } }
          : { success: false as const, message: 'Expected id: number' },
    };
    const q = createQuery({
      effect: createEffect(async (ok: boolean) => (ok ? { id: 1 } : { id: 'x' }) as any),
      contract: runtypesContract(rt),
    });
    const scope = fork();
    await allSettled(q.start, { scope, params: true });
    expect(scope.getState(q.$data)).toEqual({ id: 1 });
    await allSettled(q.start, { scope, params: false });
    expect((scope.getState(q.$error) as ValidationError).validationErrors).toEqual(['Expected id: number']);
  });

  it('ioTsContract works with an io-ts-shaped codec (Either)', async () => {
    const codec = {
      decode: (raw: unknown) =>
        typeof (raw as { id?: unknown })?.id === 'number'
          ? { _tag: 'Right' as const, right: raw as { id: number } }
          : { _tag: 'Left' as const, left: [{ context: [{ key: '' }, { key: 'id' }] }] },
    };
    const q = createQuery({
      effect: createEffect(async (ok: boolean) => (ok ? { id: 1 } : {}) as any),
      contract: ioTsContract(codec),
    });
    const scope = fork();
    await allSettled(q.start, { scope, params: true });
    expect(scope.getState(q.$data)).toEqual({ id: 1 });
    await allSettled(q.start, { scope, params: false });
    expect((scope.getState(q.$error) as ValidationError).validationErrors).toEqual(['Invalid value at id']);
  });

  it('@withease/contracts works directly as a contract (no adapter)', async () => {
    const { obj, num, str } = await import('@withease/contracts');
    // a withease Contract is { isData, getErrorMessages } — exactly our `contract` shape
    const User = obj({ id: num, name: str });
    const q = createQuery({
      effect: createEffect(async (ok: boolean) => (ok ? { id: 1, name: 'Rick' } : { id: 'x' }) as any),
      contract: User,
    });
    const scope = fork();

    await allSettled(q.start, { scope, params: true });
    expect(scope.getState(q.$status)).toBe('done');
    expect(scope.getState(q.$data)).toEqual({ id: 1, name: 'Rick' });

    await allSettled(q.start, { scope, params: false });
    expect(scope.getState(q.$status)).toBe('fail');
    const err = scope.getState(q.$error) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.validationErrors.length).toBeGreaterThan(0);
  });

  it('contract + validate compose — both run, contract first, first failure wins', async () => {
    const contract = createContract<{ n: number }>({
      isData: (raw) => typeof (raw as { n?: unknown })?.n === 'number',
      getErrorMessages: () => ['contract: not a number'],
    });
    const make = (value: unknown) =>
      createQuery({
        effect: createEffect(async () => value as { n: number }),
        contract,
        validate: ({ result }) => (result.n > 0 ? true : ['validate: not positive']),
      });

    // contract fails first -> its message (validate is not reached)
    let scope = fork();
    let q = make({ n: 'x' });
    await allSettled(q.start, { scope });
    expect((scope.getState(q.$error) as ValidationError).validationErrors).toEqual([
      'contract: not a number',
    ]);

    // contract passes, validate fails -> validate's message
    scope = fork();
    q = make({ n: -1 });
    await allSettled(q.start, { scope });
    expect((scope.getState(q.$error) as ValidationError).validationErrors).toEqual([
      'validate: not positive',
    ]);

    // both pass
    scope = fork();
    q = make({ n: 5 });
    await allSettled(q.start, { scope });
    expect(scope.getState(q.$status)).toBe('done');
    expect(scope.getState(q.$data)).toEqual({ n: 5 });
  });

  it('validation failures are retryable', async () => {
    let calls = 0;
    const fx = createEffect(async () => {
      calls++;
      return calls; // 1 (invalid), 2 (valid)
    });
    const q = createQuery({
      effect: fx,
      validate: ({ result }) => result >= 2,
      retry: { times: 3, delay: 0 },
    });
    const scope = fork();
    await allSettled(q.start, { scope });
    expect(calls).toBe(2);
    expect(scope.getState(q.$status)).toBe('done');
    expect(scope.getState(q.$data)).toBe(2);
  });

  it('evaluates the contract once per result (no re-parsing across branches)', async () => {
    let isDataCalls = 0;
    let messageCalls = 0;
    const contract = createContract<{ id: number }>({
      isData: (raw) => {
        isDataCalls++;
        return typeof (raw as any)?.id === 'number';
      },
      getErrorMessages: () => {
        messageCalls++;
        return ['bad'];
      },
    });

    // valid response -> isData once, messages never
    const ok = createQuery({ effect: createEffect(async () => ({ id: 1 })), contract });
    await allSettled(ok.start, { scope: fork() });
    expect(isDataCalls).toBe(1);
    expect(messageCalls).toBe(0);

    // invalid response -> isData once, messages once (not 3x isData)
    isDataCalls = 0;
    const bad = createQuery({ effect: createEffect(async () => ({ id: 'x' }) as any), contract });
    await allSettled(bad.start, { scope: fork() });
    expect(isDataCalls).toBe(1);
    expect(messageCalls).toBe(1);
  });
});
