# TanStack Start

[TanStack Start](https://tanstack.com/start) — full-stack React на TanStack Router. Его
ключевое свойство для effector: **лоадеры роутов изоморфны** — при первом рендере они
выполняются на сервере, при последующих навигациях — на клиенте. Поэтому интеграция крошечная:
запустить входной ивент страницы в лоадере, вернуть `serialize(scope)` как loader data — и
встроенная дегидрация роутера сама довезёт её до клиента.

Модель идентична [рецепту Next.js](/ru/recipes/nextjs) — входные ивенты страниц, запросы со
стабильным `name` (их сториз несут явные sid, так что **effector babel/SWC-плагин для состояния
библиотеки не нужен**), свои сториз с явными sid.

```bash
npm i effector effector-react effector-refetch
```

## 1. Лоадер: fork → allSettled → serialize

Loader data должна быть сериализуемой — `serialize(scope)` возвращает обычный JSON, поэтому
роутер дегидрирует/регидрирует её автоматически вместе с остальными данными лоадера:

```tsx
// src/routes/users.tsx
import { createFileRoute } from '@tanstack/react-router';
import { allSettled, fork, serialize } from 'effector';
import { pageStarted } from '../model';

export const Route = createFileRoute('/users')({
  validateSearch: (search) => ({ q: (search.q as string) ?? '' }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps }) => {
    const scope = fork();
    await allSettled(pageStarted, { scope, params: deps });
    return { values: serialize(scope) };
  },
  component: UsersPage,
});
```

`/users?q=Marg` рендерится на сервере уже с фильтром. При клиентской навигации тот же лоадер
выполняется **в браузере** — свежий fork, запрос уходит с клиента, и страница получает values
тем же путём. Один код на оба случая.

## 2. Компонент: scope из loader data

```tsx
import { useMemo } from 'react';
import { fork } from 'effector';
import { Provider } from 'effector-react';

function UsersPage() {
  const { values } = Route.useLoaderData();
  const scope = useMemo(() => fork({ values }), [values]);

  return (
    <Provider value={scope}>
      <UsersScreen />
    </Provider>
  );
}
```

Первый кадр приходит с заполненным `$data` и `status: 'done'` — без скелетона и рефетча на
маунте. `UsersScreen` — обычная `useUnit`-вьюха без `useState`/`useEffect`
([см. рецепт Next.js](/ru/recipes/nextjs)).

## 3. Детальные роуты

```tsx
// src/routes/users.$id.tsx
export const Route = createFileRoute('/users/$id')({
  loader: async ({ params }) => {
    const scope = fork();
    await allSettled(userPageStarted, { scope, params: { id: Number(params.id) } });
    return { values: serialize(scope) };
  },
  component: UserPage,
});
```

## Примечания

- **Серверная работа — в server functions.** Лоадер изоморфен, поэтому всё внутри него попадает
  в клиентский бандл. Если эффекту нужны секреты или БД — оберните эту часть в `createServerFn`
  и вызывайте из эффекта запроса: машинерия запроса (retry, cache, concurrency, abort) всё так
  же работает вокруг.
- **Scope на роут**: этот минимальный сетап форкает scope на каждый роут — клиентское состояние
  вне сериализованных values сбрасывается при навигации. Для постоянного клиентского scope
  держите синглтон модуля и мержьте в него values лоадера вместо ре-форка.
- **Кэш-слой** (`$queryCache` + `dehydrate`/`hydrate`) компонуется как в
  [SSR и тестах](/ru/recipes/ssr-and-testing): положите адаптер в fork лоадера и верните
  `dehydrate(cache)` рядом с `values`.
