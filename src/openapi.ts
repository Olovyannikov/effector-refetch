/**
 * OpenAPI codegen plugin (`effector-refetch/openapi`).
 *
 * A [`@hey-api/openapi-ts`](https://heyapi.dev) plugin: for every operation in
 * the spec it generates a ready-made `createQuery` (GET) or `createMutation`
 * (POST/PUT/PATCH/DELETE) wrapping the generated SDK function through
 * `createRequestFx` — fully typed, abortable (the run's `AbortSignal` is passed
 * to the SDK call), with `throwOnError: true` so `$error` gets real errors.
 *
 *   // openapi-ts.config.ts
 *   import { defineConfig } from '@hey-api/openapi-ts';
 *   import { defineConfig as effectorRefetch } from 'effector-refetch/openapi';
 *
 *   export default defineConfig({
 *     input: './openapi.json',
 *     output: './src/api',
 *     plugins: ['@hey-api/client-fetch', effectorRefetch()],
 *   });
 *
 * Emits `src/api/refetch.gen.ts` with `<operationId>Query` / `<operationId>Mutation`
 * exports. Also compatible with wrappers over `@hey-api/openapi-ts` such as
 * apicraft (`@siberiacancode/apicraft`), which pin the same plugin API.
 *
 * Requires `@hey-api/openapi-ts@0.82.x` — later versions changed the plugin API.
 */
import { definePluginConfig, utils, type DefinePlugin } from '@hey-api/openapi-ts';

/** A value the generated file imports: `import { <name> } from '<module>'`. */
export interface CodeRef {
  /** Module specifier, as written in the generated file (a package or a path relative to it). */
  module: string;
  /** Exported name to import. */
  name: string;
}

/** What the `infinite` hooks get to look at. */
export interface InfiniteOperationContext {
  /** hey-api's operation IR (id, method, path, parameters, responses). */
  operation: { id: string; method: string; path: string; [key: string]: unknown };
  method: string;
  path: string;
  /** The cursor parameter picked for this operation, if any. */
  pageParam?: string;
}

type PerOperation<T> = T | ((ctx: InfiniteOperationContext) => T);

export interface InfiniteCodegenConfig {
  /**
   * Cursor advance rule. There is no way to derive it from a spec — "where the next
   * cursor lives in the response" is domain knowledge — so the generated file imports
   * yours: `getNextPageParam: { module: './pagination', name: 'byPageNumber' }`.
   */
  getNextPageParam: PerOperation<CodeRef>;
  /** Previous-page rule; enables `fetchPrevious` on the generated query. */
  getPreviousPageParam?: PerOperation<CodeRef | undefined>;
  /**
   * Which operations get an infinite twin. Default: query operations whose spec marks a
   * query parameter as a pagination cursor (`page`, `offset`, `cursor`, `after`, …).
   */
  match?: (ctx: InfiniteOperationContext) => boolean;
  /** Override the cursor parameter name (default: the one flagged in the spec). */
  pageParam?: PerOperation<string | undefined>;
  /**
   * First-page value, JSON-serialised into the generated file. Default by cursor name:
   * `page` -> `1`, `offset`/`start` -> `0`, anything else -> `null`.
   */
  initialPageParam?: PerOperation<unknown>;
  /** Suffix for the generated export. Default: `'InfiniteQuery'`. */
  suffix?: string;
}

export interface EffectorRefetchPluginConfig {
  name: 'effector-refetch';
  /** Generated file name (default: `'refetch'` -> `refetch.gen.ts`). */
  output?: string;
  /** Re-export the generated definitions from the output index file. Default: `false`. */
  exportFromIndex?: boolean;
  /**
   * Also emit a `createInfiniteQuery` for paginated operations. Off unless configured —
   * it needs a `getNextPageParam` from you.
   */
  infinite?: InfiniteCodegenConfig;
}

export type EffectorRefetchPlugin = DefinePlugin<EffectorRefetchPluginConfig>;

const resolve = <T>(value: PerOperation<T>, ctx: InfiniteOperationContext): T =>
  typeof value === 'function' ? (value as (c: InfiniteOperationContext) => T)(ctx) : value;

/** The spec's own pagination flag (hey-api marks `page` / `offset` / `cursor` / … itself). */
function paginationParamOf(operation: { parameters?: unknown }): string | undefined {
  const query = (operation.parameters as { query?: Record<string, { pagination?: unknown }> } | undefined)
    ?.query;
  if (!query) return undefined;
  return Object.keys(query).find((name) => query[name]?.pagination === true);
}

/** number for integer/number cursors, string for string ones, unknown when the spec is silent. */
function cursorTypeOf(operation: { parameters?: unknown }, pageParam: string): string {
  const query = (
    operation.parameters as { query?: Record<string, { schema?: { type?: string } }> } | undefined
  )?.query;
  const type = query?.[pageParam]?.schema?.type;
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'string') return 'string';
  return 'unknown';
}

/** `page` counts from 1, offsets from 0, opaque cursors start empty. */
function defaultInitialPageParam(pageParam: string): unknown {
  if (pageParam === 'page') return 1;
  if (pageParam === 'offset' || pageParam === 'start') return 0;
  return null;
}

export const handler: EffectorRefetchPlugin['Handler'] = ({ plugin }) => {
  const file = plugin.createFile({
    id: plugin.name,
    path: plugin.output,
    exportFromIndex: plugin.config.exportFromIndex,
  });

  const sdkModule = file.relativePathToFile({ context: plugin.context, id: 'sdk' });
  const typesModule = file.relativePathToFile({ context: plugin.context, id: 'types' });

  const createRequestFx = file.import({ module: 'effector-refetch', name: 'createRequestFx' }).name;
  // `Options<TData>` lives in sdk.gen — the SDK's wrapper around the client options.
  const optionsType = file.import({ module: sdkModule, name: 'Options', asType: true }).name;

  plugin.forEach('operation', (event) => {
    const { operation } = event;
    const isQuery = plugin.hooks.operation.isQuery(operation);

    const factory = file.import({
      module: 'effector-refetch',
      name: isQuery ? 'createQuery' : 'createMutation',
    }).name;
    const sdkFn = file.import({ module: sdkModule, name: operation.id }).name;
    const dataType = file.import({
      module: typesModule,
      name: `${utils.stringCase({ case: 'PascalCase', value: operation.id })}Data`,
      asType: true,
    }).name;

    const exportName = `${operation.id}${isQuery ? 'Query' : 'Mutation'}`;

    file.add(`
/**
 * ${isQuery ? 'Query' : 'Mutation'} for \`${event.method.toUpperCase()} ${event.path}\`${
   operation.summary ? `\n * ${operation.summary}` : ''
 }
 */
export const ${exportName} = ${factory}({
  name: '${operation.id}',
  effect: ${createRequestFx}((params: ${optionsType}<${dataType}>, { signal }: { signal: AbortSignal }) =>
    ${sdkFn}({ ...params, signal, throwOnError: true }).then((r) => r.data)),
});`);

    // ---- paginated twin ----
    const infinite = plugin.config.infinite;
    if (!infinite || !isQuery) return;

    const ctx: InfiniteOperationContext = {
      operation: operation as InfiniteOperationContext['operation'],
      method: event.method,
      path: event.path,
      pageParam: paginationParamOf(operation),
    };
    ctx.pageParam = infinite.pageParam ? resolve(infinite.pageParam, ctx) : ctx.pageParam;
    const matched = infinite.match ? infinite.match(ctx) : ctx.pageParam != null;
    if (!matched || !ctx.pageParam) return;

    const pageParam = ctx.pageParam;
    const next = resolve(infinite.getNextPageParam, ctx);
    const previous = infinite.getPreviousPageParam ? resolve(infinite.getPreviousPageParam, ctx) : undefined;
    const initial =
      infinite.initialPageParam !== undefined
        ? resolve(infinite.initialPageParam, ctx)
        : defaultInitialPageParam(pageParam);

    const createInfiniteQuery = file.import({ module: 'effector-refetch', name: 'createInfiniteQuery' }).name;
    const nextFn = file.import({ module: next.module, name: next.name }).name;
    const previousFn = previous ? file.import({ module: previous.module, name: previous.name }).name : null;
    // an opaque cursor starts empty, so the param type has to admit null — and the first
    // page must go out WITHOUT the cursor rather than with `?cursor=null`
    const nullable = initial === null;
    const cursorType = cursorTypeOf(operation, pageParam);
    const pageParamType = nullable ? `${cursorType} | null` : cursorType;
    const queryExpr = nullable
      ? `pageParam == null ? params.query : { ...params.query, ${pageParam}: pageParam }`
      : `{ ...params.query, ${pageParam}: pageParam }`;

    file.add(`
/**
 * Infinite query for \`${event.method.toUpperCase()} ${event.path}\` — pages by \`${pageParam}\`.${
   operation.summary ? `\n * ${operation.summary}` : ''
 }
 */
export const ${operation.id}${infinite.suffix ?? 'InfiniteQuery'} = ${createInfiniteQuery}({
  name: '${operation.id}.infinite',
  initialPageParam: ${JSON.stringify(initial) ?? 'null'} as ${pageParamType},
  getNextPageParam: ${nextFn},${previousFn ? `\n  getPreviousPageParam: ${previousFn},` : ''}
  effect: ${createRequestFx}((
    { params, pageParam }: { params: ${optionsType}<${dataType}>; pageParam: ${pageParamType} },
    { signal }: { signal: AbortSignal },
  ) =>
    ${sdkFn}({
      ...params,
      query: ${queryExpr},
      signal,
      throwOnError: true,
    }).then((r) => r.data)),
});`);
  });
};

export const defaultConfig: EffectorRefetchPlugin['Config'] = {
  config: { exportFromIndex: false },
  dependencies: ['@hey-api/sdk', '@hey-api/typescript'],
  handler,
  name: 'effector-refetch',
  output: 'refetch',
};

/** Use inside the `plugins` array of `@hey-api/openapi-ts` config. */
export const defineConfig = definePluginConfig(defaultConfig);
