# Загрузка файлов (FormData)

Загрузка файла — это обычный `POST` с телом `FormData`, отдельной поддержки не нужно. Соберите
`FormData` внутри эффекта [`createRequestFx`](/ru/api/http) и передайте в `createMutation`.

```ts
import { createRequestFx, createMutation } from 'effector-refetch';

interface UploadResult {
  url: string;
}

const uploadFx = createRequestFx<{ file: Blob; name: string; tags: string[] }, UploadResult>(
  ({ file, name, tags }, { signal }) => {
    const body = new FormData();
    body.append('file', file, 'upload.txt');
    body.append('name', name);
    tags.forEach((tag) => body.append('tags', tag)); // повторяющееся поле = массив
    return fetch('/api/upload', { method: 'POST', body, signal }).then((r) => r.json());
  },
);

export const uploadMutation = createMutation({ effect: uploadFx, retry: 1 });

uploadMutation.mutate({ file, name: 'avatar', tags: ['a', 'b'] });
```

::: warning Не выставляйте `Content-Type`
Оставьте его — рантайм сам проставит `multipart/form-data` **с boundary**. Если выставить вручную,
запрос сломается.
:::

Всё остальное — обычная мутация: `$pending` крутит спиннер, `$error` — нормализованный
`RequestError`, `retry` перезаливает, а `cancel()` / `reset()` прерывают запрос в полёте через
`signal` (загрузка реально останавливается).

## Прогресс загрузки

`fetch` не умеет сообщать прогресс **отдачи**, поэтому для прогресс-бара оберните
`XMLHttpRequest` — это всё ещё просто эффект. Кладите прогресс в стор и уважайте `signal`:

```ts
import { createStore, createEvent } from 'effector';
import { createRequestFx, createMutation } from 'effector-refetch';

const progress = createEvent<number>(); // 0..1
export const $uploadProgress = createStore(0).on(progress, (_, p) => p);

const uploadFx = createRequestFx<{ file: File }, { url: string }>(
  ({ file }, { signal }) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const body = new FormData();
      body.append('file', file);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) progress(e.loaded / e.total);
      });
      xhr.addEventListener('load', () =>
        xhr.status < 400 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(`HTTP ${xhr.status}`)),
      );
      xhr.addEventListener('error', () => reject(new Error('Network error')));
      // signal принадлежит запросу — cancel()/reset()/TAKE_LATEST прервут загрузку
      signal.addEventListener('abort', () => xhr.abort());

      xhr.open('POST', '/api/upload');
      xhr.send(body);
    }),
);

export const uploadMutation = createMutation({ effect: uploadFx });
```

`progress` — обычное событие, так что `$uploadProgress` — обычный стор, биндится через `useUnit`
как любое состояние. Сбрасывайте его на `uploadMutation.finished.finally`, если нужно обнулять
после каждой загрузки.

Сочетайте загрузки с [`invalidate`](/ru/api/mutations) (обновить галерею после успешной загрузки)
или [`optimisticUpdate`](/ru/recipes/optimistic) (показать новый элемент сразу). Рабочий пример:
[`examples/form-data.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/form-data.ts).
