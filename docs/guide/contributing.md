# Local development

Want to hack on **effector-refetch** itself (not just use it)? Here's how to get the repo running.

## Prerequisites

- **Node ≥ 22.13** (required by the pinned pnpm).
- **pnpm 11.5.1** — the repo pins it via `packageManager`. The easiest way is Corepack:

```bash
corepack enable
```

## Clone & install

```bash
git clone https://github.com/Olovyannikov/effector-refetch.git
cd effector-refetch
pnpm install
```

## Scripts

| script               | what it does                                            |
| -------------------- | ------------------------------------------------------- |
| `pnpm build`         | Build the library (`dist/`) — all entries + `.d.ts`     |
| `pnpm typecheck`     | `tsc --noEmit`                                          |
| `pnpm lint`          | ESLint (incl. `eslint-plugin-effector`)                 |
| `pnpm format`        | Prettier write (`format:check` to verify only)          |
| `pnpm test`          | Run the Vitest suite once (`test:watch` for watch)      |
| `pnpm test:coverage` | Run tests with v8 coverage (thresholds enforced)        |
| `pnpm size`          | Check bundle budgets (size-limit)                       |
| `pnpm attw`          | Build + check published types (`@arethetypeswrong/cli`) |
| `pnpm docs:dev`      | Run this documentation site locally                     |
| `pnpm docs:build`    | Build the docs (also checks for dead links)             |
| `pnpm changeset`     | Record a changeset for your change (drives releases)    |

## Making a change

1. Branch off `main`.
2. Make the change with a test (the suite runs under `fork`/`allSettled` for scope-safety).
3. Run the gate: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:coverage && pnpm build && pnpm attw && pnpm size`.
4. Add a changeset: `pnpm changeset` (pick `patch`/`minor`/`major` and write a line — it becomes
   the changelog entry).
5. Open a PR. On merge to `main`, CI opens a "Version Packages" PR; merging that publishes to npm.

## Git hooks

`pnpm install` installs [lefthook](https://lefthook.dev) hooks (via the `prepare` script), which run
the same checks as CI before they reach the remote:

| hook         | runs                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `pre-commit` | Prettier (auto-fixes & re-stages staged files), ESLint, `tsc --noEmit`                                |
| `commit-msg` | [commitlint](https://commitlint.js.org) — [Conventional Commits](https://www.conventionalcommits.org) |
| `pre-push`   | `pnpm test:coverage` (the full suite + coverage thresholds)                                           |

Commit messages follow `type(scope): subject` (`feat` / `fix` / `docs` / `style` / `refactor` /
`perf` / `test` / `build` / `ci` / `chore`). Bypass in a pinch with `git commit --no-verify`.

## Trying it against an app

Run the examples directly from source (no build step) with [tsx](https://github.com/privatenumber/tsx):

```bash
npx tsx examples/graphql.ts
```

Or `pnpm build` and `pnpm pack` to get a tarball you can `pnpm add` into another project.

## PR previews & canary builds

Every pull request gets two automatic stands:

- **Docs preview** — the site is built and uploaded as a downloadable workflow **artifact**
  (`docs-preview-pr-<N>`). _(The production docs own the single GitHub Pages source, so previews
  aren't a live URL; for that, deploy previews to an external host — see below.)_
- **Canary package** — [pkg.pr.new](https://pkg.pr.new) publishes a preview build you can install
  straight from the PR: `npm i https://pkg.pr.new/Olovyannikov/effector-refetch@<sha>` (no npm
  pollution). The bot comments the exact command.

## Continuous integration (GitHub Actions)

Workflows under `.github/workflows/`:

| Workflow              | Trigger         | What it does                                                                                    |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `ci.yml`              | push / PR       | typecheck · lint · format:check · test (coverage) · build · attw · size-limit                   |
| `release.yml`         | push to `main`  | changesets: opens a "Version Packages" PR; on its merge, publishes to npm and tags `v<version>` |
| `docs.yml`            | push to `main`  | builds the docs and deploys them to GitHub Pages (Actions artifact)                             |
| `pr-preview.yml`      | pull_request    | builds the PR docs and uploads them as a downloadable artifact                                  |
| `pkg-pr-new.yml`      | push / PR       | publishes a canary via pkg.pr.new                                                               |
| `release-codemod.yml` | manual dispatch | publishes the `effector-refetch-codemod` package (in `codemod/`) to npm                         |

### Required repository setup

These need to be enabled once by a maintainer (Actions can't configure them itself):

1. **Pages** — Settings → Pages → Source: **GitHub Actions**. (`docs.yml` deploys the built site
   via the Pages artifact.)
2. **Workflow permissions** — Settings → Actions → General → **Read and write permissions**, and
   **Allow GitHub Actions to create and approve pull requests** (for the Version Packages PR).
3. **npm publishing credentials.** Two ways, in order of preference:
   - **Trusted publishing (OIDC) — no token at all.** The setting lives on the **package**, not
     on your account — looking under Account settings → Packages is the usual wrong turn
     ([npm/cli#8910](https://github.com/npm/cli/issues/8910)). Go straight to:

     **<https://www.npmjs.com/package/effector-refetch/access>**

     There, under **Trusted Publishers**, click **Add provider** → GitHub Actions and fill in:

     | field               | value              |
     | ------------------- | ------------------ |
     | Organization / user | `Olovyannikov`     |
     | Repository          | `effector-refetch` |
     | Workflow filename   | `release.yml`      |
     | Environment         | _(leave empty)_    |

     The workflow filename is the file in `.github/workflows/`, not the workflow's display name
     ("Release"). The repo side is already done — `release.yml` grants `id-token: write`, CI runs
     Node 22 and pnpm 11.5.1, and `package.json` carries the matching `repository` URL. Once a
     release publishes this way, delete the `NPM_TOKEN` secret — nothing to rotate, nothing to
     expire; optionally then set **Publishing access → Require two-factor authentication and
     disallow tokens** on the same page.

     The section only exists once a package has been published at least once, which is why it is
     a post-first-release step rather than part of the initial setup.

   - **`NPM_TOKEN` secret** — the fallback, and what `release-codemod.yml` still uses. It must be
     a classic **Automation** token or a Granular token with _"bypass 2FA"_; a classic
     **Publish** token does **not** bypass 2FA and fails with
     `E403 … two-factor authentication … is required`.

   pnpm tries OIDC first and falls back to the token, logging
   `Skipped OIDC: ERR_PNPM_AUTH_TOKEN_EXCHANGE … (status code 404)` when no trusted publisher is
   registered — that 404 is the signal that step 3's first bullet has not been done.

4. **pkg.pr.new GitHub App** — install [`pkg-pr-new`](https://github.com/apps/pkg-pr-new) on the
   repo so the canary workflow can publish (it's a no-op / non-blocking until then).

Want **live** per-PR doc URLs? Point `pr-preview.yml` at an external host (Cloudflare Pages,
Netlify, Vercel) — that needs an account and a token secret, but leaves the production Pages
deploy untouched.

The docs generators (`scripts/gen-api.mjs`, `scripts/gen-llms.mjs`) run inside `docs:build`, so
both `docs.yml` and `pr-preview.yml` always ship a fresh API reference and `llms.txt`.
