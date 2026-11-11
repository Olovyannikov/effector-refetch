# Локальная разработка

Хотите дорабатывать сам **effector-refetch** (а не просто его использовать)? Вот как поднять репозиторий.

## Требования

- **Node ≥ 22.13** (требование закреплённого pnpm).
- **pnpm 11.5.1** — версия закреплена через `packageManager`. Проще всего через Corepack:

```bash
corepack enable
```

## Клонирование и установка

```bash
git clone https://github.com/Olovyannikov/effector-refetch.git
cd effector-refetch
pnpm install
```

## Скрипты

| скрипт               | что делает                                                    |
| -------------------- | ------------------------------------------------------------- |
| `pnpm build`         | Сборка библиотеки (`dist/`) — все точки входа + `.d.ts`       |
| `pnpm typecheck`     | `tsc --noEmit`                                                |
| `pnpm lint`          | ESLint (вкл. `eslint-plugin-effector`)                        |
| `pnpm format`        | Prettier (запись; `format:check` — только проверка)           |
| `pnpm test`          | Прогон тестов Vitest (`test:watch` — в watch-режиме)          |
| `pnpm test:coverage` | Тесты с покрытием v8 (пороги обязательны)                     |
| `pnpm size`          | Проверка бюджета бандла (size-limit)                          |
| `pnpm attw`          | Сборка + проверка публикуемых типов (`@arethetypeswrong/cli`) |
| `pnpm docs:dev`      | Запуск этой документации локально                             |
| `pnpm docs:build`    | Сборка доки (заодно проверка битых ссылок)                    |
| `pnpm changeset`     | Запись changeset для изменения (управляет релизами)           |

## Как внести изменение

1. Ветка от `main`.
2. Изменение с тестом (набор гоняется под `fork`/`allSettled` ради scope-безопасности).
3. Прогоните гейт: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:coverage && pnpm build && pnpm attw && pnpm size`.
4. Добавьте changeset: `pnpm changeset` (выберите `patch`/`minor`/`major` и напишите строку — она
   попадёт в changelog).
5. Откройте PR. При мерже в `main` CI открывает PR «Version Packages»; его мерж публикует в npm.

## Git-хуки

`pnpm install` ставит хуки [lefthook](https://lefthook.dev) (через скрипт `prepare`) — они гоняют те
же проверки, что и CI, ещё до отправки в remote:

| хук          | что запускает                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `pre-commit` | Prettier (автофикс и ре-стейдж staged-файлов), ESLint, `tsc --noEmit`                                 |
| `commit-msg` | [commitlint](https://commitlint.js.org) — [Conventional Commits](https://www.conventionalcommits.org) |
| `pre-push`   | `pnpm test:coverage` (полный набор + пороги покрытия)                                                 |

Сообщения коммитов — `type(scope): subject` (`feat` / `fix` / `docs` / `style` / `refactor` /
`perf` / `test` / `build` / `ci` / `chore`). Обойти при необходимости — `git commit --no-verify`.

## Проверка на приложении

Запускайте примеры прямо из исходников (без сборки) через [tsx](https://github.com/privatenumber/tsx):

```bash
npx tsx examples/graphql.ts
```

Либо `pnpm build` и `pnpm pack` — получите tarball, который можно `pnpm add` в другой проект.

## PR-превью и канарейка

На каждый pull request автоматически поднимаются два стенда:

- **Превью доки** — сайт собирается и грузится как скачиваемый **артефакт** воркфлоу
  (`docs-preview-pr-<N>`). _(Прод-дока занимает единственный источник GitHub Pages, поэтому превью
  не живой URL; для живого — внешний хост, см. ниже.)_
- **Канарейка пакета** — [pkg.pr.new](https://pkg.pr.new) публикует превью-сборку, которую можно
  поставить прямо из PR: `npm i https://pkg.pr.new/Olovyannikov/effector-refetch@<sha>` (без
  засорения npm). Бот комментирует точную команду.

## Continuous integration (GitHub Actions)

Воркфлоу в `.github/workflows/`:

| Воркфлоу              | Триггер       | Что делает                                                                    |
| --------------------- | ------------- | ----------------------------------------------------------------------------- |
| `ci.yml`              | push / PR     | typecheck · lint · format:check · test (coverage) · build · attw · size-limit |
| `release.yml`         | push в `main` | changesets: открывает PR «Version Packages»; при его мерже публикует в npm    |
| `docs.yml`            | push в `main` | собирает доку и деплоит на GitHub Pages (через Actions-артефакт)              |
| `pr-preview.yml`      | pull_request  | собирает доку PR и грузит её скачиваемым артефактом                           |
| `pkg-pr-new.yml`      | push / PR     | публикует канарейку через pkg.pr.new                                          |
| `release-codemod.yml` | ручной запуск | публикует пакет `effector-refetch-codemod` (из `codemod/`) в npm              |

### Что нужно включить в репозитории один раз

Эти настройки включает мейнтейнер вручную (Actions сам их не настроит):

1. **Pages** — Settings → Pages → Source: **GitHub Actions**. (`docs.yml` деплоит собранный сайт
   через Pages-артефакт.)
2. **Права воркфлоу** — Settings → Actions → General → **Read and write permissions** и
   **Allow GitHub Actions to create and approve pull requests** (для PR «Version Packages»).
3. **Доступ к публикации в npm.** Два способа, по предпочтительности:
   - **Trusted publishing (OIDC) — вообще без токена.** На npmjs.com: страница пакета → Settings
     → **Trusted Publisher** → GitHub Actions, владелец `Olovyannikov`, репозиторий
     `effector-refetch`, workflow **`release.yml`** (именно имя файла, а не отображаемое имя),
     environment оставить пустым. `release.yml` уже выдаёт `id-token: write` — это всё, что
     требуется со стороны репозитория. После первой успешной публикации таким способом секрет
     `NPM_TOKEN` можно удалить: нечего ротировать и нечему протухать.
   - **Секрет `NPM_TOKEN`** — запасной путь, и его по-прежнему использует `release-codemod.yml`.
     Нужен классический **Automation**-токен или Granular с _«bypass 2FA»_; классический
     **Publish**-токен 2FA **не** обходит и падает с
     `E403 … two-factor authentication … is required`.

   pnpm сначала пробует OIDC и откатывается на токен, записывая в лог
   `Skipped OIDC: ERR_PNPM_AUTH_TOKEN_EXCHANGE … (status code 404)`, когда доверенный издатель не
   зарегистрирован, — этот 404 и означает, что первый пункт ещё не сделан.

4. **GitHub App pkg.pr.new** — установите [`pkg-pr-new`](https://github.com/apps/pkg-pr-new) на
   репозиторий, чтобы канарейка публиковалась (до этого шаг — no-op / non-blocking).

Нужны **живые** URL превью на каждый PR? Направьте `pr-preview.yml` на внешний хост (Cloudflare
Pages, Netlify, Vercel) — нужен аккаунт и токен-секрет, зато прод-деплой Pages не затрагивается.

Генераторы доки (`scripts/gen-api.mjs`, `scripts/gen-llms.mjs`) запускаются внутри `docs:build`,
поэтому и `docs.yml`, и `pr-preview.yml` всегда отдают свежий API-референс и `llms.txt`.
