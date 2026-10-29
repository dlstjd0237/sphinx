import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_CONFIG, loadConfig, writeJson } from '../src/config.js';
import { commitSnapshot, pushSnapshots } from '../src/git.js';
import { createReviewWorkspace } from '../src/review-workspace.js';
import { VIEW_LIMITS, loadChangeView } from '../src/change-view.js';
import { localize } from '../src/i18n.js';
import { KO } from '../src/i18n-ko.js';

const exec = promisify(execFile);
const zero = '0'.repeat(40);

async function fixture(t, overrides = {}) {
  const temporary = await mkdtemp(join(tmpdir(), 'sphinx-change-view-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const cwd = join(temporary, 'repo'), home = join(temporary, 'home');
  await mkdir(cwd); await mkdir(home);
  const env = { ...process.env, SPHINX_HOME: home, SPHINX_USER_HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = async (...args) => (await exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, maxBuffer: 16 * 1024 * 1024 })).stdout.trimEnd();
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Sphinx fixture');
  await git('config', 'user.email', 'fixture@example.invalid');
  await writeJson(join(home, 'config.json'), { ...structuredClone(DEFAULT_CONFIG), events: ['pre-push', 'pre-commit'], ...overrides });
  const config = await loadConfig(cwd, env);
  const put = async files => {
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(join(cwd, path, '..'), { recursive: true });
      await writeFile(join(cwd, path), contents);
    }
  };
  const commit = async files => { await put(files); await git('add', '--all'); await git('commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  const snapshot = async (base = zero) => {
    const head = await git('rev-parse', 'HEAD');
    return (await pushSnapshots({ cwd, config, env, remote: 'origin', remoteUrl: 'https://example.invalid/repo', input: `refs/heads/main ${head} refs/heads/main ${base}\n` }))[0];
  };
  return { cwd, env, config, git, put, commit, snapshot };
}

const lines = (count, label = 'line') => Array.from({ length: count }, (_, i) => `${label} ${i + 1}`).join('\n') + '\n';

async function mixedChange(t) {
  const f = await fixture(t);
  const base = await f.commit({
    'src/app.js': lines(40, 'app'),
    'src/old-name.js': lines(30, 'moved'),
    'removed.txt': 'gone 1\ngone 2\n',
    'assets/logo.bin': Buffer.from([0, 1, 2, 3]),
    'scripts/run.sh': 'echo run\n',
    'src/dependency.js': lines(12, 'dependency'),
  });
  await rm(join(f.cwd, 'removed.txt'));
  await f.git('mv', 'src/old-name.js', 'src/new-name.js');
  const app = lines(40, 'app').replace('app 20\n', 'app 20 changed\nbrand new line\n');
  const moved = lines(30, 'moved').replace('moved 15\n', 'moved 15 edited\n');
  await f.put({ 'src/app.js': app, 'src/new-name.js': moved, 'docs/a very long/path/that keeps/going/notes.md': 'hello\n', 'empty.txt': '', 'assets/logo.bin': Buffer.from([0, 9, 9, 9, 9]), '.env': 'SECRET=1\n' });
  await chmod(join(f.cwd, 'scripts/run.sh'), 0o755);
  await f.git('add', '--all'); await f.git('commit', '-m', 'change');
  return { ...f, base, snapshot: await f.snapshot(base) };
}

test('the change view reports exact per-file status and totals from the frozen comparison', async t => {
  const f = await mixedChange(t);
  const view = await loadChangeView(f.snapshot, f.config, { env: f.env });
  const summary = view.summary();
  const byPath = Object.fromEntries(summary.files.map(file => [file.path, file]));
  assert.deepEqual(summary.files.map(file => [file.path, file.status]), [
    ['assets/logo.bin', 'modified'], ['docs/a very long/path/that keeps/going/notes.md', 'added'], ['empty.txt', 'added'],
    ['removed.txt', 'deleted'], ['scripts/run.sh', 'modified'], ['src/app.js', 'modified'], ['src/new-name.js', 'renamed'],
  ]);
  assert.equal(byPath['src/new-name.js'].oldPath, 'src/old-name.js');
  assert.deepEqual([byPath['src/new-name.js'].additions, byPath['src/new-name.js'].deletions], [1, 1]);
  assert.deepEqual([byPath['src/app.js'].additions, byPath['src/app.js'].deletions], [2, 1]);
  assert.deepEqual([byPath['removed.txt'].additions, byPath['removed.txt'].deletions], [0, 2]);
  assert.equal(byPath['assets/logo.bin'].binary, true);
  assert.equal(byPath['assets/logo.bin'].additions, null, 'Binary files never receive manufactured line counts');
  assert.deepEqual([byPath['empty.txt'].additions, byPath['empty.txt'].deletions], [0, 0]);
  assert.deepEqual(byPath['scripts/run.sh'].modeChange, { from: '100644', to: '100755' });
  assert.equal(summary.files.some(file => file.path === '.env'), false, 'Excluded paths are never listed');
  assert.equal(summary.header.excludedFiles, 1);
  assert.equal(summary.header.base, f.base);
  assert.equal(summary.header.destination, 'refs/heads/main');

  // Totals equal Git's own rename-aware numstat for the inspectable files.
  const numstat = (await f.git('diff', '--numstat', '-M', f.base, f.snapshot.head, '--', '.', ':(exclude).env')).split('\n');
  const expected = numstat.reduce((sum, row) => { const [a, d] = row.split('\t'); return a === '-' ? sum : { additions: sum.additions + Number(a), deletions: sum.deletions + Number(d) }; }, { additions: 0, deletions: 0 });
  assert.deepEqual(summary.totals, { files: 7, ...expected, binaryFiles: 1, uncountedFiles: 0 });
});

test('later commits and working-tree edits cannot change the reviewed range', async t => {
  const f = await mixedChange(t);
  const before = await loadChangeView(f.snapshot, f.config, { env: f.env });
  const first = { summary: before.summary(), diff: await before.diff('src/app.js') };
  await f.put({ 'src/app.js': 'rewritten in the working tree\n', 'untracked.js': 'new\n' });
  await f.git('add', 'untracked.js'); await f.git('commit', '-m', 'later');
  await f.put({ 'src/app.js': 'edited again, unstaged\n' });
  const after = await loadChangeView(f.snapshot, f.config, { env: f.env });
  assert.deepEqual(after.summary(), first.summary);
  assert.deepEqual(await after.diff('src/app.js'), first.diff);
});

test('file diffs show line numbers, meaningful special states, and expandable context', async t => {
  const f = await mixedChange(t);
  const view = await loadChangeView(f.snapshot, f.config, { env: f.env });
  const app = await view.diff('src/app.js');
  assert.equal(app.hunks.length, 1);
  const rows = app.hunks[0].rows;
  assert.deepEqual(rows.find(row => row.type === 'deletion'), { type: 'deletion', old: 20, new: null, text: 'app 20' });
  assert.deepEqual(rows.filter(row => row.type === 'addition').map(row => [row.new, row.text]), [[20, 'app 20 changed'], [21, 'brand new line']]);
  assert.equal(rows.filter(row => row.type === 'context').length, 6);
  const full = await view.diff('src/app.js', { context: 'all' });
  assert.equal(full.hunks.length, 1);
  assert.equal(full.hunks[0].rows.filter(row => row.type !== 'deletion').length, 41, 'Full context shows the entire new file');
  assert.equal((await view.diff('src/app.js', { context: '25' })).context, '25');
  assert.equal((await view.diff('src/app.js', { context: 'everything' })).context, '3', 'Unknown context levels fall back to the default');

  const renamed = await view.diff('src/new-name.js');
  assert.equal(renamed.oldPath, 'src/old-name.js');
  assert.deepEqual(renamed.hunks[0].rows.filter(row => row.type !== 'context').map(row => [row.type, row.old, row.new]), [['deletion', 15, null], ['addition', null, 15]]);
  const deleted = await view.diff('removed.txt');
  assert.deepEqual(deleted.hunks[0].rows.map(row => [row.type, row.old, row.text]), [['deletion', 1, 'gone 1'], ['deletion', 2, 'gone 2']]);
  const added = await view.diff('docs/a very long/path/that keeps/going/notes.md');
  assert.deepEqual(added.hunks[0].rows, [{ type: 'addition', old: null, new: 1, text: 'hello' }]);
  assert.equal((await view.diff('assets/logo.bin')).note, 'binary');
  assert.deepEqual((await view.diff('assets/logo.bin')).hunks, []);
  assert.equal((await view.diff('empty.txt')).note, 'empty');
  assert.equal((await view.diff('scripts/run.sh')).note, 'mode-only');
  await assert.rejects(view.diff('.env'), /not part of this checkpoint/);
  await assert.rejects(view.diff('src/dependency.js'), /not part of this checkpoint/);
});

test('ChangeViewError keeps its English message and carries a ref', async () => {
  for (const [snapshot, key, message] of [
    [{}, 'server.changeView.noInventory', 'This checkpoint has no recorded file inventory.'],
    [{ repoRoot: '/r', files: [], event: 'pre-push', head: 'not-an-object' }, 'server.changeView.headNotImmutable', 'The checkpoint head is not an immutable Git object.'],
  ]) {
    await assert.rejects(loadChangeView(snapshot, DEFAULT_CONFIG), error => {
      assert.equal(error.code, 'CHANGE_VIEW_UNAVAILABLE');
      assert.equal(error.message, message);
      assert.deepEqual(error.ref, { $t: key });
      assert.equal(localize(error.ref, 'en'), message);
      assert.equal(localize(error.ref, 'ko'), KO[key]);
      return true;
    });
  }
});

test('large diffs are truncated with honest counts instead of silently shortened', async t => {
  const f = await fixture(t);
  const base = await f.commit({ 'big.txt': 'start\n' });
  await f.commit({ 'big.txt': lines(VIEW_LIMITS.rows + 500, 'big') });
  const view = await loadChangeView(await f.snapshot(base), f.config, { env: f.env });
  const big = await view.diff('big.txt');
  assert.deepEqual(big.truncated, { shownRows: VIEW_LIMITS.rows, totalRows: VIEW_LIMITS.rows + 501 });
  assert.equal(big.hunks.reduce((sum, hunk) => sum + hunk.rows.length, 0), VIEW_LIMITS.rows);
  assert.equal(view.totals.additions, VIEW_LIMITS.rows + 500, 'Totals still describe the whole comparison');
});

test('commit checkpoints use the pinned index and refuse a different staged change', async t => {
  const f = await fixture(t);
  await f.commit({ 'a.js': 'one\n' });
  await f.put({ 'a.js': 'two\n', 'b.js': 'new\n' });
  await f.git('add', '--all');
  const snapshot = await commitSnapshot({ cwd: f.cwd, config: f.config, env: f.env });
  const view = await loadChangeView(snapshot, f.config, { env: f.env });
  assert.equal(view.header.staged, true);
  assert.deepEqual(view.summary().files.map(file => [file.path, file.status, file.additions, file.deletions]), [['a.js', 'modified', 1, 1], ['b.js', 'added', 1, 0]]);
  assert.deepEqual((await view.diff('a.js')).hunks[0].rows.map(row => row.text), ['one', 'two']);
  await f.put({ 'a.js': 'three\n' }); await f.git('add', 'a.js');
  await assert.rejects(loadChangeView(snapshot, f.config, { env: f.env }), /no longer matches/);
});

test('question evidence becomes line ranges only from verified reviewer observations', async t => {
  const f = await mixedChange(t);
  const workspace = await createReviewWorkspace(f.snapshot, f.config, { env: f.env });
  const record = async (tool, args) => { const result = await workspace.execute(tool, args); assert.equal(result.error, undefined, JSON.stringify(result)); return { id: `read-${tool}`, tool, args, result, paths: result.evidencePaths }; };
  const appDiff = await record('read_diff', { path: 'src/app.js' });
  const appPage = await record('read_diff', { path: 'src/app.js', offset: appDiff.result.text.indexOf('@@'), limit: 4 });
  const dependency = await record('read_file', { path: 'src/dependency.js', startLine: 3, limit: 4 });
  const search = await record('search', { query: 'moved 15 edited' });
  const removed = await record('read_diff', { path: 'src/old-name.js' });
  const review = { snapshotId: f.snapshot.id, evidence: [appDiff, appPage, dependency, search, removed] };
  const view = await loadChangeView(f.snapshot, f.config, { env: f.env });
  const question = { evidence: [{ path: 'src/app.js', reason: 'PRIVATE' }, { path: 'src/dependency.js', reason: 'x' }, { path: 'src/new-name.js', reason: 'x' }, { path: 'src/old-name.js', reason: 'x' }, { path: 'empty.txt', reason: 'x' }] };
  const refs = Object.fromEntries((await view.evidenceFor(question, review)).map(ref => [ref.path, ref]));
  assert.deepEqual(refs['src/app.js'], { path: 'src/app.js', inChange: true, viewPath: 'src/app.js', ranges: [{ side: 'new', start: 17, end: 24 }, { side: 'old', start: 20, end: 20 }] });
  assert.deepEqual(refs['src/dependency.js'], { path: 'src/dependency.js', inChange: false, ranges: [{ side: 'new', start: 3, end: 6 }] });
  assert.deepEqual(refs['src/new-name.js'].ranges, [{ side: 'new', start: 15, end: 15 }]);
  assert.equal(refs['src/old-name.js'].viewPath, 'src/new-name.js', 'A rename source opens the renamed file');
  assert.deepEqual(refs['src/old-name.js'].ranges, [{ side: 'old', start: 1, end: 30 }]);
  assert.deepEqual(refs['empty.txt'].ranges, [], 'A cited file without an observation has no fabricated location');
  assert.doesNotMatch(JSON.stringify(refs), /PRIVATE/, 'Model-written reasons are not displayed');

  // Tampered or foreign observations are ignored rather than trusted.
  const forged = structuredClone(review);
  forged.evidence[0].result.text = forged.evidence[0].result.text.replace('brand new line', 'brand new LINE');
  forged.evidence[1].result.offset += 1;
  forged.evidence[2].result.oid = '0'.repeat(40);
  const forgedRefs = Object.fromEntries((await view.evidenceFor({ evidence: [{ path: 'src/app.js' }, { path: 'src/dependency.js' }, { path: '.env' }] }, forged)).map(ref => [ref.path, ref]));
  assert.deepEqual(forgedRefs['src/app.js'].ranges, []);
  assert.deepEqual(forgedRefs['src/dependency.js'].ranges, []);
  assert.equal(forgedRefs['.env'], undefined, 'Excluded citations never surface');
  assert.deepEqual(await view.evidenceFor(question, { ...review, snapshotId: 'b'.repeat(64) }).then(items => items.flatMap(item => item.ranges)), []);
  assert.deepEqual(await view.evidenceFor(question, undefined).then(items => items.map(item => item.ranges.length)), [0, 0, 0, 0, 0]);
});
