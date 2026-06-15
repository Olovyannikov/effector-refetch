import { defineConfig } from 'vitepress';
import { transformerTwoslash } from '@shikijs/vitepress-twoslash';
import { fileURLToPath } from 'node:url';

// Resolve `import … from 'effector-refetch'` (and subpaths) in `ts twoslash`
// snippets against the local source, so type-checked examples match the build.
const src = fileURLToPath(new URL('../../src', import.meta.url));
const twoslashPaths = {
  'effector-refetch': [`${src}/index.ts`],
  'effector-refetch/react': [`${src}/react.ts`],
  'effector-refetch/vue': [`${src}/vue.ts`],
  'effector-refetch/solid': [`${src}/solid.ts`],
};

const enSidebar = {
  '/guide/': [
    {
      text: 'Guide',
      items: [
        { text: 'Introduction', link: '/guide/introduction' },
        { text: 'Getting started', link: '/guide/getting-started' },
        { text: 'Core concepts', link: '/guide/concepts' },
        { text: 'vs. farfetched', link: '/guide/vs-farfetched' },
        { text: 'Migration', link: '/guide/migration' },
        { text: 'LLMs & AI agents', link: '/guide/llms' },
        { text: 'Local development', link: '/guide/contributing' },
      ],
    },
  ],
  '/api/': [
    {
      text: 'Queries',
      items: [
        { text: 'createQuery', link: '/api/queries' },
        { text: 'Operators (retry / cache / concurrency / timeout / keepFresh)', link: '/api/operators' },
        { text: 'connectQuery', link: '/api/queries#connectquery' },
        { text: 'createInfiniteQuery', link: '/api/pagination#createinfinitequery' },
        { text: 'combineQueries', link: '/api/pagination#combinequeries-parallel-queries' },
      ],
    },
    {
      text: 'Mutations',
      items: [
        { text: 'createMutation', link: '/api/mutations#createmutation' },
        { text: 'invalidate', link: '/api/mutations#invalidate' },
        { text: 'update / optimisticUpdate', link: '/api/mutations#update' },
      ],
    },
    {
      text: 'HTTP & validation',
      items: [
        { text: 'createRequestFx', link: '/api/http#createrequestfx' },
        { text: 'createJsonQuery', link: '/api/http#createjsonquery' },
        { text: 'createJsonMutation', link: '/api/http#createjsonmutation' },
        { text: 'createJsonRequestFx', link: '/api/http#createjsonrequestfx' },
        { text: 'Validation (contracts)', link: '/api/http#validation-contracts' },
      ],
    },
    {
      text: 'Bindings & tooling',
      items: [
        { text: 'useQuery (React / Vue / Solid)', link: '/api/bindings' },
        { text: 'useSuspenseQuery', link: '/api/bindings#suspense-react' },
        { text: 'Devtools', link: '/api/devtools' },
        { text: 'Introspection', link: '/api/introspection' },
        { text: 'API reference (generated)', link: '/api/reference' },
      ],
    },
  ],
  '/recipes/': [
    {
      text: 'Fetching & caching',
      items: [
        { text: 'SSR & testing', link: '/recipes/ssr-and-testing' },
        { text: 'Auto-refetch & polling', link: '/recipes/auto-refetch' },
        { text: 'Dependent queries', link: '/recipes/dependent-queries' },
        { text: 'Selecting slices', link: '/recipes/select' },
        { text: 'Error handling', link: '/recipes/error-handling' },
      ],
    },
    {
      text: 'Mutations & lists',
      items: [
        { text: 'Optimistic updates', link: '/recipes/optimistic' },
        { text: 'List updates', link: '/recipes/list-updates' },
      ],
    },
    {
      text: 'Architecture',
      items: [
        { text: 'Shared defaults (factory)', link: '/recipes/defaults' },
        { text: 'Groups & cache access', link: '/recipes/groups-and-cache' },
        { text: 'Shared request factory', link: '/recipes/shared-factory' },
        { text: 'Auth & barrier', link: '/recipes/auth-barrier' },
      ],
    },
    {
      text: 'Integrations',
      items: [
        { text: 'Streaming (SSE & WS)', link: '/recipes/streaming' },
        { text: 'File uploads (FormData)', link: '/recipes/file-uploads' },
        { text: 'GraphQL', link: '/recipes/graphql' },
        { text: 'Router & loaders', link: '/recipes/router' },
        { text: 'Inspector & logging', link: '/recipes/inspector' },
      ],
    },
  ],
};

const ruSidebar = {
  '/ru/guide/': [
    {
      text: 'Руководство',
      items: [
        { text: 'Введение', link: '/ru/guide/introduction' },
        { text: 'Быстрый старт', link: '/ru/guide/getting-started' },
        { text: 'Основные идеи', link: '/ru/guide/concepts' },
        { text: 'Сравнение с farfetched', link: '/ru/guide/vs-farfetched' },
        { text: 'Миграция', link: '/ru/guide/migration' },
        { text: 'LLM и AI-агенты', link: '/ru/guide/llms' },
        { text: 'Локальная разработка', link: '/ru/guide/contributing' },
      ],
    },
  ],
  '/ru/api/': [
    {
      text: 'Запросы',
      items: [
        { text: 'createQuery', link: '/ru/api/queries' },
        { text: 'Операторы (retry / cache / concurrency / timeout / keepFresh)', link: '/ru/api/operators' },
        { text: 'connectQuery', link: '/ru/api/queries#connectquery' },
        { text: 'createInfiniteQuery', link: '/ru/api/pagination#createinfinitequery' },
        { text: 'combineQueries', link: '/ru/api/pagination#combinequeries-параллельные-запросы' },
      ],
    },
    {
      text: 'Мутации',
      items: [
        { text: 'createMutation', link: '/ru/api/mutations#createmutation' },
        { text: 'invalidate', link: '/ru/api/mutations#invalidate' },
        { text: 'update / optimisticUpdate', link: '/ru/api/mutations#update' },
      ],
    },
    {
      text: 'HTTP и валидация',
      items: [
        { text: 'createRequestFx', link: '/ru/api/http#createrequestfx' },
        { text: 'createJsonQuery', link: '/ru/api/http#createjsonquery' },
        { text: 'createJsonMutation', link: '/ru/api/http#createjsonmutation' },
        { text: 'createJsonRequestFx', link: '/ru/api/http#createjsonrequestfx' },
        { text: 'Валидация (контракты)', link: '/ru/api/http' },
      ],
    },
    {
      text: 'Биндинги и инструменты',
      items: [
        { text: 'useQuery (React / Vue / Solid)', link: '/ru/api/bindings' },
        { text: 'useSuspenseQuery', link: '/ru/api/bindings#suspense-react' },
        { text: 'Devtools', link: '/ru/api/devtools' },
        { text: 'Интроспекция', link: '/ru/api/introspection' },
      ],
    },
  ],
  '/ru/recipes/': [
    {
      text: 'Загрузка и кэш',
      items: [
        { text: 'SSR и тесты', link: '/ru/recipes/ssr-and-testing' },
        { text: 'Авто-рефетч и поллинг', link: '/ru/recipes/auto-refetch' },
        { text: 'Зависимые запросы', link: '/ru/recipes/dependent-queries' },
        { text: 'Выбор срезов (select)', link: '/ru/recipes/select' },
        { text: 'Обработка ошибок', link: '/ru/recipes/error-handling' },
      ],
    },
    {
      text: 'Мутации и списки',
      items: [
        { text: 'Оптимистичные апдейты', link: '/ru/recipes/optimistic' },
        { text: 'Апдейты списков', link: '/ru/recipes/list-updates' },
      ],
    },
    {
      text: 'Архитектура',
      items: [
        { text: 'Общие дефолты (фабрика)', link: '/ru/recipes/defaults' },
        { text: 'Группы и кэш', link: '/ru/recipes/groups-and-cache' },
        { text: 'Общая фабрика запросов', link: '/ru/recipes/shared-factory' },
        { text: 'Авторизация и barrier', link: '/ru/recipes/auth-barrier' },
      ],
    },
    {
      text: 'Интеграции',
      items: [
        { text: 'Стриминг (SSE и WS)', link: '/ru/recipes/streaming' },
        { text: 'Загрузка файлов (FormData)', link: '/ru/recipes/file-uploads' },
        { text: 'GraphQL', link: '/ru/recipes/graphql' },
        { text: 'Роутер и loaders', link: '/ru/recipes/router' },
        { text: 'Инспектор и логи', link: '/ru/recipes/inspector' },
      ],
    },
  ],
};

export default defineConfig({
  title: 'effector-refetch',
  description: 'Friendly query layer for effector, built on real effects',
  // Overridable for per-PR previews (gh-pages subfolder): the preview workflow
  // sets DOCS_BASE=/effector-refetch/pr-preview/pr-N/ so assets resolve correctly.
  base: process.env.DOCS_BASE || '/effector-refetch/',
  lastUpdated: true,
  cleanUrls: true,
  markdown: {
    // Only fenced blocks tagged ```ts twoslash``` are type-checked; the rest stay plain.
    codeTransformers: [
      transformerTwoslash({
        twoslashOptions: {
          // Default target is ESNext (Promise/async available); no `lib` override
          // (which broke resolution), so twoslashed snippets avoid DOM-only globals.
          compilerOptions: { paths: twoslashPaths },
        },
      }),
    ],
  },
  themeConfig: {
    socialLinks: [{ icon: 'github', link: 'https://github.com/Olovyannikov/effector-refetch' }],
    search: { provider: 'local' },
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/guide/introduction' },
          { text: 'API', link: '/api/queries' },
          { text: 'Recipes', link: '/recipes/ssr-and-testing' },
          { text: 'Roadmap', link: 'https://github.com/Olovyannikov/effector-refetch/blob/main/ROADMAP.md' },
        ],
        sidebar: enSidebar,
        editLink: {
          pattern: 'https://github.com/Olovyannikov/effector-refetch/edit/main/docs/:path',
        },
        footer: { message: 'MIT Licensed', copyright: '© 2026 Ilya Olovyannikov' },
      },
    },
    ru: {
      label: 'Русский',
      lang: 'ru',
      link: '/ru/',
      themeConfig: {
        nav: [
          { text: 'Руководство', link: '/ru/guide/introduction' },
          { text: 'API', link: '/ru/api/queries' },
          { text: 'Рецепты', link: '/ru/recipes/ssr-and-testing' },
          { text: 'Roadmap', link: 'https://github.com/Olovyannikov/effector-refetch/blob/main/ROADMAP.md' },
        ],
        sidebar: ruSidebar,
        editLink: {
          pattern: 'https://github.com/Olovyannikov/effector-refetch/edit/main/docs/:path',
          text: 'Редактировать эту страницу на GitHub',
        },
        docFooter: { prev: 'Назад', next: 'Далее' },
        outline: { label: 'На этой странице' },
        lastUpdatedText: 'Обновлено',
        returnToTopLabel: 'Наверх',
        sidebarMenuLabel: 'Меню',
        darkModeSwitchLabel: 'Тема',
        langMenuLabel: 'Сменить язык',
        footer: { message: 'Под лицензией MIT', copyright: '© 2026 Илья Оловянников' },
      },
    },
  },
});
