/**
 * Response validation: contracts (schema adapters) + a plain `validate` function.
 * A failed validation turns a "successful" response into a `ValidationError`.
 */

export interface Contract<Data> {
  /** True if `raw` matches the contract. */
  isData: (raw: unknown) => boolean;
  /** Human-readable messages when it doesn't. */
  getErrorMessages: (raw: unknown) => string[];
  /** Phantom marker for the validated type (not present at runtime). */
  readonly __data?: Data;
}

export class ValidationError extends Error {
  readonly validationErrors: string[];
  readonly value: unknown;
  constructor(messages: string[], value: unknown) {
    super(messages[0] ?? 'Response validation failed');
    this.name = 'ValidationError';
    this.validationErrors = messages;
    this.value = value;
  }
}

/** True if `e` is a {@link ValidationError} (a failed contract / `validate`). */
export function isValidationError(e: unknown): e is ValidationError {
  return e instanceof ValidationError;
}

/** Build a contract by hand. */
export function createContract<Data>(c: {
  isData: (raw: unknown) => boolean;
  getErrorMessages?: (raw: unknown) => string[];
}): Contract<Data> {
  return { isData: c.isData, getErrorMessages: c.getErrorMessages ?? (() => ['Invalid data']) };
}

// ---- zod ----

interface ZodLike<T> {
  safeParse: (
    raw: unknown,
  ) =>
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

/** Contract from a zod schema (structural — zod itself is not imported). */
export function zodContract<T>(schema: ZodLike<T>): Contract<T> {
  return {
    isData: (raw) => schema.safeParse(raw).success,
    getErrorMessages: (raw) => {
      const res = schema.safeParse(raw);
      if (res.success) return [];
      return res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    },
  };
}

// ---- Standard Schema (zod 3.24+, valibot, arktype, ...) ----

interface StandardResult<T> {
  value?: T;
  issues?: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> }>;
}
interface StandardSchemaV1<T> {
  '~standard': { validate: (value: unknown) => StandardResult<T> | Promise<StandardResult<T>> };
}

/** Contract from any Standard Schema (sync) — works with valibot, zod 3.24+, arktype. */
export function standardSchemaContract<T>(schema: StandardSchemaV1<T>): Contract<T> {
  const run = (raw: unknown): StandardResult<T> => {
    const r = schema['~standard'].validate(raw);
    if (r instanceof Promise) throw new TypeError('standardSchemaContract requires synchronous validation');
    return r;
  };
  return {
    isData: (raw) => !run(raw).issues,
    getErrorMessages: (raw) => (run(raw).issues ?? []).map((i) => i.message),
  };
}

// ---- runtypes ----

interface RuntypeLike<T> {
  validate: (raw: unknown) => { success: true; value: T } | { success: false; message: string };
}

/** Contract from a runtypes `Runtype` (structural — runtypes is not imported). */
export function runtypesContract<T>(rt: RuntypeLike<T>): Contract<T> {
  return {
    isData: (raw) => rt.validate(raw).success,
    getErrorMessages: (raw) => {
      const r = rt.validate(raw);
      return r.success ? [] : [r.message];
    },
  };
}

// ---- io-ts ----

interface IoTsLike<T> {
  decode: (
    raw: unknown,
  ) =>
    | { _tag: 'Right'; right: T }
    | { _tag: 'Left'; left: ReadonlyArray<{ message?: string; context?: ReadonlyArray<{ key: string }> }> };
}

/** Contract from an io-ts codec (structural — reads the Either, no fp-ts import). */
export function ioTsContract<T>(codec: IoTsLike<T>): Contract<T> {
  return {
    isData: (raw) => codec.decode(raw)._tag === 'Right',
    getErrorMessages: (raw) => {
      const r = codec.decode(raw);
      if (r._tag === 'Right') return [];
      return r.left.map(
        (e) =>
          e.message ??
          `Invalid value at ${
            (e.context ?? [])
              .map((c) => c.key)
              .filter(Boolean)
              .join('.') || '(root)'
          }`,
      );
    },
  };
}

// ---- superstruct ----

interface SuperstructLike<T> {
  validate: (
    raw: unknown,
  ) => [
    (
      | { message: string; failures?: () => Iterable<{ path: Array<string | number>; message: string }> }
      | undefined
    ),
    T | undefined,
  ];
}

/** Contract from a superstruct Struct (structural — reads `[error, value]`, no import). */
export function superstructContract<T>(struct: SuperstructLike<T>): Contract<T> {
  return {
    isData: (raw) => struct.validate(raw)[0] === undefined,
    getErrorMessages: (raw) => {
      const [error] = struct.validate(raw);
      if (!error) return [];
      const failures = error.failures ? [...error.failures()] : [];
      if (failures.length === 0) return [error.message];
      return failures.map((f) => {
        const path = f.path.join('.');
        return path ? `${path}: ${f.message}` : f.message;
      });
    },
  };
}

// ---- typed-contracts ----

/** A typed-contracts validator: returns the value or a `ValidationError` (an `Error`). */
type TypedContractLike<T> = (valueName: string, value: unknown) => T | Error;

/** Contract from a typed-contracts validator (structural — detects the returned `Error`). */
export function typedContract<T>(contract: TypedContractLike<T>): Contract<T> {
  return {
    isData: (raw) => !(contract('response', raw) instanceof Error),
    getErrorMessages: (raw) => {
      const result = contract('response', raw);
      return result instanceof Error ? [result.message] : [];
    },
  };
}
