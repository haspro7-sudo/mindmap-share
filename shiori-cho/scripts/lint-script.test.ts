// `npm run lint` must actually lint: an unknown or mis-valued oxlint flag makes oxlint exit 1 before it checks
// anything, which silently turned off react/no-danger and stopped the CI workflow (and the Pages deploy) at
// the lint step. This runs the package.json script's own command line.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('npm run lint', () => {
  it('runs oxlint over src and scripts without an argument error', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const [bin, ...args] = pkg.scripts.lint!.trim().split(/\s+/);
    expect(bin).toBe('oxlint');
    expect(args).toEqual(expect.arrayContaining(['src', 'scripts']));
    const run = spawnSync(join(ROOT, 'node_modules', '.bin', bin!), args, { cwd: ROOT, encoding: 'utf8' });
    expect(run.error).toBeUndefined();
    expect(`${run.stderr}`).not.toMatch(/no such argument|unexpected argument/i);
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
  });
});
