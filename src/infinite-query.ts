import {
  createEffect,
  createEvent,
  createStore,
  sample,
  type Effect,
  type EventCallable,
  type Event,
  type Store,
} from 'effector';
import { createQuery } from './create-query';
import type { ConcurrencyStrategy, QueryStatus } from './types';

export interface GetNextPageParamCtx<PageParam, Page> {
  lastPage: Page;
  allPages: Page[];
  lastPageParam: PageParam;
  allPageParams: PageParam[];
}

export interface GetPreviousPageParamCtx<PageParam, Page> {
  firstPage: Page;
  allPages: Page[];
  firstPageParam: PageParam;
  allPageParams: PageParam[];
}

interface BaseInfiniteConfig<Params, PageParam, Page> {
  initialPageParam: PageParam;
  /** Return the next page param, or `null` / `undefined` when there are no more pages. */
  getNextPageParam: (ctx: GetNextPageParamCtx<PageParam, Page>) => PageParam | null | undefined;
  /** Enable `fetchPrevious`: return the previous page param, or `null`/`undefined` at the start. */
  getPreviousPageParam?: (ctx: GetPreviousPageParamCtx<PageParam, Page>) => PageParam | null | undefined;
  /** Cap accumulated pages — drops from the opposite end when exceeded. */
  maxPages?: number;
  concurrency?: ConcurrencyStrategy;
  name?: string;
  /** Label the public/internal units for the inspector even without a `name`. */
  debug?: boolean;
}

export interface CreateInfiniteQueryConfig<Params, PageParam, Page> extends BaseInfiniteConfig<
  Params,
  PageParam,
  Page
> {
  /** Effect fetching a single page. */
  effect: Effect<{ params: Params; pageParam: PageParam }, Page, unknown>;
}
export interface CreateInfiniteQueryHandlerConfig<Params, PageParam, Page> extends BaseInfiniteConfig<
  Params,
  PageParam,
  Page
> {
  handler: (ctx: { params: Params; pageParam: PageParam }) => Promise<Page> | Page;
}

export interface InfiniteQuery<Params, PageParam, Page, Error = unknown> {
  /** Load the first page (resets accumulated pages). */
  start: EventCallable<Params>;
  /** Load and append the next page (no-op when there is none, or while loading). */
  fetchNext: EventCallable<void>;
  /** Load and prepend the previous page (needs `getPreviousPageParam`). */
  fetchPrevious: EventCallable<void>;
  reset: EventCallable<void>;

  $pages: Store<Page[]>;
  /** Alias of `$pages`. */
  $data: Store<Page[]>;
  $pageParams: Store<PageParam[]>;
  $hasNextPage: Store<boolean>;
  $hasPreviousPage: Store<boolean>;
  $status: Store<QueryStatus>;
  $pending: Store<boolean>;
  $error: Store<Error | null>;
  $params: Store<Params | null>;

  finished: {
    done: Event<{ params: Params; page: Page }>;
    fail: Event<{ params: Params; error: Error }>;
  };

  /** Write seam for `update`/`optimisticUpdate` — patches the accumulated pages. */
  __: { setData: EventCallable<Page[] | null> };

  '@@unitShape': () => {
    pages: Store<Page[]>;
    data: Store<Page[]>;
    hasNextPage: Store<boolean>;
    hasPreviousPage: Store<boolean>;
    status: Store<QueryStatus>;
    pending: Store<boolean>;
    error: Store<Error | null>;
    start: EventCallable<Params>;
    fetchNext: EventCallable<void>;
    fetchPrevious: EventCallable<void>;
    reset: EventCallable<void>;
  };
}

interface PageReq<Params, PageParam> {
  params: Params;
  pageParam: PageParam;
  mode: 'reset' | 'append' | 'prepend';
}
interface InfiniteState<PageParam, Page> {
  pages: Page[];
  pageParams: PageParam[];
  nextPageParam: PageParam | null;
  hasNextPage: boolean;
  previousPageParam: PageParam | null;
  hasPreviousPage: boolean;
}

/**
 * Cursor/offset pagination that accumulates pages. `start` loads the first page
 * (resetting), `fetchNext` appends and (with `getPreviousPageParam`) `fetchPrevious`
 * prepends. `maxPages` caps the window. Built on `createQuery`.
 */
export function createInfiniteQuery<Params, PageParam, Page, Error = unknown>(
  config:
    | CreateInfiniteQueryConfig<Params, PageParam, Page>
    | CreateInfiniteQueryHandlerConfig<Params, PageParam, Page>,
): InfiniteQuery<Params, PageParam, Page, Error> {
  const { initialPageParam, getNextPageParam, getPreviousPageParam, maxPages } = config;

  // devtools labelling: name the public units when a `name` (or `debug`) is given.
  // The inner page query is prefixed `<name>.page` so its units (start/runFx/$data/…)
  // don't collide with this query's own `<name>.start` etc.
  const ns = config.name ?? (config.debug ? 'infinite' : undefined);
  const nm = (suffix: string) => (ns ? { name: `${ns}.${suffix}` } : undefined);
  const evName = (suffix: string): string | undefined => (ns ? `${ns}.${suffix}` : undefined);

  const call = (req: PageReq<Params, PageParam>): Promise<Page> =>
    'effect' in config
      ? (config.effect as (a: { params: Params; pageParam: PageParam }) => Promise<Page>)({
          params: req.params,
          pageParam: req.pageParam,
        })
      : Promise.resolve(config.handler({ params: req.params, pageParam: req.pageParam }));

  const pageFx = createEffect<PageReq<Params, PageParam>, Page, Error>({
    name: evName('pageFx'),
    handler: (req) => call(req) as Promise<Page>,
  });
  const pageQuery = createQuery<PageReq<Params, PageParam>, Page, Error>({
    effect: pageFx,
    concurrency: config.concurrency ?? 'TAKE_LATEST',
    name: config.name ? `${config.name}.page` : undefined,
    debug: config.debug,
  });

  const start = createEvent<Params>(evName('start'));
  const fetchNext = createEvent<void>(evName('fetchNext'));
  const fetchPrevious = createEvent<void>(evName('fetchPrevious'));
  const reset = createEvent<void>(evName('reset'));
  // write seam for update()/optimisticUpdate(): patch the accumulated pages
  const setData = createEvent<Page[] | null>(evName('setData'));

  const $params = createStore<Params | null>(null, nm('$params'))
    .on(start, (_p, params) => params)
    .reset(reset);

  const initial: InfiniteState<PageParam, Page> = {
    pages: [],
    pageParams: [],
    nextPageParam: null,
    hasNextPage: false,
    previousPageParam: null,
    hasPreviousPage: false,
  };
  const $infinite = createStore<InfiniteState<PageParam, Page>>(initial, nm('$infinite'))
    .on(pageQuery.finished.done, (state, { params: req, result: page }) => {
      let pages: Page[];
      let pageParams: PageParam[];
      if (req.mode === 'reset') {
        pages = [page];
        pageParams = [req.pageParam];
      } else if (req.mode === 'prepend') {
        pages = [page, ...state.pages];
        pageParams = [req.pageParam, ...state.pageParams];
      } else {
        pages = [...state.pages, page];
        pageParams = [...state.pageParams, req.pageParam];
      }

      if (maxPages != null && pages.length > maxPages) {
        if (req.mode === 'prepend') {
          pages = pages.slice(0, maxPages);
          pageParams = pageParams.slice(0, maxPages);
        } else {
          pages = pages.slice(-maxPages);
          pageParams = pageParams.slice(-maxPages);
        }
      }

      const next = getNextPageParam({
        lastPage: pages[pages.length - 1],
        allPages: pages,
        lastPageParam: pageParams[pageParams.length - 1],
        allPageParams: pageParams,
      });
      const prev = getPreviousPageParam
        ? getPreviousPageParam({
            firstPage: pages[0],
            allPages: pages,
            firstPageParam: pageParams[0],
            allPageParams: pageParams,
          })
        : undefined;

      return {
        pages,
        pageParams,
        nextPageParam: next ?? null,
        hasNextPage: next != null,
        previousPageParam: prev ?? null,
        hasPreviousPage: prev != null,
      };
    })
    .on(setData, (state, pages) => ({ ...state, pages: pages ?? [] }))
    .reset([reset, start]);

  const $pages = $infinite.map((s) => s.pages);
  const $pageParams = $infinite.map((s) => s.pageParams);
  const $hasNextPage = $infinite.map((s) => s.hasNextPage);
  const $hasPreviousPage = $infinite.map((s) => s.hasPreviousPage);

  // load first page
  sample({
    clock: start,
    fn: (params): PageReq<Params, PageParam> => ({ params, pageParam: initialPageParam, mode: 'reset' }),
    target: pageQuery.start,
  });

  // append next page when available and idle (hasNextPage is only true after a page loaded)
  sample({
    clock: fetchNext,
    source: { params: $params, inf: $infinite, pending: pageQuery.$pending },
    filter: ({ inf, pending }) => inf.hasNextPage && !pending,
    fn: ({ params, inf }): PageReq<Params, PageParam> => ({
      params: params as Params,
      pageParam: inf.nextPageParam as PageParam,
      mode: 'append',
    }),
    target: pageQuery.start,
  });

  // prepend previous page when available and idle
  sample({
    clock: fetchPrevious,
    source: { params: $params, inf: $infinite, pending: pageQuery.$pending },
    filter: ({ inf, pending }) => inf.hasPreviousPage && !pending,
    fn: ({ params, inf }): PageReq<Params, PageParam> => ({
      params: params as Params,
      pageParam: inf.previousPageParam as PageParam,
      mode: 'prepend',
    }),
    target: pageQuery.start,
  });

  const finishedDone = createEvent<{ params: Params; page: Page }>(evName('finished.done'));
  const finishedFail = createEvent<{ params: Params; error: Error }>(evName('finished.fail'));
  sample({
    clock: pageQuery.finished.done,
    fn: ({ params: req, result: page }) => ({ params: req.params, page }),
    target: finishedDone,
  });
  sample({
    clock: pageQuery.finished.fail,
    fn: ({ params: req, error }) => ({ params: req.params, error }),
    target: finishedFail,
  });

  return {
    start,
    fetchNext,
    fetchPrevious,
    reset,

    $pages,
    $data: $pages,
    $pageParams,
    $hasNextPage,
    $hasPreviousPage,
    $status: pageQuery.$status,
    $pending: pageQuery.$pending,
    $error: pageQuery.$error,
    $params,

    finished: { done: finishedDone, fail: finishedFail },

    __: { setData },

    '@@unitShape': () => ({
      pages: $pages,
      data: $pages,
      hasNextPage: $hasNextPage,
      hasPreviousPage: $hasPreviousPage,
      status: pageQuery.$status,
      pending: pageQuery.$pending,
      error: pageQuery.$error,
      start,
      fetchNext,
      fetchPrevious,
      reset,
    }),
  };
}
