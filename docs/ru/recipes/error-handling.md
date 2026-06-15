# Обработка ошибок

Ошибки — полноценные граждане: упавший эффект пишет `$error`, переводит `$status` в `'fail'` и
эмитит `finished.fail` — всё scope-безопасно. В этом рецепте: как читать ошибки, нормализовать
их, решать что ретраить и реагировать глобально.

## Чтение ошибки

```ts
const userQuery = createQuery({ effect: fetchUserFx });

userQuery.$error; // Store<Error | null>
userQuery.$status; // 'initial' | 'pending' | 'done' | 'fail'
userQuery.finished.fail; // Event<{ params; error }>
```

В компоненте биндинги отдают это напрямую:

```ts
// React
const { error, status } = useQuery(userQuery);
// Vue
const { error, isFail } = useQuery(userQuery);
```

## Нормализация через `mapError`

Приведите сырые сбои к форме, понятной вашему UI, ещё до попадания в `$error`:

```ts
const userQuery = createQuery({
  effect: fetchUserFx,
  mapError: ({ error, params }) => ({
    code: (error as RequestError).status ?? 0,
    message: error instanceof Error ? error.message : 'Unknown error',
    userId: params,
  }),
});
// теперь userQuery.$error — Store<{ code; message; userId } | null>
```

## Типизированные транспортные ошибки

`createRequestFx` реджектит [`RequestError`](/ru/api/http) с полями `status` и `data`, так что
можно ветвиться по HTTP-статусу. Оборачиваете сторонний клиент? `normalizeRequestError` приводит
ошибки в стиле axios/ofetch к той же форме:

```ts
import { createRequestFx, RequestError, normalizeRequestError } from 'effector-refetch';

const fetchUserFx = createRequestFx(async (id: number, { signal }) => {
  const res = await fetch(`/api/users/${id}`, { signal });
  if (!res.ok) throw new RequestError(`HTTP ${res.status}`, { status: res.status, data: await res.text() });
  return res.json();
});

// из axios/ofetch:
const fetchFx = createRequestFx(async (id: number) => {
  try {
    return (await api.get(`/users/${id}`)).data;
  } catch (e) {
    throw normalizeRequestError(e); // -> RequestError { status, data }
  }
});
```

## Type guards

Вместо `instanceof` + кастов к `.status` сужайте ошибки встроенными guard'ами:

```ts
import { isRequestError, isHttpError, isTimeoutError, isValidationError } from 'effector-refetch';

const message = (e: unknown) => {
  if (isHttpError(e, 401)) return 'Войдите в аккаунт';
  if (isHttpError(e, (s) => s >= 500)) return 'Ошибка сервера — повторите';
  if (isTimeoutError(e)) return 'Таймаут';
  if (isValidationError(e)) return `Плохие данные: ${e.validationErrors.join(', ')}`;
  if (isRequestError(e)) return e.message; // сетевая ошибка (без status)
  return 'Неизвестная ошибка';
};
```

- `isHttpError(e, status?)` — `RequestError` со `status`; передайте код (`404`) или предикат
  (`(s) => s >= 500`).
- `isTimeoutError(e)` — запуск, прерванный по [`timeout`](/ru/api/queries).
- `isValidationError(e)` — провал [контракта / `validate`](/ru/api/http) (сужает к `.validationErrors`).
- `isRequestError(e)` — любая нормализованная транспортная ошибка.

## Что ретраить

По умолчанию `retry` повторяет при любом сбое. `filter` оставляет только временные (пропуская
4xx), а `suppressIntermediateErrors` держит `$error` чистым до финальной попытки:

```ts
import { isHttpError, isTimeoutError } from 'effector-refetch';

const query = createQuery({
  effect: fetchUserFx,
  retry: {
    times: 3,
    delay: (attempt) => 2 ** attempt * 200, // backoff
    // сетевые ошибки, таймауты и 5xx — никогда 4xx
    filter: ({ error }) =>
      isTimeoutError(error) || isHttpError(error, (s) => s >= 500) || !isHttpError(error),
    suppressIntermediateErrors: true, // $error остаётся null во время ретраев
  },
});
```

Провал валидации ([контракты](/ru/api/http)) бросает `ValidationError`, который идёт тем же
путём и **ретраится** — удобно, когда нестабильный апстрим иногда отдаёт битые данные.

## Глобальная реакция

`finished.fail` — обычное событие effector: засемплите его в тост, логгер или Sentry:

```ts
import { sample } from 'effector';

sample({
  clock: [userQuery.finished.fail, todosQuery.finished.fail],
  fn: ({ error }) => (error instanceof Error ? error.message : 'Request failed'),
  target: showToastFx,
});
```

С [общей фабрикой](/ru/recipes/defaults) это можно подключить один раз для всех запросов группы
через их события `finished.fail`, а не повторять для каждого.

## 401 → обновление токена → повтор

Для сценария «токен протух, обнови и повтори упавшие запросы» не обрабатывайте это в каждом
запросе — поставьте всё окружение на паузу через [barrier](/ru/recipes/auth-barrier): на 401 он
блокируется, обновляет токен и затем отпускает очередь запросов.

Рабочие формы ошибок: [`examples/graphql.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/graphql.ts)
(GraphQL `errors` → `RequestError`) и [страница HTTP](/ru/api/http).
