# SSR и тесты

Поскольку под капотом query — обычный effector, `fork()` + `allSettled()` работают как
обычно — без специальных тестовых утилит.

## Тестирование запроса

```ts
import { fork, allSettled } from 'effector';

const scope = fork();
await allSettled(query.start, { scope, params: 1 });
expect(scope.getState(query.$data)).toEqual(/* ... */);
```

## SSR

```ts
const scope = fork();
await allSettled(query.start, { scope, params: req.params });
const html = renderToString(/* app */, scope);
const serialized = serialize(scope); // effector serialize — $data / $status / …
```

Биндинги учитывают scope: React через `<Provider value={scope}>`, Vue через
`EffectorScopePlugin({ scope })`.

### Изоляция кэша на запрос (`$queryCache`)

По умолчанию адаптер кэша у query модульный — общий для всех scope. Для мультитенантного SSR
задайте **`$queryCache`** на форк: каждый query этого scope читает/пишет изолированный адаптер,
и параллельные запросы не видят данных друг друга:

```ts
import { $queryCache, inMemoryCache, dehydrate, hydrate } from 'effector-refetch';

// сервер — один адаптер на HTTP-запрос
const cache = inMemoryCache();
const scope = fork({ values: [[$queryCache, cache]] });
await allSettled(todosQuery.start, { scope });
const payload = { values: serialize(scope), cache: dehydrate(cache) };

// клиент
const clientCache = inMemoryCache();
hydrate(clientCache, payload.cache); // storedAt сохраняется → staleAfter стареет корректно
const clientScope = fork({ values: [...fromJSON(payload.values), [$queryCache, clientCache]] });
// $data восстановлен через serialize, закэшированные ключи дают хит вместо перезапроса
```

В общем scope-адаптере записи неймспейсятся по query: `name` ?? sid эффекта ?? счётчик
создания. Давайте query стабильные **`name`** (или используйте effector babel/SWC-плагин
для sid), если порядок инициализации модулей на сервере и клиенте может отличаться.
`$queryCache` автоматически исключён из `serialize(scope)`.

Дегидрируются только адаптеры, умеющие перечислять записи (например `inMemoryCache`); web-storage
адаптеры персистят себя сами. Без `$queryCache` всё работает как раньше — используется адаптер
самого query (нормально для одно-клиентского приложения). Барьеры остаются глобальными по дизайну.

### Персист на клиенте

Два взаимодополняющих способа пережить перезагрузку в браузере:

- **Слой кэша** — используйте `localStorageCache` / `sessionStorageCache` как адаптер; кэш запроса
  переживает перезагрузку (а `version` инвалидирует старые данные).
- **Слой стора** — персистите `$data` напрямую через [`effector-storage`](https://github.com/yumauri/effector-storage):

  ```ts
  import { persist } from 'effector-storage/local';
  persist({ store: todosQuery.$data as StoreWritable<Todo[] | null>, key: 'todos:data' });
  ```

  (`$data` в публичном типе read-only, но писабельный в рантайме — кастуйте для `persist`.)

Полный рабочий поток: [`examples/ssr.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/ssr.ts).

## Заметки

- Sourced-конфиг (`Store` для `concurrency` / `retry.times` / `cache.staleAfter` / `enabled`)
  **fork-корректен** — каждый scope видит своё значение.
- Изоляция кэша для SSR — `$queryCache` на форк (выше). Без него адаптеры кэша держат
  модульное состояние, общее для всех scope.
- In-flight `AbortController`-ы отслеживаются на **инстанс** query; не шарьте один инстанс
  между конкурентными SSR-запросами, если ещё и вызываете `cancel`.
