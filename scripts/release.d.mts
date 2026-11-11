/** Type surface for the release script — `ensureTag` is imported by the test suite. */
export declare function ensureTag(ctx: {
  name: string;
  version: string;
  /** Command runner; defaults to `execSync` returning trimmed stdout. */
  run?: (cmd: string) => string;
  log?: (msg: string) => void;
}): void;
