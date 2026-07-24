# GraphQL

GraphQL — это обычный `POST` с `{ query, variables }`, поэтому особой поддержки не нужно:
оберните один документ в эффект [`createRequestFx`](/ru/api/http) и передайте в `createQuery` /
`createMutation`. Небольшая фабрика держит эндпоинт, заголовки, abort-сигнал и обработку ошибок
в одном месте.

## Переиспользуемая фабрика клиента

```ts
import { createRequestFx, RequestError } from 'effector-refetch';

const ENDPOINT = 'https://countries.trevorblades.com/graphql';

interface GraphqlResponse<Data> {
  data?: Data;
  errors?: Array<{ message: string }>;
}

/** Один GraphQL-документ -> Abortable-эффект, принимающий свои переменные. */
export function graphql<Data, Vars = Record<string, never>>(document: string) {
  return createRequestFx<Vars, Data>(async (variables, { signal }) => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: document, variables }),
      signal,
    });
    const json = (await res.json()) as GraphqlResponse<Data>;
    if (json.errors?.length) {
      throw new RequestError(json.errors[0].message, { status: res.status, data: json.errors });
    }
    return json.data as Data;
  });
}
```

Превращение GraphQL-`errors` в `RequestError` — ключевой момент: теперь `retry`, `$error` и
инспектор обрабатывают ошибку уровня GraphQL ровно так же, как HTTP-ошибку.

## Query

```ts
import { createQuery } from 'effector-refetch';

const getCountriesFx = graphql<{ countries: Country[] }, { continent: string }>(`
  query Countries($continent: String!) {
    countries(filter: { continent: { eq: $continent } }) {
      code
      name
      emoji
    }
  }
`);

const countriesQuery = createQuery({ effect: getCountriesFx, cache: { staleAfter: 60_000 } });

countriesQuery.start({ continent: 'EU' });
```

## Попробуйте вживую

Та же связка с настоящим публичным API стран — один документ в `createRequestFx`
(GraphQL-`errors` бросаются как `RequestError`), `mapData` разворачивает `data.country`,
`cache: true` делает повторные клики мгновенными, `TAKE_LATEST` укрощает быстрые клики:

<GraphqlCountriesDemo>
<template #code>

```ts
import { createQuery, createRequestFx, RequestError } from 'effector-refetch';

const getCountryFx = createRequestFx<{ code: string }, { country: Country | null }>(
  async (variables, { signal }) => {
    const res = await fetch('https://countries.trevorblades.com/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query Country($code: ID!) {
          country(code: $code) { name capital currency emoji languages { name } }
        }`,
        variables,
      }),
      signal,
    });
    const json = await res.json();
    // ошибки уровня GraphQL становятся RequestError — retry/$error видят их как HTTP-ошибки
    if (json.errors?.length) {
      throw new RequestError(json.errors[0].message, { status: res.status, data: json.errors });
    }
    return json.data;
  },
);

const countryQuery = createQuery({
  effect: getCountryFx,
  cache: true, //                 повторные клики берутся из кэша — без сети
  concurrency: 'TAKE_LATEST', //  быстрые клики? побеждает только последний
  mapData: ({ result }) => result.country,
});

countryQuery.start({ code: 'BR' }); // переменные И ЕСТЬ параметры
```

</template>
</GraphqlCountriesDemo>

## Mutation

Та же фабрика обслуживает и записи — просто передайте эффект в `createMutation`:

```ts
import { createMutation } from 'effector-refetch';

const addReviewFx = graphql<{ addReview: { id: string } }, { code: string; stars: number }>(`
  mutation AddReview($code: ID!, $stars: Int!) {
    addReview(code: $code, stars: $stars) {
      id
    }
  }
`);

const addReviewMutation = createMutation({ effect: addReviewFx, retry: 1 });

addReviewMutation.start({ code: 'EU', stars: 5 });
```

Поскольку переменные _и есть_ параметры эффекта, [`connectQuery`](/ru/api/queries) и
[`combineQueries`](/ru/api/queries) композируют GraphQL-операции так же, как REST.

Рабочий пример: [`examples/graphql.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/graphql.ts).
