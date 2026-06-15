---
'effector-refetch': minor
---

Error guards for narrowing `$error` / `finished.fail`: `isRequestError`, `isHttpError(e, status?)`
(matches a code or a predicate), `isTimeoutError`, and `isValidationError`. Typed `is`-predicates
that replace `instanceof` + `.status` casts — the farfetched-style "error guards" utility.

```ts
import { isHttpError, isTimeoutError } from 'effector-refetch';
sample({
  clock: api.finished.fail,
  filter: ({ error }) => isHttpError(error, 401),
  target: authBarrier.lock,
});
```
