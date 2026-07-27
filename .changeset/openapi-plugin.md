---
'effector-refetch': minor
---

New `effector-refetch/openapi` subpath: a `@hey-api/openapi-ts` (0.82.x) plugin that generates a
fully typed `createQuery` for every GET operation and `createMutation` for every other method —
wired through `createRequestFx` (real AbortSignal forwarded to the SDK call, `throwOnError: true`
so `$error` sees real errors) with stable `name: '<operationId>'` for cache namespaces and
devtools. Compatible with apicraft, which pins the same hey-api line.

```ts
// openapi-ts.config.ts
import { defineConfig } from '@hey-api/openapi-ts';
import { defineConfig as effectorRefetch } from 'effector-refetch/openapi';

export default defineConfig({
  input: './openapi.json',
  output: './src/api',
  plugins: ['@hey-api/client-fetch', effectorRefetch()],
});
```
