import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CWD_SEARCH_MARKER, blockCwdExeSearch, envValue, msvcrtQuote, msys2Quote, withoutAddedCwdBlock } from '../src/windows.js';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../bin/sphinx.js', import.meta.url));

test('envValue matches Windows variable names ignoring case and POSIX names exactly', () => {
  assert.equal(envValue({ SYSTEMROOT: 'D:\\Win' }, 'SystemRoot', 'win32'), 'D:\\Win');
  assert.equal(envValue({ SYSTEMROOT: 'D:\\Win' }, 'SystemRoot', 'linux'), undefined);
  assert.equal(envValue({ Path: 'a' }, 'PATH', 'win32'), 'a');
});

test('msvcrtQuote always wraps in double quotes and escapes quotes and the backslashes before a quote or the end', () => {
  assert.equal(msvcrtQuote(String.raw`C:\Users\O'Neil\h`), String.raw`"C:\Users\O'Neil\h"`);
  assert.equal(msvcrtQuote('a"b'), String.raw`"a\"b"`);
  assert.equal(msvcrtQuote(String.raw`a\"b`), String.raw`"a\\\"b"`);
  assert.equal(msvcrtQuote('C:\\dir\\'), String.raw`"C:\dir\\"`);
  assert.equal(msvcrtQuote('exec "$0" "$@"'), String.raw`"exec \"$0\" \"$@\""`);
  assert.equal(msvcrtQuote(''), '""');
});

test('msys2Quote always wraps in double quotes and escapes every backslash and quote', () => {
  assert.equal(msys2Quote(String.raw`C:\Users\O'Neil\h`), String.raw`"C:\\Users\\O'Neil\\h"`);
  assert.equal(msys2Quote(String.raw`\\server\share`), String.raw`"\\\\server\\share"`);
  assert.equal(msys2Quote('a"b'), String.raw`"a\"b"`);
  assert.equal(msys2Quote(String.raw`a\"b`), String.raw`"a\\\"b"`);
  assert.equal(msys2Quote('C:\\dir\\'), String.raw`"C:\\dir\\"`);
  assert.equal(msys2Quote('exec "$0" "$@"'), String.raw`"exec \"$0\" \"$@\""`);
  assert.equal(msys2Quote(''), '""');
});

test('blockCwdExeSearch sets the switch and its marker once on Windows and changes nothing else', () => {
  assert.equal(CWD_SEARCH_MARKER, 'SPHINX_ADDED_NO_CWD_SEARCH');
  const env = {};
  assert.equal(blockCwdExeSearch(env, 'win32'), true);
  assert.deepEqual(env, { NoDefaultCurrentDirectoryInExePath: '1', SPHINX_ADDED_NO_CWD_SEARCH: '1' });
  assert.equal(blockCwdExeSearch(env, 'win32'), false);

  // Windows treats the mere existence of the variable as the switch, whatever its case or value.
  for (const own of [{ nodefaultcurrentdirectoryinexepath: '1' }, { NoDefaultCurrentDirectoryInExePath: '' }]) {
    const before = { ...own };
    assert.equal(blockCwdExeSearch(own, 'win32'), false);
    assert.deepEqual(own, before);
  }

  // A dotless-i lookalike is a different variable to Windows, so the real switch is still missing.
  const lookalike = `NoDefaultCurrentD${String.fromCodePoint(0x131)}rectoryInExePath`;
  assert.equal(blockCwdExeSearch({ [lookalike]: '1' }, 'win32'), true);

  const posix = {};
  assert.equal(blockCwdExeSearch(posix, 'linux'), false);
  assert.deepEqual(posix, {});
});

test('withoutAddedCwdBlock removes the switch only when Sphinx added it, and never edits its input', () => {
  const added = { PATH: 'p', NODEFAULTCURRENTDIRECTORYINEXEPATH: '1', SPHINX_ADDED_NO_CWD_SEARCH: '1' };
  assert.deepEqual(withoutAddedCwdBlock(added), { PATH: 'p' });
  assert.deepEqual(added, { PATH: 'p', NODEFAULTCURRENTDIRECTORYINEXEPATH: '1', SPHINX_ADDED_NO_CWD_SEARCH: '1' });

  const users = { PATH: 'p', NoDefaultCurrentDirectoryInExePath: '1' };
  const kept = withoutAddedCwdBlock(users);
  assert.deepEqual(kept, users);
  assert.notEqual(kept, users);
});

test('a repository-root git.exe never runs when Sphinx calls Git', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'sphinx-windows-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  await mkdir(repo);
  // A Git client starts Sphinx without this variable, but the Claude Code shell presets it and would hide the hijack.
  const env = { ...process.env, SPHINX_HOME: join(root, 'home'), SPHINX_USER_HOME: join(root, 'user'), GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of Object.keys(env)) if (/^NoDefaultCurrentDirectoryInExePath$/i.test(key)) delete env[key];
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Sphinx test'], ['config', 'user.email', 'sphinx@example.invalid'], ['commit', '--allow-empty', '-m', 'initial']]) {
    await exec('git', args, { cwd: repo, env });
  }
  // Plant the decoy only after the setup above, which also runs git by name from this directory.
  await copyFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), join(repo, 'git.exe'));

  // Control: without the variable a plain Node process runs the planted file, so the trap is real.
  const probe = "const r = require('node:child_process').spawnSync('git', ['--version'], { encoding: 'utf8' }); process.stdout.write(JSON.stringify({ error: r.error?.code ?? null, stdout: r.stdout }))";
  const control = spawnSync(process.execPath, ['-e', probe], { cwd: repo, env, encoding: 'utf8', input: '', timeout: 20000 });
  const hijacked = JSON.parse(control.stdout);
  assert.equal(hijacked.error, null, 'the planted git.exe should have started');
  assert.doesNotMatch(hijacked.stdout, /^git version/);

  // The Sphinx entry point must find the real Git although the repository holds a git.exe.
  const run = spawnSync(process.execPath, [CLI, 'status', '--json'], { cwd: repo, env, encoding: 'utf8', input: '', timeout: 20000 });
  assert.equal(run.status, 0, `${run.stderr}\n${run.error ?? ''}`);
  assert.equal(JSON.parse(run.stdout).repo, await realpath(repo));
});

test("Git's sh runs a hook and gets its arguments unchanged when they are quoted with msys2Quote", { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  // sh is an MSYS2 program, which also collapses a run of backslashes inside quotes. Quoted with msvcrtQuote, a hook path
  // or remote URL starting with two backslashes lost one, so the `exec "$0" "$@"` chain failed with exit 127 or got a wrong URL.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sphinx-windows-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hook = join(root, 'pre-push');
  await writeFile(hook, "#!/bin/sh\nfor a; do printf '%s\\0' \"$a\"; done\nexit 7\n");
  const gitRoot = resolve((await exec('git', ['--exec-path'], { cwd: root })).stdout.trim(), '..', '..', '..');
  const args = [
    'origin',
    '\\\\localhost\\share\\repo.git', // a UNC remote URL; a host that does not resolve would stall MSYS2 for seconds
    'C:\\a\\\\b\\\\\\c', '\\\\?\\D:\\long\\path', 'C:\\dir\\', 'a"b', 'a\\"b', 'a\\\\"b',
    "D:\\x\\{a,b}\\it's.git", 'C:\\사용자\\한글 경로\\', '', '*', '$HOME', '~', '%PATH%',
  ];
  // The extended-length prefix starts with two backslashes like a UNC path, and works without a network share.
  const original = `\\\\?\\${hook}`;
  const run = spawnSync(join(gitRoot, 'usr', 'bin', 'sh.exe'), ['-c', 'exec "$0" "$@"', original, ...args].map(msys2Quote), {
    windowsVerbatimArguments: true, argv0: 'sh', cwd: root, encoding: 'utf8', input: '', timeout: 30000,
  });
  assert.equal(run.status, 7, `${run.stderr}\n${run.error ?? ''}`);
  assert.deepEqual(run.stdout.split('\0').slice(0, -1), args);
});
