# File uploads (FormData)

A file upload is just a `POST` with a `FormData` body — so it needs no special support. Build the
`FormData` inside a [`createRequestFx`](/api/http) effect and hand it to `createMutation`.

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
    tags.forEach((tag) => body.append('tags', tag)); // repeated field = array
    return fetch('/api/upload', { method: 'POST', body, signal }).then((r) => r.json());
  },
);

export const uploadMutation = createMutation({ effect: uploadFx, retry: 1 });

uploadMutation.mutate({ file, name: 'avatar', tags: ['a', 'b'] });
```

::: warning Don't set `Content-Type`
Leave it off — the runtime sets `multipart/form-data` **with the boundary** automatically. Setting
it by hand breaks the request.
:::

Everything else is a normal mutation: `$pending` drives a spinner, `$error` is a normalized
`RequestError`, `retry` re-uploads, and `cancel()` / `reset()` abort the in-flight request via the
`signal` (so the upload actually stops).

## Upload progress

`fetch` can't report **upload** progress, so for a progress bar wrap `XMLHttpRequest` instead — it's
still just an effect. Push progress into a store and honor the abort `signal`:

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
      // the query owns the signal — cancel()/reset()/TAKE_LATEST abort the upload
      signal.addEventListener('abort', () => xhr.abort());

      xhr.open('POST', '/api/upload');
      xhr.send(body);
    }),
);

export const uploadMutation = createMutation({ effect: uploadFx });
```

`progress` is a plain event, so `$uploadProgress` is just a store — bind it with `useUnit` like any
other state. Reset it on `uploadMutation.finished.finally` if you want it to clear after each upload.

Pair uploads with [`invalidate`](/api/mutations) (refresh a gallery after a successful upload) or
[`optimisticUpdate`](/recipes/optimistic) (show the new item immediately). Runnable:
[`examples/form-data.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/form-data.ts).
