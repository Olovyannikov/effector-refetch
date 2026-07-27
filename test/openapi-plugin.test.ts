import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allSettled, fork } from 'effector';
import { createClient } from '@hey-api/openapi-ts';
import { defineConfig as effectorRefetch } from '../src/openapi';

/**
 * End-to-end: run @hey-api/openapi-ts with our plugin over a small spec,
 * then IMPORT the generated module (vitest aliases `effector-refetch` to
 * `../src`) and drive the generated query against a mocked `fetch`.
 */

const SPEC = {
  openapi: '3.0.3',
  info: { title: 'pets', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/pets/{petId}': {
      get: {
        operationId: 'getPetById',
        summary: 'Find pet by ID',
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
    },
    '/pets': {
      post: {
        operationId: 'addPet',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
        },
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
    },
  },
};

let dir: string;
let generated: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refetch-openapi-'));
  await writeFile(join(dir, 'spec.json'), JSON.stringify(SPEC));
  await createClient({
    input: join(dir, 'spec.json'),
    output: { path: join(dir, 'api'), format: false, lint: false },
    plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch', effectorRefetch()],
    logs: { level: 'silent' },
  });
  generated = await readFile(join(dir, 'api', 'refetch.gen.ts'), 'utf8');
}, 30_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('openapi plugin — generated source', () => {
  it('emits a query for GET and a mutation for POST, wired through createRequestFx', () => {
    expect(generated).toContain("from 'effector-refetch'");
    expect(generated).toMatch(/export const getPetByIdQuery = createQuery\(\{/);
    expect(generated).toMatch(/export const addPetMutation = createMutation\(\{/);
    // abortable + real errors + typed data
    expect(generated).toContain('signal, throwOnError: true');
    expect(generated).toContain('.then((r) => r.data)');
    expect(generated).toContain('Options<GetPetByIdData>');
    // stable unit/cache names without the effector babel plugin
    expect(generated).toContain("name: 'getPetById'");
    // JSDoc carries the operation summary
    expect(generated).toContain('Find pet by ID');
  });

  it('imports SDK functions and data types from the sibling generated files', () => {
    expect(generated).toMatch(/from '\.\/sdk\.gen'/);
    expect(generated).toMatch(/import type .*GetPetByIdData.*from '\.\/types\.gen'/);
  });
});

describe('openapi plugin — generated module runs', () => {
  it('generated query fetches through the SDK client and lands in $data', async () => {
    const seen: Array<{ url: string; hasSignal: boolean }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        seen.push({ url: request.url, hasSignal: request.signal instanceof AbortSignal });
        return new Response(JSON.stringify({ id: 7, name: 'Bella' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    try {
      const mod = await import(join(dir, 'api', 'refetch.gen.ts'));
      const scope = fork();

      await allSettled(mod.getPetByIdQuery.start, { scope, params: { path: { petId: 7 } } });

      expect(scope.getState(mod.getPetByIdQuery.$status)).toBe('done');
      expect(scope.getState(mod.getPetByIdQuery.$data)).toEqual({ id: 7, name: 'Bella' });
      expect(seen).toEqual([{ url: 'https://api.example.com/pets/7', hasSignal: true }]);

      // the POST twin is a mutation with the full surface
      expect(mod.addPetMutation.$status).toBeDefined();
      expect(typeof mod.addPetMutation.mutateAsync).toBe('function');
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);
});
