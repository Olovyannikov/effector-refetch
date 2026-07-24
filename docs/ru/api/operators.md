# Операторы

Каждая inline-опция `createQuery` — это сахар над **standalone-оператором**. Импортируй и применяй
к любому query/mutation (в т.ч. созданному в другом месте). Композируемы и tree-shakeable.

```ts
import { concurrency, retry, cache, timeout, keepFresh, applyBarrier } from 'effector-refetch';
```

## `concurrency`

Поведение пересекающихся прогонов: `TAKE_LATEST` (по умолчанию), `TAKE_FIRST`, `TAKE_EVERY`.

```ts
concurrency(searchQuery, { strategy: 'TAKE_LATEST' }); // новый прогон отменяет предыдущий
```

Добавьте **ключ полосы** (lane), чтобы прогоны конкурировали только с прогонами того же
ключа — обновление одной строки таблицы больше не отменяет соседние:

```ts
concurrency(rowQuery, { strategy: 'TAKE_LATEST', key: ({ rowId }) => String(rowId) });
```

Вытеснение (`TAKE_LATEST`) и отбрасывание при занятости (`TAKE_FIRST`) действуют **внутри
полосы**; `cancel` / `reset` по-прежнему затрагивают все полосы. `$data` у query остаётся
один — полосы разделяют отмену, а не данные (последний завершившийся прогон записывает
стор; данные по ключу храните в кэшируемом query с ключом из params).

Попробуйте вживую — три слота покедекса поверх настоящего PokeAPI, каждый слот — полоса:

<LanesDemo>
<template #code>

```ts
import { createQuery, createRequestFx } from 'effector-refetch';

const fetchPokemonFx = createRequestFx(async ({ slot, id }: { slot: number; id: number }, { signal }) => {
  const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { slot, id, name: data.name, sprite: data.sprites.front_default };
});

const pokedexQuery = createQuery({
  effect: fetchPokemonFx,
  // полоса на слот: обновление слота 2 не прерывает запрос слота 1
  concurrency: { strategy: 'TAKE_LATEST', key: ({ slot }) => String(slot) },
});

pokedexQuery.aborted.watch(({ params, reason }) => {
  // reason: 'superseded' | 'cancelled' | 'take-first-busy' | 'disabled'
  console.log(`слот ${params.slot} отброшен: ${reason}`);
});

pokedexQuery.start({ slot: 1, id: 25 }); // pikachu
pokedexQuery.start({ slot: 2, id: 1 }); //  bulbasaur — слот 1 не тронут
pokedexQuery.start({ slot: 2, id: 4 }); //  charmander — вытесняет ТОЛЬКО bulbasaur
```

</template>
</LanesDemo>

Запускаемый скрипт: [`examples/concurrency-lanes.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/concurrency-lanes.ts).

## `retry`

`retry(query, 3)` или конфиг. Каждая попытка — реальный вызов эффекта; `filter` решает, какие сбои
ретраить, `suppressIntermediateErrors` держит `$error` чистым до финальной попытки.

```ts
import { exponentialDelay } from 'effector-refetch';

retry(userQuery, {
  times: 3,
  delay: exponentialDelay(200),
  filter: ({ error }) => (error as RequestError).status !== 404, // не ретраить 404
});
```

## `cache`

`cache(query)` (in-memory) или конфиг (adapter / `staleAfter` / `key` / `swr` / `dedupe` / `purge`).

```ts
cache(productsQuery, { staleAfter: 30_000, swr: true, purge: loggedOut });
```

## `timeout`

Дедлайн одной попытки (мс): прерывает запрос в полёте и **роняет** прогон (ретраябельно), если
превышен. `0` — выкл. Не путать с `refetchInterval` (частота поллинга).

```ts
timeout(reportQuery, 5000); // сдаёмся на одной попытке через 5с
```

## `keepFresh`

Рефетчит запрос его **последними параметрами** при изменении стора-`source` **или** при срабатывании
`@@trigger` — свежесть по зависимости (фильтры, локаль, пользователь, успешная мутация, ping по
websocket). No-op до первого запуска и пока disabled.

```ts
keepFresh(productsQuery, { source: $filters }); // или source: [$filters, $locale]

// triggers: что угодно с протоколом @@trigger или обычный effector Event
keepFresh(productsQuery, { triggers: [createProductMutation, tabFocused] });
```

`triggers` принимает наши же query/mutation (они реализуют `@@trigger` — `fired` = `finished.done`),
триггеры web-API из [withease](https://withease.effector.dev/), совместимые с farfetched триггеры
или сырой `Event`. У каждого триггера `setup` дёргается один раз при подключении и остаётся активным
на всё время жизни приложения.

## Протокол `@@trigger`

Каждый query и mutation **является** [`@@trigger`](https://withease.effector.dev/protocols/trigger.html):
`query['@@trigger']()` возвращает `{ fired, setup, teardown }`, где `fired` — это `finished.done`.
Поэтому запрос можно отдавать в `keepFresh({ triggers })` **самого farfetched** (и наоборот), либо в
любого потребителя протокола:

```ts
import { keepFresh } from '@farfetched/core';

keepFresh(someFarfetchedQuery, { triggers: [ourQuery] }); // ourQuery успешен → farfetched рефетчит
```

`isTrigger(x)` сужает тип к протоколу. Наши юниты — always-on триггеры: `setup`/`teardown` есть для
совместимости с протоколом, но не гейтят срабатывание (запрос живёт своим scoped-жизненным циклом).

## `applyBarrier`

Навешивает на готовый query/mutation [barrier](/ru/recipes/auth-barrier) (например 401 → обновить
токен → продолжить). `null` — отвязать.

```ts
const auth = createBarrier({ perform: refreshTokenFx });
applyBarrier(userQuery, auth);
```

## Повторное применение оператора

Два чётко определённых поведения, по типу оператора:

- **Last-wins** — `concurrency` / `retry` / `cache` / `timeout` / `applyBarrier` это engine-_сеттеры_:
  второй вызов **заменяет** первый. `retry(q, 1); retry(q, 3)` ⇒ 3 ретрая; `applyBarrier(q, null)`
  отвязывает.
- **Аддитивно** — `keepFresh` / `invalidate` / `update` _добавляют проводку_ на каждый вызов: два
  зарегистрированных `keepFresh`-источника — рефетч на изменение **любого** из них.

Это намеренно и покрыто тестом (`test/multi-operators.test.ts`) — last-wins для одно-значных
конфиг-ручек, аддитивно для тех, что регистрируют реакции.

---

Всё это эквивалентно соответствующей опции `createQuery({ … })` — выбирай, что читается лучше.
Рабочий пример: [`examples/operators.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/operators.ts).
