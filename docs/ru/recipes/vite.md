# Vite (SPA)

Самый простой сетап — без SSR, плагинов и провайдеров. Запросы — обычные effector-юниты,
поэтому Vite + React/Vue/Solid SPA не требует ничего сверх самой модели. Но два апгрейда стоит
сделать с первого дня: **входной ивент приложения** и **scope**.

```bash
npm i effector effector-react effector-refetch
```

## Модель

Та же форма, что и в остальных рецептах: входные ивенты, запросы, компоненты только рендерят.

```ts
// src/model.ts
import { createEvent, sample } from 'effector';
import { createJsonQuery } from 'effector-refetch';

export const usersQuery = createJsonQuery<void, User[]>({
  name: 'users',
  request: { url: '/api/users' }, // относительные URL ок — всё в браузере
});

/** Вызывается один раз из точки входа. */
export const appStarted = createEvent();
sample({ clock: appStarted, target: usersQuery.start });
```

## Точка входа: fork даже в SPA

В клиентском приложении форкать _не обязательно_ — но это делает приложение тестируемым (тот же
`appStarted` гоняет интеграционные тесты через `allSettled`) и оставляет один шаг до SSR:

```tsx
// src/main.tsx
import { allSettled, fork } from 'effector';
import { Provider } from 'effector-react';
import { appStarted } from './model';

const scope = fork();
void allSettled(appStarted, { scope });

createRoot(document.getElementById('root')!).render(
  <Provider value={scope}>
    <App />
  </Provider>,
);
```

Компоненты используют `useUnit` как обычно — с `Provider` они читают scope автоматически.

## Полезные бонусы для SPA

- **Персистентность между перезагрузками**: направьте кэш scope в web storage —
  `fork({ values: [[$queryCache, localStorageCache({ version: 1, maxAge: 3_600_000 })]] })` —
  закэшированные запросы рендерятся мгновенно при следующем визите
  ([подробнее](/ru/recipes/ssr-and-testing)).
- **Интеграция с роутером**: `attachToRoute({ route, query })` стартует/сбрасывает запросы при
  навигации (atomic-router / @effector/router, [рецепт](/ru/recipes/router)).
- **Devtools**: подключите [панель devtools](/ru/api/devtools) на время разработки.
- **Effector-плагин не нужен**: sid важны, только когда состояние пересекает границу
  (`serialize`/`fork({ values })` между сервером и клиентом). Чистое SPA ничего не сериализует,
  а сториз самой библиотеки и так несут явные sid.

## Бонус для тестов

Поскольку приложение стартует с ивента, интеграционный тест — три строки:

```ts
const scope = fork();
await allSettled(appStarted, { scope });
expect(scope.getState(usersQuery.$status)).toBe('done');
```
