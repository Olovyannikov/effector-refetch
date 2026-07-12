# Сравнение с farfetched

[farfetched](https://ff.effector.dev) — самый полный инструмент для запросов в effector и
очевидная точка отсчёта. Он зрелый, хорошо спроектирован и **open-source / не заархивирован**.
Это честное сравнение — включая то, **где farfetched всё ещё впереди**, — чтобы вы выбрали
подходящий инструмент, а не повелись на рекламу.

Разница в одну строку: farfetched моделирует запрос как **собственную event-абстракцию**
(`RemoteOperation` из `handler`); effector-refetch оборачивает **ваш реальный `Effect`** и даёт
дружелюбный inline-конфиг. Разная философия, много пересечений.

## Где farfetched всё ещё впереди

Учтите это перед переходом:

- **Зрелость и экосистема.** Годы в проде, больше сообщество, больше накопленных рецептов и фиксов
  краевых случаев. effector-refetch пока молодой (0.x).
- **Sourced-параметры везде.** В farfetched почти _любое_ поле _любого_ оператора может быть
  `Store`/source. effector-refetch делает sourced поля декларативного HTTP (`url` / `query` / `body`
  / `headers` в `createJsonQuery` / `createJsonMutation`) плюс выборочный конфиг — `enabled`,
  `concurrency`, `retry.times`, `cache.staleAfter`, `refetchInterval`, `timeout`, — а остальное
  ожидает из параметров эффекта (обычно через `sample`). Ближе, чем было, но всё ещё уже.
- **Пара именованных адаптеров валидации.** farfetched даёт отдельные
  `@farfetched/{runtypes,io-ts,superstruct,typed-contracts,zod}`. effector-refetch теперь покрывает
  `runtypesContract`, `ioTsContract`, `zodContract`, плюс `standardSchemaContract` (любая
  Standard-Schema библиотека — valibot, arktype, zod 4, …), `@withease/contracts` (работает
  нативно — та же форма `Contract`, без адаптера) и `createContract`. Остаются именно
  **superstruct** и **typed-contracts** (достижимы через Standard Schema там, где он поддержан).

## Чем effector-refetch отличается (и часто удобнее)

- **Effect-first.** Единица работы — ваш реальный `Effect` (в т.ч. `attach`-фабрики): виден в
  devtools, композируется, тестируется отдельно. `query.__.effect` — ровно то, что вы передали.
- **Дружелюбный конфиг.** `retry` / `cache` / `concurrency` / `timeout` — inline-опции `createQuery`
  **и** standalone-операторы (`retry()`, `cache()`, `concurrency()`, `timeout()`, `keepFresh()`,
  `applyBarrier()`) — сахар над тем же движком.
- **Реальная отмена.** `createRequestFx` даёт `AbortSignal`; `TAKE_LATEST`/`cancel` реально
  прерывают запрос в полёте, а не просто отбрасывают результат.
- **Декларативный HTTP для чтений _и_ записей.** `createJsonQuery` + `createJsonMutation`, оба поверх
  переиспользуемого request-эффекта (`createJsonRequestFx`), который можно вставить в любой
  `createQuery`.
- **`@@trigger` в обе стороны.** Каждый query/mutation _является_ `@@trigger` (`fired` =
  `finished.done`), поэтому драйвит `keepFresh({ triggers })` самого farfetched — а наш `keepFresh`
  в ответ принимает любой `@@trigger` (web-API триггеры withease, совместимые с farfetched) или
  обычный `Event`.
- **Пагинация из коробки.** `createInfiniteQuery` (двунаправленные `fetchNext`/`fetchPrevious`,
  окно страниц) — у farfetched встроенного аналога нет.
- **Офлайн из коробки.** У обеих библиотек есть мьютекс `createBarrier` (например 401 → обновить
  токен → повторить); effector-refetch добавляет готовый `createNetworkBarrier`, который ставит
  запросы на паузу, пока браузер офлайн.
- **Роутер структурно.** `attachToRoute({ route, query })` стартует/сбрасывает запрос на
  открытии/закрытии маршрута — без импорта atomic-router (подойдёт любой объект `{ opened, closed }`).
- **Тулинг.** Визуальные devtools-панели для **React, Vue и Solid**, поток интроспекции,
  `llms.txt` и скилл для Claude Code.
- **Биндинги и Suspense.** `useUnit(query)` плюс хелперы `useQuery` для React / Vue / Solid и
  `useSuspenseQuery` для React Suspense.
- **Маленькое ядро без зависимостей** (~7 КБ) в активной разработке к 1.0.

## Бок о бок

|                       | farfetched                                                    | effector-refetch                                                                              |
| --------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| единица работы        | внутренний event-исполнитель                                  | ваш реальный `Effect` — first-class                                                           |
| стиль API             | операторы                                                     | inline-опции **и** операторы                                                                  |
| операторы             | `retry`/`cache`/`concurrency`/`timeout`/`keepFresh`/`barrier` | тот же набор — inline **и** standalone                                                        |
| sourced-конфиг        | sourced **всё**                                               | поля HTTP (`url`/`query`/`body`/`headers`) + выборочный конфиг + `source`/`mapParams`         |
| валидация             | runtypes / io-ts / superstruct / typed-contracts / zod        | runtypes / io-ts / zod / Standard Schema / `@withease/contracts` (нативно) / `createContract` |
| декларативный HTTP    | `createJsonQuery` + `createJsonMutation`                      | `createJsonQuery` + `createJsonMutation` (поверх `createJsonRequestFx`)                       |
| пагинация             | —                                                             | `createInfiniteQuery` (двунаправленная)                                                       |
| отмена                | abort + discard                                               | реальный `AbortSignal` через `createRequestFx`                                                |
| barrier / мьютекс     | `createBarrier` + оператор `applyBarrier`                     | `createBarrier` + оператор `applyBarrier`                                                     |
| офлайн-режим          | собирается на барьере                                         | встроенный `createNetworkBarrier`                                                             |
| протокол `@@trigger`  | реализует + потребляет (`keepFresh` triggers)                 | реализует (каждый query/mutation) + потребляет (`keepFresh` triggers)                         |
| роутер                | `@farfetched/atomic-router`                                   | `attachToRoute` (структурно — без импорта роутера)                                            |
| devtools              | `@farfetched/dev-tools`                                       | визуальные панели (React/Vue/Solid) + поток интроспекции                                      |
| биндинги              | `@farfetched/solid` + `useUnit`                               | react / vue / solid + `useQuery` + `useSuspenseQuery`                                         |
| SSR                   | `fork` / `allSettled`                                         | `fork` / `allSettled`                                                                         |
| зрелость / экосистема | **больше, проверена в бою**                                   | молодой, активно развивается                                                                  |

## Что выбрать?

- **Берите farfetched**, если нужен самый зрелый вариант сегодня, вы активно полагаетесь на
  sourced-everything или нужны именно адаптеры superstruct / typed-contracts.
- **Берите effector-refetch**, если предпочитаете оборачивать свои эффекты, хотите inline-конфиг,
  реальную отмену, встроенную пагинацию, декларативные чтения **и** записи, примитивы
  barrier/offline, структурную интеграцию с роутером, кросс-фреймворковые devtools или маленькое
  ядро на активно поддерживаемом проекте.

Уже на farfetched и интересно? [Гайд по миграции](/ru/guide/migration) и инструмент
`npx effector-refetch-codemod` берут на себя большую часть механических изменений.
