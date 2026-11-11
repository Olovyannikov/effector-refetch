// Idempotent publish + tagging for the changesets release flow.
//
// changesets/action runs this whenever there are no pending changesets, so it
// fires on *every* push to main after a "Version Packages" merge — including
// no-op pushes where the current version is already on npm. `pnpm publish` is
// not idempotent (it 403s on a republish), and `changeset publish` crashes on
// pnpm's output, so we check the registry ourselves and publish only when the
// current version is missing.
//
// Everything here is idempotent on purpose: re-running it must converge, never
// duplicate. That is also what makes the tagging self-healing — a version that
// is published but untagged (every release before 0.26.1) gets its tag on the
// next run.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Run a command, return stdout. Throws on a non-zero exit. */
const exec = (cmd) =>
  execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();

/**
 * Create and push `v<version>` if it is not already there.
 *
 * `publish` has happened by the time this runs, so a failure here must NOT fail the
 * job: the package is on npm either way, and a red release job over a missing tag
 * reads as "the release broke". It warns loudly instead.
 *
 * @param {{ name: string, version: string, run?: (cmd: string) => string, log?: (msg: string) => void }} ctx
 */
export function ensureTag({ name, version, run = exec, log = console.log }) {
  const tag = `v${version}`;

  let exists = false;
  try {
    run(`git rev-parse -q --verify refs/tags/${tag}`);
    exists = true;
  } catch {
    // no local tag — check the remote too, so a re-run on a fresh checkout
    // doesn't try to push a tag that is already there
    try {
      exists = run(`git ls-remote --tags origin refs/tags/${tag}`) !== '';
    } catch {
      exists = false; // no remote / offline: fall through and let the push report it
    }
  }

  if (exists) {
    log(`${tag} already exists — nothing to tag.`);
    return;
  }

  // annotated tags need an identity, and a CI checkout may not have one
  let hasIdentity = false;
  try {
    hasIdentity = run('git config user.email') !== '';
  } catch {
    hasIdentity = false;
  }
  if (!hasIdentity) {
    run('git config user.email "github-actions[bot]@users.noreply.github.com"');
    run('git config user.name "github-actions[bot]"');
  }

  run(`git tag -a ${tag} -m "${name}@${version}"`);
  log(`Tagged ${tag}.`);

  try {
    run(`git push origin ${tag}`);
    log(`Pushed ${tag}.`);
  } catch (error) {
    log(`WARNING: could not push ${tag} — ${name}@${version} IS published, the tag is not.`);
    log(`  ${error instanceof Error ? error.message : String(error)}`);
    log(`  Push it by hand: git push origin ${tag}`);
  }
}

function main() {
  const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));

  let alreadyPublished = false;
  try {
    alreadyPublished = exec(`npm view ${name}@${version} version`) === version;
  } catch {
    alreadyPublished = false; // 404 — not on the registry yet
  }

  if (alreadyPublished) {
    console.log(`${name}@${version} is already published — nothing to do.`);
  } else {
    console.log(`Publishing ${name}@${version}…`);
    execSync('pnpm publish --no-git-checks', { stdio: 'inherit' });
  }

  // reached whether or not THIS run published: tags are self-healing
  ensureTag({ name, version });
}

// only when run as a script — importing this file (tests) must have no side effects
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
