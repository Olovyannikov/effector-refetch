# Общие дефолты (фабрика запросов)

В effector-refetch нет глобального `QueryClient`. Вместо этого общую политику закладывают в
фабрику через `createQueryFactory` — опции конкретного вызова всегда переопределяют дефолты.

```ts
import { createQueryFactory } from 'effector-refetch';

const { createQuery, createMutation } = createQueryFactory({
  retry: 2,
  cache: { staleAfter: 30_000 },
  concurrency: 'TAKE_LATEST',
});

const todos = createQuery({ effect: fetchTodosFx }); // по умолчанию retry 2 + cache
const search = createQuery({ effect: searchFx, retry: 0 }); // переопределение: без ретраев
```

## Чтобы все запросы поллились

Тот самый кейс — одно место, где всем запросам задаётся интервал поллинга:

```ts
const { createQuery } = createQueryFactory({ refetchInterval: 30_000 });

const stats = createQuery({ effect: fetchStatsFx }); // поллит каждые 30с
const feed = createQuery({ effect: fetchFeedFx, refetchInterval: 5_000 }); // переопределили на 5с
```

См. рабочий пример [`examples/polling.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/polling.ts).

## Что несёт фабрика

Дефолты для query: `retry`, `cache`, `concurrency`, `refetchInterval`, `structuralSharing`,
`enabled`, `debug`. Мутации наследуют только `retry`, `concurrency`, `debug` (cache и
поллинг к записям не применяются).

Нужны разные политики по областям (например, `shared/api` и `internal/api`)? Просто создайте
несколько фабрик.

::: tip Почему не глобальный клиент?
effector децентрализован — god-object `QueryClient` противоречит модели. Фабрика даёт ту же
эргономику «дефолты в одном месте», при этом каждый запрос остаётся обычным тестируемым
юнитом effector.
:::

## Runtime-дефолты: `$queryDefaults`

Фабрика работает на **этапе создания**. `$queryDefaults` — обычный стор, который читается
в **момент запуска**, поэтому тесты и SSR меняют поведение per-scope, не пересобирая
запросы — fork-корректно по построению:

```ts
import { $queryDefaults, setQueryDefaults } from 'effector-refetch';
import { fork } from 'effector';

// per-scope: тесты / SSR
const scope = fork({ values: [[$queryDefaults, { timeout: 5_000, retry: 2 }]] });

// или патч работающего приложения (семантика merge)
setQueryDefaults({ retry: 1 });
```

Поддерживаемые ключи: `concurrency`, `retry` (количество; delay 0, промежуточные ошибки
подавляются), `staleAfter` (для кэшируемых запросов), `timeout`.

Приоритет (сверху вниз):

1. собственный конфиг query — инлайн-опция, `Store`-опция, standalone-оператор,
   **включая дефолты фабрики** (фабрика задаёт опции явно при создании);
2. `$queryDefaults`;
3. встроенные значения (`TAKE_LATEST`, без ретраев, `staleAfter: Infinity`, без таймаута).

Явное значение всегда выключает слой стора — например, `timeout: 0` отключает дедлайн,
даже если задан `$queryDefaults.timeout`. Мутации фиксируют `concurrency: 'TAKE_EVERY'`
при создании, так что `$queryDefaults.concurrency` их не трогает.

Классический сценарий: дать всем запросам ретраи и дедлайн в тестах, не касаясь кода
приложения, — одно значение в `fork` вместо N правок.
