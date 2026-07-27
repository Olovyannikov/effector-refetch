# Next.js (App Router)

SSR без loading-флеша с [`@effector/next`](https://github.com/effector/next): сервер рендерит
страницу с **уже завершённым** запросом, клиент подхватывает состояние без скелетона и без
рефетча на маунте — и **effector babel/SWC-плагин для сториз библиотеки не нужен** (они
поставляются с явными стабильными sid, см. примечание ниже).

Полное запускаемое приложение —
[`examples/nextjs`](https://github.com/Olovyannikov/effector-refetch/tree/main/examples/nextjs).

```bash
npm i effector effector-react @effector/next effector-refetch
```

## Паттерн

Четыре части, вся логика в модели — компоненты только рендерят.

### 1. Модель: ивенты страниц на входе, запросы на выходе

Один **входной ивент на страницу**. Сервер вызывает его на каждый запрос; `sample` соединяет
его с запросами.

```ts
// src/users.ts
import { createEvent, createStore, sample } from 'effector';
import { createJsonQuery, debounce } from 'effector-refetch';

export const usersQuery = createJsonQuery<{ q: string }, User[]>({
  name: 'users', // ← имя даёт $data/$status/$params стабильные sid
  request: { url: `${base}/api/users`, query: ({ q }) => (q ? { q } : {}) },
  concurrency: 'TAKE_LATEST', // набор текста абортит вытесненный запрос
});
debounce(usersQuery, 200);

export const pageStarted = createEvent<{ q: string }>();
export const searchChanged = createEvent<string>();

// СВОИМ сторам нужны явные sid для переноса (или @effector/swc-plugin)
export const $search = createStore('', { sid: 'app/$search' })
  .on(pageStarted, (_, { q }) => q)
  .on(searchChanged, (_, q) => q);

sample({ clock: pageStarted, target: usersQuery.start });
sample({ clock: searchChanged, fn: (q) => ({ q }), target: usersQuery.start });
```

### 2. Корневой layout: голый провайдер

```tsx
// app/layout.tsx
<Providers>{children}</Providers> // <EffectorNext> без values — доступ к scope всему дереву
```

### 3. Страницы: fork → allSettled(pageEvent) → serialize

```tsx
// app/page.tsx — серверный компонент
import { allSettled, fork, serialize } from 'effector';
import { pageStarted } from '../src/users';

export const dynamic = 'force-dynamic'; // SSR на каждый запрос, не статика

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const scope = fork();
  await allSettled(pageStarted, { scope, params: { q } });
  return (
    <Providers values={serialize(scope)}>
      <UsersScreen />
    </Providers>
  );
}
```

`/?q=Marg` рендерится на сервере уже с применённым фильтром — `$search`, `$data`, `$status`
приезжают сериализованными.

### 4. Компоненты: `useUnit` и ничего больше

```tsx
'use client';
const { users, status, q, onSearch } = useUnit({
  users: usersQuery.$data,
  status: usersQuery.$status,
  q: $search,
  onSearch: searchChanged,
});
```

Без `useState` и `useEffect` — в первом же кадре `status: 'done'` и данные.

## Переходы между страницами — без дополнительных хуков

При клиентской навигации Next **перезапускает серверный компонент целевой страницы**: там
срабатывает входной ивент модели, а вложенный `<EffectorNext values>` автоматически гидрирует
свежие values в существующий клиентский scope. Детальный роут — тот же рецепт со своим
входным ивентом:

```tsx
// app/users/[id]/page.tsx
export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = fork();
  await allSettled(userPageStarted, { scope, params: { id: Number(id) } });
  return (
    <Providers values={serialize(scope)}>
      <UserCard />
    </Providers>
  );
}
```

## Почему не нужен effector-плагин?

`serialize(scope)` переносит только сториз с sid. Плагины бандлеров не обрабатывают собранный
`node_modules` — поэтому effector-refetch проставляет публичным сторизам **явные стабильные
sid** (`er/<name>/$data`, …). Отсюда два правила:

- давайте запросам стабильные **`name`** — sid (и неймспейсы кэша) выводятся из имени, и оно
  одинаково в раздельно собираемых серверном и клиентском бандлах;
- **вашим собственным** сторам sid всё ещё нужен: задайте явно
  (`createStore('', { sid: '…' })`) или подключите
  [`@effector/swc-plugin`](https://github.com/effector/swc-plugin) для кода приложения.

## Практики из продакшена

Конвенции, проверенные реальными SSR + effector кодовыми базами — переносятся в этот сетап
как есть:

- **Узкие payload'ы ивентов.** Вызывайте `pageStarted` ровно с тем, что нужно модели
  (`{ q }`, `{ id }`) — никогда не с целым `searchParams`/контекстом. Широкий payload течёт
  через `sample` в `query.start`, и типы фреймворка утекают в параметры ваших эффектов.
- **Два вида входных ивентов.** Серверные страничные (`pageStarted`, `userPageStarted`) несут
  SSR-данные. Добавьте **клиентский** `appStarted` — один раз из маленького клиентского
  компонента на гидрации — для проводки, которая не может выполняться на сервере:
  `persist(..., { pickup: appStarted })` из `effector-storage`, запросы с токеном из
  `localStorage`, аналитика.
- **Слайсовая раскладка.** На масштабе держите каждый доменный слайс как `api/`
  (запросы/мутации) + `model/` (входные ивенты, `sample`-проводка) + `ui/` (тупые
  `useUnit`-вьюхи) — конвенция FSD; файлы страниц остаются тонкими адаптерами, переводящими
  параметры роута в ивенты модели.
- **Компоненты не вызывают `.start`.** Каждый старт запроса идёт через ивент + `sample` —
  работа компонента только `useUnit`. Именно это делает весь флоу воспроизводимым в тестах
  через `allSettled(pageStarted, { scope, params })`.

## URL на сервере

Относительные URL существуют только в браузере. На сервере направляйте запрос на собственный
origin:

```ts
const base = typeof window === 'undefined' ? `http://localhost:${process.env.PORT ?? 3000}` : '';
```

## Слой кэша (опционально)

`serialize` переносит **store-слой**. Если вы также используете `cache: { staleAfter }` и
хотите, чтобы серверные записи корректно старели на клиенте, добавьте **кэш-слой** —
per-request адаптер через `$queryCache` + `dehydrate`/`hydrate`, как описано в
[SSR и тестах](/ru/recipes/ssr-and-testing).
