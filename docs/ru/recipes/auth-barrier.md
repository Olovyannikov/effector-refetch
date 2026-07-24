# Авторизация и barrier (пауза окружения)

Иногда нужно **поставить на паузу все запросы**, что-то сделать и продолжить — классический
случай `401`: пауза, рефреш токена, доигрывание очереди запросов.

`createBarrier` — это мьютекс, на котором запросы ждут. Пока он заблокирован, любой
gated-запрос, который пытается выполниться, блокируется; при разблокировке очередь продолжается.

```ts
import { sample } from 'effector';
import { createBarrier, createQueryFactory } from 'effector-refetch';

// barrier запускает рефреш при блокировке и разблокируется, когда рефреш завершится
const authBarrier = createBarrier({ perform: refreshTokenFx });

// все query/мутации этой фабрики ждут на barrier
const { createQuery, createMutation } = createQueryFactory({ barrier: authBarrier });

const profile = createQuery({
  effect: getProfileFx, // бросает { status: 401 } при протухшем токене
  retry: { times: 1, filter: ({ error }) => error.status === 401 },
});

// при 401 — блокируем barrier, что запускает refreshTokenFx
sample({
  clock: getProfileFx.failData,
  filter: (error) => error.status === 401,
  target: authBarrier.lock,
});
```

Что происходит при протухшем токене:

1. `getProfileFx` падает с `401` → barrier **блокируется**, запускается `refreshTokenFx`.
2. `retry` планирует повтор — но он **ждёт на barrier**.
3. Другие запросы, стартовавшие тем временем, тоже встают в очередь.
4. `refreshTokenFx` завершается → barrier **разблокируется** → повтор (и очередь) выполняются со свежим токеном.

## Попробуйте вживую

Протухните токен и нажмите **Fetch ×3**: один `401` блокирует barrier, рефреш выполняется
**один раз**, а все повторные запросы после разблокировки продолжаются и успешно завершаются:

<AuthBarrierDemo>
<template #code>

```ts
import { createEffect, sample } from 'effector';
import { createBarrier, createQuery, createRequestFx } from 'effector-refetch';

let token = 'valid';

// имитация защищённого API: 401, пока токен протух
const fetchDataFx = createRequestFx(async (id: number) => {
  await sleep(500);
  if (token !== 'valid') throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return { id, secret: `data-${id}` };
});

// рефреш: выполняется ОДИН раз на блокировку, barrier откроется по его завершении
const refreshTokenFx = createEffect(async () => {
  await sleep(1200);
  token = 'valid';
});

const authBarrier = createBarrier({ perform: refreshTokenFx });

const dataQuery = createQuery({
  effect: fetchDataFx,
  barrier: authBarrier, // каждый запуск — включая повторы — ждёт, пока barrier заблокирован
  retry: 1, //             упавшая с 401 попытка доигрывается после рефреша
  concurrency: 'TAKE_EVERY',
});

// 401 блокирует barrier → стартует refreshTokenFx, повторы встают в очередь
sample({
  clock: fetchDataFx.failData,
  filter: (error) => error.status === 401,
  target: authBarrier.lock,
});

dataQuery.start(1); // с протухшим токеном: 401 → lock → рефреш → повтор успешен
```

</template>
</AuthBarrierDemo>

## API

```ts
const barrier = createBarrier({ perform?: Effect<void, any> });
barrier.lock();        // закрыть — gated-запросы ждут
barrier.unlock();      // открыть — очередь продолжается
barrier.$locked;       // Store<boolean>
```

С `perform` блокировка автоматически запускает эффект и разблокируется по его завершении
(успех **или** ошибка — без дедлока). Без него — управляйте `lock`/`unlock` сами.

Gate одного запроса без фабрики — через опцию конфига или оператор `applyBarrier` на уже
созданном query/mutation (`null` — отвязать):

```ts
const q = createQuery({ effect: fx, barrier: authBarrier });
// или после создания:
applyBarrier(existingQuery, authBarrier);
```

::: warning Клиентский механизм
Barrier читает no-scope-стор, поэтому рассчитан на одно работающее приложение, а не на
изоляцию по `fork`. (Пауза запросов редко нужна на SSR.)
:::
