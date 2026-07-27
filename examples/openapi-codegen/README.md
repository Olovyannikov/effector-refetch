# OpenAPI codegen example

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Olovyannikov/effector-refetch/tree/main/examples/openapi-codegen?file=main.ts)

Queries and mutations generated from an OpenAPI spec by the
[`effector-refetch/openapi`](https://olovyannikov.github.io/effector-refetch/recipes/openapi)
plugin for [`@hey-api/openapi-ts`](https://heyapi.dev).

- `petstore.json` — a mini subset of the official petstore3 spec (live sandbox server)
- `openapi-ts.config.ts` — hey-api config with the `effector-refetch` plugin
- `src/api/` — **generated** output (committed so the example typechecks): hey-api's
  `types.gen.ts` / `sdk.gen.ts` / client, plus our `refetch.gen.ts` with
  `findPetsByStatusQuery`, `getPetByIdQuery`, `addPetMutation`
- `main.ts` — uses the generated units against the live server

```bash
# run the demo (from the repo root)
npx tsx examples/openapi-codegen/main.ts

# regenerate src/api after editing the spec (the config imports the built plugin)
pnpm build
cd examples/openapi-codegen && npx openapi-ts
```
