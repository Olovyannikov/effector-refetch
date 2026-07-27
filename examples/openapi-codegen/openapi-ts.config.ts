import { defineConfig } from '@hey-api/openapi-ts';
import { defineConfig as effectorRefetch } from 'effector-refetch/openapi';

export default defineConfig({
  input: './petstore.json',
  output: './src/api',
  plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch', effectorRefetch()],
});
