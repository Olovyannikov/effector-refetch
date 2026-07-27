# Vike

[Vike](https://vike.dev) (бывший `vite-plugin-ssr`) даёт SSR поверх Vite с постраничными
`+data`-хуками — они ложатся на effector-паттерн один в один: **`+data`-хук — это место, где
срабатывает входной ивент страницы**.

Модель идентична [рецепту Next.js](/ru/recipes/nextjs) — входные ивенты страниц, запросы со
стабильным `name` (именно оно даёт их сторизам явные sid, так что **effector babel/SWC-плагин
для состояния библиотеки не нужен**), свои сториз с явными sid.

```bash
npm i effector effector-react effector-refetch vike vike-react
```

## 1. `+data`: fork → allSettled → serialize

`+data.ts` выполняется на сервере (по умолчанию — включая клиентские навигации, которые
запрашивают его с сервера), один вызов на рендер страницы:

```ts
// pages/users/+data.ts
import { allSettled, fork, serialize } from 'effector';
import type { PageContextServer } from 'vike/types';
import { pageStarted } from '../../src/model';

export async function data(pageContext: PageContextServer) {
  const q = (pageContext.urlParsed.search.q as string | undefined) ?? '';

  const scope = fork();
  await allSettled(pageStarted, { scope, params: { q } });

  return { values: serialize(scope) }; // обычный JSON — Vike довезёт до клиента
}
```

`/users?q=Marg` рендерится на сервере уже с применённым фильтром — ровно как в версии для
Next.js.

## 2. Страница: scope из `useData`

Данные из `+data` доступны компоненту через `useData()` и на сервере, и на клиенте — соберите
из них scope и передайте провайдером:

```tsx
// pages/users/+Page.tsx
import { useMemo } from 'react';
import { fork } from 'effector';
import { Provider } from 'effector-react';
import { useData } from 'vike-react/useData';
import { UsersScreen } from '../../src/users-screen';

export default function Page() {
  const { values } = useData<{ values: Record<string, unknown> }>();
  // один scope на отрендеренную страницу; ре-форк при навигации с новыми values
  const scope = useMemo(() => fork({ values }), [values]);

  return (
    <Provider value={scope}>
      <UsersScreen />
    </Provider>
  );
}
```

В первом же кадре на клиенте `$data` заполнен и `status: 'done'` — без скелетона и рефетча на
маунте. Клиентские переходы перезапускают `+data` (на сервере), и страница ре-форкается со
свежими values.

## 3. Детальные страницы

Тот же рецепт с параметрами роута:

```ts
// pages/users/@id/+data.ts
export async function data(pageContext: PageContextServer) {
  const scope = fork();
  await allSettled(userPageStarted, { scope, params: { id: Number(pageContext.routeParams.id) } });
  return { values: serialize(scope) };
}
```

## Примечания

- **Scope на страницу**: в отличие от `@effector/next` (который мержит values в один клиентский
  scope), этот минимальный сетап ре-форкает scope на каждую страницу — клиентское состояние вне
  сериализованных values сбрасывается при навигации. Если нужен постоянный клиентский scope,
  держите его синглтоном модуля и мержьте values через `hydrate` вместо ре-форка.
- **`+data` остаётся серверным** по умолчанию — в нём могут жить API-ключи и клиенты БД. Если
  страница должна фетчить на клиенте при навигации, запускайте запрос из клиентского ивента, а
  не из `+data`.
- **Кэш-слой** (`$queryCache` + `dehydrate`/`hydrate`) компонуется ровно как в
  [SSR и тестах](/ru/recipes/ssr-and-testing) — положите адаптер в fork внутри `+data` и
  отправьте `dehydrate(cache)` рядом с `values`.
