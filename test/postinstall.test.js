import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/postinstall.js', import.meta.url));

test('the install hint never fails, writes nothing to captured output, and changes no files', async t => {
  for (const extra of [{ npm_config_global: 'true' }, { npm_config_global: 'true', CI: '1' }, {}]) {
    const cwd = await mkdtemp(path.join(tmpdir(), 'sphinx-postinstall-'));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const result = spawnSync(process.execPath, [script], { cwd, env: { PATH: process.env.PATH, SPHINX_HOME: '/nonexistent-sphinx-home', ...extra }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.toString() + result.stderr.toString(), '');
    assert.deepEqual(await readdir(cwd), []);
  }
});
