# Авто-рефетч и поллинг

## Поллинг — `refetchInterval`

Перезапрос по таймеру, пока запрос запущен и включён:

```ts
const stats = createQuery({ effect: fetchStatsFx, refetchInterval: 5000 }); // каждые 5с
stats.start();
```

После каждого завершения (успех или ошибка) запрос ждёт `refetchInterval` мс и делает
`refresh` с последними параметрами (минуя кэш). Пауза, пока `$enabled` = `false`, остановка
на `reset`, и всё fork-корректно (каждый scope поллит независимо). Интервал может быть
реактивным — передайте `Store<number>` и меняйте на лету (например, чаще, пока вкладка активна):

```ts
createQuery({ effect: fx, refetchInterval: $pollMs });
```

## По фокусу окна / реконнекту

Opt-in, только браузер, tree-shakeable:

```ts
import { refetchOnWindowFocus, refetchOnReconnect } from 'effector-refetch';

const stop1 = refetchOnWindowFocus(userQuery);
const stop2 = refetchOnReconnect(userQuery);
// вызовите stop1() / stop2(), чтобы отписаться
```

Оба перезапрашивают с последними параметрами запроса, только если он уже запускался и
включён. Без scope они читают no-scope-стор (одно-клиентское приложение); передайте `scope`
вторым аргументом — триггер сработает fork-корректно. Безопасно вызывать на каждый mount
компонента: effector-проводка создаётся один раз на запрос, отписка снимает только DOM-листенер.

## Offline / сетевой режим

`createNetworkBarrier()` — это [barrier](/ru/recipes/auth-barrier), который **блокируется, пока
браузер офлайн**, и разблокируется при реконнекте. Подключите его к запросам — и их прогоны
встают на паузу при потере сети, а затем сами продолжаются при её возврате, без обвязки на
каждый запрос:

```ts
import { createNetworkBarrier, refetchOnReconnect } from 'effector-refetch';

const offline = createNetworkBarrier();

const userQuery = createQuery({ effect: fetchUserFx, barrier: offline });
// или на всю группу: createQueryFactory({ barrier: offline })

offline.$online; // Store<boolean> — для баннера «вы офлайн»
refetchOnReconnect(userQuery); // опционально: ещё и обновить уже загруженные данные
offline.stop(); // отвязать слушатели online/offline при размонтировании
```

Прогон, запущенный офлайн, висит в `pending` (тело эффекта не вызывается), пока сеть не вернётся.
Только браузер — на сервере барьер остаётся открытым (онлайн).

В приложении со scope (`@effector/next`, любой `fork()`-сетап) передайте scope: слушатели
`online`/`offline` срабатывают вне стека вызовов effector, иначе блокировка попадёт в
бесскоупное приложение, а запросы в форке продолжат выполняться:

```ts
const offline = createNetworkBarrier({ scope });
```

## Рефетч при изменении источника — `keepFresh`

Держите запрос свежим относительно внешнего состояния (фильтры, локаль, текущий пользователь):
`keepFresh` перезапрашивает его с **последними параметрами** при изменении стора-`source`.

```ts
import { keepFresh } from 'effector-refetch';

keepFresh(productsQuery, { source: $filters }); // или source: [$filters, $locale]
```

No-op, пока запрос не запускался (`status !== 'initial'`) и пока он disabled. Отличается от
`refetchInterval` (по времени) — это по зависимости. (Если значение источника должно реально
менять запрос — прокидывайте его в параметры через `connectQuery` / `sample` в `start`.)

## Триггеры web-API (`@withease/web-api`)

Трекеры [`@withease/web-api`](https://withease.effector.dev/web-api/) реализуют протокол
`@@trigger`, поэтому подключаются в `keepFresh({ triggers })` **напрямую** — без адаптера:

```ts
import { trackPageVisibility, trackNetworkStatus } from '@withease/web-api';
import { keepFresh } from 'effector-refetch';

const network = trackNetworkStatus();

// рефетч, когда вкладка снова становится видимой (трекер фаерит свой `visible`)
keepFresh(dashboardQuery, { triggers: [trackPageVisibility()] });

// …или на любое обычное событие, которое отдаёт трекер
keepFresh(dashboardQuery, { triggers: [network.online] });
```

**Сторы** трекеров годятся в остальные слоты: гейтите запрос пока офлайн через `enabled`, или
используйте стор трекера как `source`:

```ts
createQuery({ effect: fx, enabled: network.$online });
```

Это пересекается со встроенными `refetchOnWindowFocus` / `refetchOnReconnect` /
`createNetworkBarrier` выше — для типовых случаев берите встроенные, а `@withease/web-api` — когда
нужно больше сигналов (геолокация, media query, ориентация экрана, …) за тем же `@@trigger` API.

## Композиция с patronum

Триггеры запроса — обычные события effector, поэтому их можно гонять любым оператором
[patronum](https://patronum.effector.dev/operators/) — без специального API:

```ts
import { interval, debounce, throttle } from 'patronum';

// debounce поиска по мере ввода
debounce({ source: queryChanged, timeout: 300, target: searchQuery.start });

// свой поллинг с управлением start/stop
const { tick } = interval({ timeout: 10_000, start: pageOpened, stop: pageClosed });
sample({ clock: tick, source: searchQuery.$params, target: searchQuery.refetch });

// throttle кнопки обновления
throttle({ source: refreshClicked, timeout: 1000, target: dashboard.refresh });
```

Для типового случая используйте встроенный `refetchInterval`; берите patronum, когда нужны
явные start/stop, debounce или throttle.

::: warning Поллинг и SSR
При `refetchInterval > 0` `allSettled(query.start, { scope })` не резолвится никогда —
каждое завершение планирует следующий тик, и scope не переходит в покой. Для SSR (и
тестов, ожидающих scope) сделайте интервал `Store<number>` и обнулите его в этом scope:

```ts
const $interval = createStore(30_000);
const stats = createQuery({ effect: fetchStatsFx, refetchInterval: $interval });

// SSR-scope на запрос: поллинг выключен
const scope = fork({ values: [[$interval, 0]] });
```

:::
