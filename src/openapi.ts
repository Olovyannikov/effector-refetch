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

export interface EffectorRefetchPluginConfig {
  name: 'effector-refetch';
  /** Generated file name (default: `'refetch'` -> `refetch.gen.ts`). */
  output?: string;
  /** Re-export the generated definitions from the output index file. Default: `false`. */
  exportFromIndex?: boolean;
}

export type EffectorRefetchPlugin = DefinePlugin<EffectorRefetchPluginConfig>;

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
