# Circuit breaker

[Барьер](/ru/recipes/auth-barrier) — это мьютекс, который можно `lock` и `unlock`; gated-запросы
ждут, пока он закрыт. Этого достаточно для **circuit breaker**: после N подряд ошибок размыкаем
breaker, чтобы запросы перестали добивать падающий бэкенд, ждём cooldown, затем пропускаем пробную
волну — свежая ошибка снова размыкает, успех — замыкает.

Без нового API — это барьер плюс счётчик ошибок.

```ts
import { createEffect, createStore, sample } from 'effector';
import { createBarrier, applyBarrier } from 'effector-refetch';

const THRESHOLD = 3; // подряд ошибок, чтобы разомкнуть breaker
const COOLDOWN = 10_000; // мс, сколько цепь «открыта»

// «Открытое» окно: блокировка запускает cooldown-эффект, и барьер сам переоткрывается,
// когда тот завершится (createBarrier делает unlock на `perform.finally`).
const cooldownFx = createEffect(() => new Promise<void>((r) => setTimeout(r, COOLDOWN)));
const breaker = createBarrier({ perform: cooldownFx });

// Считаем ошибки подряд; любой успех сбрасывает в 0 (→ замкнуто).
const $failures = createStore(0)
  .on(api.finished.fail, (n) => n + 1)
  .reset(api.finished.done);

// Размыкаем при достижении порога. Повторный lock пока уже открыто — no-op
// (значение стора не меняется), поэтому cooldown не перезапускается посреди окна.
sample({ clock: $failures.updates, filter: (n) => n >= THRESHOLD, target: breaker.lock });

applyBarrier(api, breaker); // или: createQuery({ effect, barrier: breaker })
```

## Как ведёт себя

- **Closed (замкнуто)** — `$failures < THRESHOLD`, запросы идут как обычно.
- **Open (открыто)** — порог дёргает `breaker.lock`; gated-запуски **встают на паузу** (они `await`
  барьер), и падающий бэкенд перестаёт получать нагрузку. `cooldownFx` крутится `COOLDOWN`, затем
  барьер открывается.
- **Half-open (полуоткрыто)** — приостановленные запросы продолжаются. Так как `$failures` всё ещё
  `≥ THRESHOLD`, одна свежая ошибка тут же снова размыкает breaker (ещё один cooldown); первый же
  **успех** сбрасывает счётчик и замыкает.

`breaker.$locked` — флаг «открыто»; забиндите через `useUnit`, чтобы показать баннер «сервис
недоступен, повтор через мгновение».

::: tip Пауза vs fail-fast
Классический breaker в открытом состоянии _быстро отклоняет_; этот **ставит запросы на паузу** до
конца cooldown, затем повторяет их. Для слоя запросов это обычно и нужно (без вспышки ошибки, с
авто-восстановлением). Если нужен fail-fast — засемплите `breaker.$locked` в guard, который
отклоняет.
:::

## На несколько запросов

Разделите один breaker на группу — кормите его объединёнными ошибками и гейтите каждый запрос:

```ts
import { merge } from 'effector';

const anyFailure = merge([usersQuery.finished.fail, ordersQuery.finished.fail]);
const $failures = createStore(0)
  .on(anyFailure, (n) => n + 1)
  .reset([usersQuery.finished.done, ordersQuery.finished.done]);

[usersQuery, ordersQuery].forEach((q) => applyBarrier(q, breaker));
```

Half-open отпускает все накопившиеся запросы разом (нормально для типичного «один в полёте на
запрос»); для строгого single-trial half-open добавьте свой guard, пропускающий после cooldown
лишь один запрос. Рабочий пример:
[`examples/circuit-breaker.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/circuit-breaker.ts).
