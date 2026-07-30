import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allSettled, fork } from 'effector';
import { createClient } from '@hey-api/openapi-ts';
import { defineConfig as effectorRefetch } from '../src/openapi';

/**
 * End-to-end for the `infinite` codegen option: run @hey-api/openapi-ts over a spec with a
 * paginated operation, then import the generated module and page through a mocked `fetch`.
 */

const SPEC = {
  openapi: '3.0.3',
  info: { title: 'pets', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List pets, a page at a time',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PetsPage' } } },
          },
        },
      },
    },
    '/cursor-pets': {
      get: {
        operationId: 'cursorPets',
        parameters: [{ name: 'cursor', in: 'query', schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PetsPage' } } },
          },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPetById',
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
      },
      PetsPage: {
        type: 'object',
        required: ['items'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
          nextPage: { type: 'integer', nullable: true },
          nextCursor: { type: 'string', nullable: true },
        },
      },
    },
  },
};

// the cursor rule the generated file imports — the spec can't express it
const PAGINATION_MODULE = `
export const byNextPage = ({ lastPage }: { lastPage: { nextPage?: number | null } }) =>
  lastPage.nextPage ?? null;
export const byNextCursor = ({ lastPage }: { lastPage: { nextCursor?: string | null } }) =>
  lastPage.nextCursor ?? null;
`;

let dir: string;
let generated: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refetch-openapi-infinite-'));
  await writeFile(join(dir, 'spec.json'), JSON.stringify(SPEC));
  await createClient({
    input: join(dir, 'spec.json'),
    output: { path: join(dir, 'api'), format: false, lint: false },
    plugins: [
      '@hey-api/typescript',
      '@hey-api/sdk',
      '@hey-api/client-fetch',
      effectorRefetch({
        infinite: {
          // the rule differs per cursor kind, so it is chosen per operation
          getNextPageParam: ({ pageParam }) =>
            pageParam === 'cursor'
              ? { module: './pagination', name: 'byNextCursor' }
              : { module: './pagination', name: 'byNextPage' },
        },
      }),
    ],
    logs: { level: 'silent' },
  });
  // written after codegen: hey-api wipes the output directory before it writes
  await mkdir(join(dir, 'api'), { recursive: true });
  await writeFile(join(dir, 'api', 'pagination.ts'), PAGINATION_MODULE);
  generated = await readFile(join(dir, 'api', 'refetch.gen.ts'), 'utf8');
}, 30_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('openapi plugin — infinite codegen', () => {
  it('emits an infinite twin for the paginated operation only', () => {
    expect(generated).toMatch(/export const listPetsInfiniteQuery = createInfiniteQuery\(\{/);
    // the plain query is still generated alongside it
    expect(generated).toMatch(/export const listPetsQuery = createQuery\(\{/);
    // a non-paginated operation gets no twin
    expect(generated).not.toContain('getPetByIdInfiniteQuery');
  });

  it('wires the cursor into the query params and imports the user rule', () => {
    expect(generated).toContain('query: { ...params.query, page: pageParam }');
    expect(generated).toMatch(/import .*byNextPage.* from '\.\/pagination'/);
    expect(generated).toContain('getNextPageParam: byNextPage');
    // `page` counts from 1, typed from the spec
    expect(generated).toContain('initialPageParam: 1 as number');
    expect(generated).toContain('pageParam: number');
    // stable sids without the effector babel plugin
    expect(generated).toContain("name: 'listPets.infinite'");
  });

  it('pages through the SDK client', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        urls.push(request.url);
        const page = Number(new URL(request.url).searchParams.get('page'));
        return new Response(
          JSON.stringify({
            items: [{ id: page, name: `pet-${page}` }],
            nextPage: page < 3 ? page + 1 : null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
    try {
      const mod = await import(join(dir, 'api', 'refetch.gen.ts'));
      const scope = fork();

      await allSettled(mod.listPetsInfiniteQuery.start, { scope, params: { query: { limit: 1 } } });
      expect(scope.getState(mod.listPetsInfiniteQuery.$pages)).toHaveLength(1);
      expect(scope.getState(mod.listPetsInfiniteQuery.$hasNextPage)).toBe(true);

      await allSettled(mod.listPetsInfiniteQuery.fetchNext, { scope });
      await allSettled(mod.listPetsInfiniteQuery.fetchNext, { scope });

      const pages = scope.getState(mod.listPetsInfiniteQuery.$pages) as Array<{
        items: Array<{ name: string }>;
      }>;
      expect(pages.map((p) => p.items[0].name)).toEqual(['pet-1', 'pet-2', 'pet-3']);
      expect(scope.getState(mod.listPetsInfiniteQuery.$hasNextPage)).toBe(false);
      // the cursor rides in the query string, the caller's own params are preserved
      expect(urls).toEqual([
        'https://api.example.com/pets?limit=1&page=1',
        'https://api.example.com/pets?limit=1&page=2',
        'https://api.example.com/pets?limit=1&page=3',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);

  it('an opaque cursor is nullable and the first page goes out without it', async () => {
    expect(generated).toContain('initialPageParam: null as string | null');
    expect(generated).toContain(
      'query: pageParam == null ? params.query : { ...params.query, cursor: pageParam }',
    );

    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        urls.push(request.url);
        const cursor = new URL(request.url).searchParams.get('cursor');
        const n = cursor ? Number(cursor.replace('c', '')) : 0;
        return new Response(
          JSON.stringify({
            items: [{ id: n, name: `pet-${n}` }],
            nextCursor: n < 1 ? `c${n + 1}` : null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
    try {
      const mod = await import(join(dir, 'api', 'refetch.gen.ts'));
      const scope = fork();

      await allSettled(mod.cursorPetsInfiniteQuery.start, { scope, params: {} });
      await allSettled(mod.cursorPetsInfiniteQuery.fetchNext, { scope });

      expect(urls).toEqual([
        'https://api.example.com/cursor-pets', // no `?cursor=null` on the first page
        'https://api.example.com/cursor-pets?cursor=c1',
      ]);
      expect(scope.getState(mod.cursorPetsInfiniteQuery.$pages)).toHaveLength(2);
      expect(scope.getState(mod.cursorPetsInfiniteQuery.$hasNextPage)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);
});
