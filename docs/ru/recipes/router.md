# Роутер и loaders

С data-роутером (React Router 6.4+, TanStack Router, …) можно грузить данные в **loader** маршрута,
и страница рендерится уже с данными — без мигания загрузки внутри компонента. effector-refetch
подходит, потому что query — обычный effector: loader гонит его через ваш scope, а компонент читает
через `useUnit`.

## Loader в React Router

```tsx
import { allSettled, fork } from 'effector';
import { useUnit } from 'effector-react';
import { createBrowserRouter } from 'react-router-dom';

const userQuery = createQuery({ effect: fetchUserFx, cache: { staleAfter: 30_000 } });
const scope = fork(); // тот же scope, под которым рендерите <Provider value={scope}>

const router = createBrowserRouter([
  {
    path: '/users/:id',
    // запускаем запрос и ждём до рендера маршрута
    loader: async ({ params }) => {
      await allSettled(userQuery.start, { scope, params: Number(params.id) });
      return null; // данные в userQuery.$data, а не в результате loader-а
    },
    Component: () => {
      const { data, pending, error } = useUnit(userQuery);
      if (error) return <p>Ошибка</p>;
      return <h1>{pending ? 'Загрузка…' : data?.name}</h1>; // pending только при cache miss
    },
  },
]);
```

- **`cache`** делает повторные заходы мгновенными — loader резолвится из кэша без сети.
- **SSR**: создайте свежий `scope` на каждый запрос, прогоните loader-ы, затем `serialize(scope)` →
  `fork({ values })` на клиенте (см. [SSR и тесты](/ru/recipes/ssr-and-testing)).
- **Без scope** (обычный SPA): в loader-е `userQuery.start(id)` и один раз `await` события
  `finished.finally` вместо `allSettled`.

Та же схема работает с `loader` у TanStack Router и любым фреймворком, который грузит данные до рендера.

Рабочий пример: [`examples/react-router.tsx`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/react-router.tsx).

## Роутеры effector: atomic-router и @effector/router

Для роутеров effector склейка — `attachToRoute`: стартует запрос, когда маршрут
**открывается** (с его параметрами), **перезапускает** при смене параметров открытого
маршрута (`/users/1` → `/users/2`) и сбрасывает при **закрытии** — без эффекта в компоненте.

::: code-group

```ts [atomic-router]
import { createRoute } from 'atomic-router';
import { attachToRoute } from 'effector-refetch';

const userRoute = createRoute<{ id: string }>();

attachToRoute({
  route: userRoute,
  query: userQuery,
  mapParams: ({ params }) => Number(params.id), // параметры маршрута → параметры запроса
  // restartOnUpdate: true (по умолчанию) — смена параметров перезапускает запрос
  // resetOnClose: true (по умолчанию)
});
```

```ts [@effector/router]
import { createRoute } from '@effector/router';
import { attachToRoute } from 'effector-refetch';

const userRoute = createRoute({ path: '/users/:id' }); // Route<{ id: string }>

attachToRoute({
  route: userRoute,
  query: userQuery,
  mapParams: (opened) => Number((opened as { params: { id: string } }).params.id),
});
```

:::

Структурно (ни один роутер не импортируется — подойдёт любой объект с
`opened`/`updated`/`closed`) и на чистом `sample`, поэтому scope-корректно для SSR.
`mapParams` опционален, если параметры маршрута уже совпадают с параметрами запроса.
Для @effector/router `attachToRoute` учитывает его семантику «`opened` срабатывает на
каждый `open()`»: через `opened` запрос стартует только при переходе closed→open, смена
параметров идёт через `updated` — без двойных запросов. Рабочие примеры:
[`examples/atomic-router.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/atomic-router.ts),
[`examples/effector-router.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/effector-router.ts).

::: tip Родные загрузчики @effector/router
У @effector/router есть и собственный паттерн готовности — `chainRoute` выводит маршрут
«данные готовы» после коммита URL. `attachToRoute` — более простая склейка «запрос следует
за маршрутом»; берите `chainRoute`, когда ЭКРАН должен ждать данные (см.
[router.effector.dev](https://router.effector.dev/core/chain-route.html)).
:::
