import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { get } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { runGitGate } from '../src/git-gate.js';
import { createSessionStore } from '../src/sessions.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const stopped = 'Sphinx: no questionnaire page was open for 1 minute, so this push stopped. Your progress is saved; push again to reopen the questionnaire.';

// The browser shows the page as it opens it, and the person closes the tab once the page asks
// something. The clock runs only while no page is open, so it stops the push at that step on any machine.
const openBrowser = url => new Promise((resolve, reject) => {
  const request = get(`${url}/events`, response => {
    let seen = '';
    response.setEncoding('utf8').on('data', chunk => {
      seen += chunk;
      if (/"phase":"(?:consent|question|recovery)"/.test(seen)) { response.destroy(); request.destroy(); }
    });
    resolve('foreground');
  });
  request.once('error', reject);
});

// A GUI Git client pushes a small change to each of `refs`. It needs no questions, so each
// destination passes and the last one asks whether to continue; nobody answers.
async function abandonedPush(t, refs) {
  const home = await mkdtemp(path.join(tmpdir(), 'sphinx-abandon-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo'), gitConfig = path.join(home, 'gitconfig');
  await writeFile(gitConfig, '');
  await promisify(execFile)('git', ['init', '-q', repoRoot], { env: { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' } });
  const env = { SPHINX_HOME: path.join(home, 'state'), SPHINX_USER_HOME: home };
  const config = { ...DEFAULT_CONFIG, interface: 'browser' }, readConfig = async () => config, revalidate = async () => true;
  const snapshots = refs.map((ref, index) => ({ id: 'ab'[index].repeat(64), repoRoot, event: 'pre-push', target: { ref }, files: ['app.js'], stats: { additions: 5, deletions: 1, files: 1 } }));
  const store = createSessionStore({ env, generate: async (_s, _c, options) => { await options.beforeCall(); return { questions: [], noQuestionReason: 'Only renames a local variable; behavior is unchanged.' }; } });
  const output = [];
  const code = await runGitGate({ event: 'pre-push', cwd: repoRoot, env, store, snapshotsFor: async () => snapshots, readConfig, revalidate,
    readYolo: async () => null, stamp: async () => {}, output: line => output.push(line),
    // The questionnaire reads the same sessions and settings, and never reaches a model, npm, or a real browser.
    interview: { store, readConfig, revalidate, findPlans: async () => [], checkUpdate: async () => null, terminal: false, openBrowser, notify: () => false, abandonMs: 50, watchMs: 10 } });
  return { code, output, held: await Promise.all(snapshots.map(async snapshot => !!(await store.read(snapshot.id)).held)) };
}

test('an abandoned consent step stops the push and keeps the pass held', async t => {
  const { code, output, held } = await abandonedPush(t, ['refs/heads/main']);
  assert.equal(code, 1, output.join('\n'));
  assert.ok(output.includes(stopped), output.join('\n'));
  assert.ok(output.some(line => line.includes('Your pass is saved')), output.join('\n'));
  assert.deepEqual(held, [true]);
});

test('abandoning the last destination holds every pass in the push', async t => {
  const { code, output, held } = await abandonedPush(t, ['refs/heads/main', 'refs/heads/master']);
  assert.equal(code, 1, output.join('\n'));
  assert.ok(output.includes(stopped), output.join('\n'));
  assert.deepEqual(held, [true, true]);
});
