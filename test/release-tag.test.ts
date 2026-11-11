import { describe, it, expect } from 'vitest';
import { ensureTag } from '../scripts/release.mjs';

/** Fake command runner: scripted replies, recorded calls. */
function runner(replies: Record<string, string | Error> = {}) {
  const calls: string[] = [];
  const run = (cmd: string) => {
    calls.push(cmd);
    for (const [pattern, reply] of Object.entries(replies)) {
      if (cmd.includes(pattern)) {
        if (reply instanceof Error) throw reply;
        return reply;
      }
    }
    return '';
  };
  return { run, calls };
}

const logger = () => {
  const lines: string[] = [];
  return { log: (m: string) => lines.push(m), lines };
};

const ARGS = { name: 'effector-refetch', version: '1.2.3' };

describe('ensureTag', () => {
  it('creates and pushes an annotated tag when it does not exist', () => {
    // rev-parse fails (no local tag), ls-remote is empty (no remote tag)
    const { run, calls } = runner({ 'rev-parse': new Error('not found') });
    const { log, lines } = logger();

    ensureTag({ ...ARGS, run, log });

    expect(calls.some((c) => c.includes('tag -a v1.2.3'))).toBe(true);
    expect(calls.some((c) => c.includes('push origin v1.2.3'))).toBe(true);
    expect(lines.join('\n')).toContain('v1.2.3');
  });

  it('is a no-op when the tag already exists locally', () => {
    const { run, calls } = runner({ 'rev-parse': 'abc123' });
    const { log } = logger();

    ensureTag({ ...ARGS, run, log });

    expect(calls.some((c) => c.includes('tag -a'))).toBe(false);
    expect(calls.some((c) => c.includes('push origin'))).toBe(false);
  });

  it('is a no-op when the tag already exists on the remote', () => {
    const { run, calls } = runner({
      'rev-parse': new Error('not found'),
      'ls-remote': 'abc123\trefs/tags/v1.2.3',
    });
    const { log } = logger();

    ensureTag({ ...ARGS, run, log });

    expect(calls.some((c) => c.includes('tag -a'))).toBe(false);
  });

  it('sets a git identity only when the environment has none', () => {
    const withIdentity = runner({ 'rev-parse': new Error('x'), 'config user.email': 'me@example.com' });
    ensureTag({ ...ARGS, run: withIdentity.run, log: logger().log });
    expect(withIdentity.calls.some((c) => c.includes('config user.email "'))).toBe(false);

    const without = runner({ 'rev-parse': new Error('x') }); // config returns ''
    ensureTag({ ...ARGS, run: without.run, log: logger().log });
    expect(without.calls.some((c) => c.includes('config user.email "'))).toBe(true);
  });

  it('warns instead of throwing when the push fails — the package is already on npm', () => {
    const { run, calls } = runner({
      'rev-parse': new Error('not found'),
      'push origin': new Error('permission denied'),
    });
    const { log, lines } = logger();

    expect(() => ensureTag({ ...ARGS, run, log })).not.toThrow();
    expect(calls.some((c) => c.includes('tag -a v1.2.3'))).toBe(true);
    expect(lines.join('\n').toLowerCase()).toContain('could not push');
  });
});
