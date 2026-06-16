// Conventional Commits, enforced on commit-msg via lefthook.
// Matches the history: feat / fix / docs / style / refactor / perf / test / build / ci / chore.
export default {
  extends: ['@commitlint/config-conventional'],
  // The changesets bot commits "Version Packages" — exempt it (merge/revert/etc.
  // are already covered by commitlint's defaultIgnores).
  ignores: [(message) => message.startsWith('Version Packages')],
  rules: {
    // Prose and trailers (e.g. Co-Authored-By) wrap freely — don't gate on line length.
    'body-max-line-length': [0, 'always'],
    'footer-max-line-length': [0, 'always'],
  },
};
