# Биндинги фреймворков

Query реализует протокол effector `@@unitShape`, поэтому его можно передать прямо в
`useUnit` из **effector-react**, **effector-vue** или **effector-solid** — без обёрток.

```tsx
// React
import { useUnit } from 'effector-react';

function UserCard({ id }: { id: number }) {
  const { data, pending, error, refetch } = useUnit(userQuery);
  return pending ? <Spinner /> : <div onClick={() => refetch(id)}>{data?.name}</div>;
}
```

```vue
<!-- Vue -->
<script setup lang="ts">
import { useUnit } from 'effector-vue/composition';
const { data, pending, refetch } = useUnit(userQuery);
</script>
```

`useUnit(query)` отдаёт `{ data, error, status, pending, isInitialLoading, isRefetching,
stale, enabled, params, start, refetch, refresh, reset, cancel }`. `isInitialLoading` — прогон
без реальных данных (скелетон); `isRefetching` — прогон поверх имеющихся данных (спиннер).

## Хелперы useQuery

Тонкие хелперы с производными флагами (`isInitial / isPending / isDone / isFail`):

```tsx
// React — effector-refetch/react
import { useQuery } from 'effector-refetch/react';
const { data, isPending, isFail, error, start } = useQuery(userQuery);
useEffect(() => start(id), [id]); // запросы не стартуют сами
```

```vue
<!-- Vue — effector-refetch/vue (возвращает ref-ы) -->
<script setup lang="ts">
import { useQuery } from 'effector-refetch/vue';
const { data, isPending, isDone, start } = useQuery(userQuery);
</script>
```

```tsx
// Solid — effector-refetch/solid (возвращает accessor-ы — вызывайте их)
import { useQuery } from 'effector-refetch/solid';

function UserCard(props: { id: number }) {
  const { data, isPending, isFail, start } = useQuery(userQuery);
  start(props.id); // запросы не стартуют сами
  return <div>{isPending() ? 'Loading…' : data()?.name}</div>;
}
```

React работает с `<Provider value={scope}>`, Vue — с `EffectorScopePlugin`, Solid — с
`<Provider>` из effector-solid; всё для SSR / `fork`. Биндинги требуют соответствующих
опциональных peer-зависимостей (`react`+`effector-react` / `vue`+`effector-vue` /
`solid-js`+`effector-solid`).

## Рефетч на маунте

`useQuery` (во всех трёх фреймворках) принимает объект опций — `refetchOnMount` перезапрашивает
запрос **с его последними параметрами**, когда компонент подписывается:

```ts
useQuery(userQuery, { refetchOnMount: true }); // рефетч только если данные устарели
useQuery(userQuery, { refetchOnMount: 'always' }); // рефетч на каждом маунте
```

No-op, пока запрос не запускался хотя бы раз (`status !== 'initial'`) и включён — он никогда не
стартует запрос без параметров. `true` требует `cache.staleAfter`, чтобы было понятие
устаревания; `'always'` его игнорирует.

## Suspense (React)

`useSuspenseQuery` возвращает данные напрямую (никогда не `null`): он **сам стартует** запрос,
подвешивает ближайший `<Suspense>` на время загрузки, бросает ошибку в ближайший Error Boundary
при сбое и возвращает данные по готовности.
Suspense-промис кешируется на пару (scope, query) и сбрасывается при settle; у запроса единичное
состояние, поэтому если на одном query подвисает несколько компонентов — выигрывают params
первого стартовавшего.

```tsx
import { Suspense } from 'react';
import { useSuspenseQuery } from 'effector-refetch/react';

function UserName({ id }: { id: number }) {
  const user = useSuspenseQuery(userQuery, id); // подвешивается до готовности
  return <span>{user.name}</span>;
}

function Page({ id }: { id: number }) {
  return (
    <ErrorBoundary fallback={<p>Не удалось загрузить</p>}>
      <Suspense fallback={<Spinner />}>
        <UserName id={id} />
      </Suspense>
    </ErrorBoundary>
  );
}
```

Это **клиентский** Suspense: чтение и триггеры учитывают scope, но сигнал завершения
наблюдается глобально — используйте с `fork` вне конкурентного SSR-стриминга.
