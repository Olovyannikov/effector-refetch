# Кодогенерация из OpenAPI (hey-api / apicraft)

Если у бэкенда есть OpenAPI-спека, запросы можно не писать руками.
`effector-refetch/openapi` — плагин для [`@hey-api/openapi-ts`](https://heyapi.dev), который
генерирует готовые, полностью типизированные **`createQuery` для каждого GET** и
**`createMutation` для POST/PUT/PATCH/DELETE** — поверх `createRequestFx`, так что отмена
(`cancel` / `TAKE_LATEST`) действительно прерывает HTTP-запрос.

## Установка

```bash
npm i -D @hey-api/openapi-ts@0.82
```

::: warning Версия
Плагин рассчитан на plugin API линейки `0.82.x` `@hey-api/openapi-ts` (в более новых версиях
он изменился). Ровно эту линейку пинит и [apicraft](https://github.com/siberiacancode/core/tree/main/packages/apicraft).
:::

```ts
// openapi-ts.config.ts
import { defineConfig } from '@hey-api/openapi-ts';
import { defineConfig as effectorRefetch } from 'effector-refetch/openapi';

export default defineConfig({
  input: './openapi.json', // или URL
  output: './src/api',
  plugins: ['@hey-api/client-fetch', effectorRefetch()],
});
```

```bash
npx openapi-ts
```

## Что генерируется

Рядом с обычными для hey-api `types.gen.ts` / `sdk.gen.ts` появляется `refetch.gen.ts`:

```ts
// src/api/refetch.gen.ts (сгенерировано)
import { createRequestFx, createQuery, createMutation } from 'effector-refetch';
import { type Options, getPetById, addPet } from './sdk.gen';
import type { GetPetByIdData, AddPetData } from './types.gen';

/**
 * Query for `GET /pet/{petId}`
 * Find pet by ID.
 */
export const getPetByIdQuery = createQuery({
  name: 'getPetById',
  effect: createRequestFx((params: Options<GetPetByIdData>, { signal }: { signal: AbortSignal }) =>
    getPetById({ ...params, signal, throwOnError: true }).then((r) => r.data),
  ),
});

export const addPetMutation = createMutation({
  name: 'addPet',
  effect: createRequestFx((params: Options<AddPetData>, { signal }: { signal: AbortSignal }) =>
    addPet({ ...params, signal, throwOnError: true }).then((r) => r.data),
  ),
});
```

Важные детали:

- **Типы насквозь.** Параметры — это `Options<…Data>` из SDK (path/query/body из спеки),
  `$data` — тип ответа из спеки, без кастов.
- **Отменяемость.** `AbortSignal` текущего запуска передаётся в SDK-вызов, поэтому `cancel`,
  `TAKE_LATEST`, таймауты и отмена через `attachToRoute` прерывают реальный запрос.
- **Настоящие ошибки.** `throwOnError: true` превращает не-2xx-ответы в reject — их видят
  `$error` / `retry` / `fallback`.
- **Стабильные имена.** Каждый юнит получает `name: '<operationId>'` — неймспейсы кэша и метки
  в devtools стабильны без babel/SWC-плагина effector.
- **Ваша конфигурация работает как обычно.** Сгенерированные определения — обычные запросы,
  их можно дооснащать операторами:

```ts
import { retry, cache } from 'effector-refetch';
import { getPetByIdQuery } from './api/refetch.gen';

retry(getPetByIdQuery, { times: 3 });
cache(getPetByIdQuery, { staleAfter: 60_000 });
```

## Опции

```ts
effectorRefetch({
  output: 'refetch', // имя генерируемого файла -> refetch.gen.ts
  exportFromIndex: false, // реэкспорт из index.ts вывода
});
```

Query или mutation — решает хук `isQuery` самого hey-api (GET → query по умолчанию), включая
ваши переопределения через `~hooks.operations` в конфиге hey-api.

## Вместе с apicraft

[apicraft](https://github.com/siberiacancode/core/tree/main/packages/apicraft) — тонкая обёртка
над той же версией `@hey-api/openapi-ts`, поэтому сгенерированные `sdk.gen.ts` / `types.gen.ts`
идентичны — вывод плагина сочетается с API-слоем под управлением apicraft как есть. Пока
apicraft не поддерживает внешние плагины в своём конфиге, запускайте `openapi-ts` с этим
плагином рядом с ним (те же `input`/`output`).
