# Зависимые запросы

Когда одному запросу нужен результат другого (получить персонажа, затем его локацию),
[`connectQuery`](/ru/api/queries) связывает их: при успехе **источника** он вычисляет параметры
**цели** и стартует её. Без `sample`-обвязки и без эффекта в компоненте.

## Один источник

```ts
import { createQuery, connectQuery } from 'effector-refetch';

const characterQuery = createQuery({ effect: fetchCharacterFx, cache: true });
const originQuery = createQuery({ effect: fetchLocationFx, cache: { staleAfter: 60_000 } });

connectQuery({
  source: characterQuery,
  fn: ({ result: character }) => ({ params: { url: character.origin.url } }),
  target: originQuery,
});

characterQuery.start(1); // originQuery стартует сам, когда персонаж загрузился
```

`fn` получает `{ result, params }` источника (результат и параметры, с которыми он отработал) и
возвращает `{ params }` для цели. Он пересчитывается на каждый успех источника, поэтому цель
остаётся в синхроне — и, поскольку обе — обычные запросы, `cache` / `retry` / `concurrency`
применяются к каждой независимо.

## Несколько источников

Передайте объект запросов — цель стартует, когда **все** в статусе `done`, и затем снова при любом
свежем результате любого из них:

```ts
connectQuery({
  source: { user: userQuery, settings: settingsQuery },
  fn: ({ user, settings }) => ({ params: { id: user.result.id, theme: settings.result.theme } }),
  target: dashboardQuery,
});
```

Каждый ключ в аргументе `fn` — это `{ result, params }` соответствующего источника.

## Гейт через `filter`

`filter` пропускает запуск цели, когда результат источника ещё не годится (та же форма
`{ result, params }`, верните `false` чтобы пропустить):

```ts
connectQuery({
  source: characterQuery,
  filter: ({ result: character }) => character.origin.url !== '', // неизвестная локация -> не грузим
  fn: ({ result: character }) => ({ params: { url: character.origin.url } }),
  target: originQuery,
});
```

## `connectQuery` vs `combineQueries`

- **`connectQuery`** — _цепочка_: источник кормит **параметры** следующего запроса (запрос B
  зависит от результата A).
- [**`combineQueries`**](/ru/api/queries) — _агрегация_: читать несколько независимых запросов как
  один общий `$data` / `$pending` / `$errors` (effector-вариант `useQueries`), без зависимости
  между ними.

Рабочий пример:
[`examples/rick-and-morty.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/rick-and-morty.ts).
