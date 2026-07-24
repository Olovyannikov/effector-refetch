# GraphQL

GraphQL is just a `POST` with `{ query, variables }`, so it needs no special support — wrap one
document in a [`createRequestFx`](/api/http) effect and hand it to `createQuery` /
`createMutation`. A tiny factory keeps the endpoint, headers, abort signal, and error handling in
one place.

## A reusable client factory

```ts
import { createRequestFx, RequestError } from 'effector-refetch';

const ENDPOINT = 'https://countries.trevorblades.com/graphql';

interface GraphqlResponse<Data> {
  data?: Data;
  errors?: Array<{ message: string }>;
}

/** One GraphQL document -> an Abortable effect that takes its variables. */
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

Turning GraphQL `errors` into a `RequestError` is the important bit: now `retry`, `$error`, and
the inspector treat a GraphQL-level failure exactly like an HTTP one.

## A query

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

## Try it live

The same wiring against the real, public countries API — one document in `createRequestFx`
(GraphQL `errors` thrown as `RequestError`), `mapData` unwrapping `data.country`,
`cache: true` making repeated picks instant, `TAKE_LATEST` taming rapid clicks:

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
    // GraphQL-level errors become a RequestError — retry/$error treat them like HTTP ones
    if (json.errors?.length) {
      throw new RequestError(json.errors[0].message, { status: res.status, data: json.errors });
    }
    return json.data;
  },
);

const countryQuery = createQuery({
  effect: getCountryFx,
  cache: true, //                 repeated picks resolve from cache — no network
  concurrency: 'TAKE_LATEST', //  rapid clicking? only the last pick wins
  mapData: ({ result }) => result.country,
});

countryQuery.start({ code: 'BR' }); // variables ARE the params
```

</template>
</GraphqlCountriesDemo>

## A mutation

The same factory powers writes — just pass the effect to `createMutation`:

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

Because variables _are_ the effect's params, [`connectQuery`](/api/queries) and
[`combineQueries`](/api/queries) compose GraphQL operations just like REST ones.

Runnable: [`examples/graphql.ts`](https://github.com/Olovyannikov/effector-refetch/blob/main/examples/graphql.ts).
