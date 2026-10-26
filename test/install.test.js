import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod, symlink, lstat } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { install, uninstall, doctor, dispatchHook, detectAgents, checkAgentPlatform, WINDOWS_AGENT_HINT } from '../src/install.js';
import { getPaths } from '../src/config.js';
import { lifecycleHome } from '../src/lifecycle-integrations.js';
import { RUN_HOOK, msys2Quote } from '../src/windows.js';

async function fixture(t, { prefix = "sphinx install ' " } = {}) {
  const base = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  const repo = path.join(base, 'repository');
  await mkdir(home); await mkdir(repo);
  const env = { ...process.env, HOME: home, SPHINX_USER_HOME: home, SPHINX_HOME: path.join(home, '.sphinx'), GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_CONFIG', 'GIT_CONFIG_COUNT', 'SPHINX_INSTALL_ID', 'SPHINX_EVALUATOR', 'SPHINX_HOOK_DEPTH']) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  git('init', '-q');
  const cliPath = path.join(base, "sphinx cli ' entry.mjs");
  const modulePath = fileURLToPath(new URL('../src/install.js', import.meta.url));
  await writeFile(cliPath, `import { dispatchHook } from ${JSON.stringify(modulePath)};\nlet input = ''; for await (const chunk of process.stdin) input += chunk;\nprocess.exitCode = await dispatchHook({ event: process.argv[4], args: process.argv.slice(5), input, gate: async () => Number(process.env.SPHINX_TEST_GATE || 0) });\n`);
  const options = { cwd: repo, env, cliPath, agents: 'none' };
  const paths = getPaths(env);
  return { base, home, repo, env, git, cliPath, options, paths };
}

async function executable(file, content) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content, { mode: 0o755 }); await chmod(file, 0o755); }
const json = async file => JSON.parse(await readFile(file, 'utf8'));

// Git for Windows runs a hook with its own usr\bin first on PATH, and that is where the hook's `sh` comes from.
// A test that calls dispatchHook itself on Windows has to put it there too. `git --exec-path` is <root>\mingw64\libexec\git-core.
const gitShellPath = () => path.resolve(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), '..', '..', '..', 'usr', 'bin');
function prependPath(env, ...directories) {
  const key = 'PATH' in env ? 'PATH' : Object.keys(env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH'; // a copied env may spell it `Path`
  return { ...env, [key]: [...directories, env[key]].filter(Boolean).join(path.delimiter) };
}
const withGitShell = env => process.platform === 'win32' ? prependPath(env, gitShellPath()) : env;

test('Cursor, OpenCode and Pi install together, preserve user settings, and uninstall idempotently', async t => {
  const f = await fixture(t);
  const cursorHome = lifecycleHome('cursor', f.paths, f.env), openCodeHome = lifecycleHome('opencode', f.paths, f.env);
  await mkdir(cursorHome, { recursive: true }); await mkdir(openCodeHome, { recursive: true });
  const cursorFile = path.join(cursorHome, 'hooks.json'), openCodeConfig = path.join(openCodeHome, 'opencode.jsonc');
  const existing = { version: 1, hooks: { sessionStart: [{ command: 'my-existing-hook' }], postToolUse: [] }, custom: true };
  await writeFile(cursorFile, JSON.stringify(existing));
  const jsonc = '// Keep comments\n{"model":"my/model", "plugin":["my-plugin"]}\n';
  await writeFile(openCodeConfig, jsonc);
  const result = await install({ ...f.options, agents: 'cursor,opencode,pi', platform: 'linux' });
  assert.deepEqual(result.agents, ['cursor', 'opencode', 'pi']);
  assert.deepEqual(result.warnings, []);
  assert.match(result.messages.join('\n'), /Pi extension installed with native/);
  await install({ ...f.options, agents: 'cursor,opencode,pi', platform: 'linux' });
  const cursor = await json(cursorFile);
  assert.equal(cursor.hooks.sessionStart.length, 2);
  assert.equal(cursor.hooks.postToolUse.length, 1);
  assert.equal(cursor.hooks.postToolUseFailure[0].matcher, '^Shell$');
  assert.equal(await readFile(openCodeConfig, 'utf8'), jsonc);
  assert.equal((await doctor({ ...f.options, platform: 'linux' })).checks.every(check => check.ok), true);
  const manifest = await json(f.paths.install);
  assert.match(await readFile(manifest.agents.opencode.file, 'utf8'), /registerOpenCodeIntegration/);
  assert.match(await readFile(manifest.agents.pi.file, 'utf8'), /registerPiIntegration/);
  await uninstall(f.options); await uninstall(f.options);
  assert.deepEqual(await json(cursorFile), existing);
  assert.equal(await readFile(openCodeConfig, 'utf8'), jsonc);
  await assert.rejects(readFile(manifest.agents.opencode.file), { code: 'ENOENT' });
  await assert.rejects(readFile(manifest.agents.pi.file), { code: 'ENOENT' });
});

test('new Cursor settings disappear on uninstall and auto detection finds all supported agent homes', async t => {
  const f = await fixture(t);
  for (const directory of [f.paths.codexHome, f.paths.claudeHome, lifecycleHome('cursor', f.paths, f.env), lifecycleHome('opencode', f.paths, f.env), path.join(f.home, '.pi', 'agent')]) await mkdir(directory, { recursive: true });
  assert.deepEqual(await detectAgents({ ...f.options, platform: 'linux' }), ['codex', 'claude', 'pi', 'cursor', 'opencode']);
  await assert.rejects(readFile(f.paths.install), { code: 'ENOENT' });
  assert.throws(() => f.git('config', '--global', '--get', 'core.hooksPath'));
  await install({ ...f.options, agents: 'auto', platform: 'linux' });
  const manifest = await json(f.paths.install);
  assert.deepEqual(Object.keys(manifest.agents).sort(), ['claude', 'codex', 'cursor', 'opencode', 'pi']);
  await uninstall(f.options);
  await assert.rejects(readFile(path.join(f.home, '.cursor', 'hooks.json')), { code: 'ENOENT' });
});

test('edited Cursor hooks and OpenCode plugins are preserved and diagnosed', async t => {
  const f = await fixture(t);
  await install({ ...f.options, agents: 'cursor,opencode' });
  const manifest = await json(f.paths.install), cursorFile = manifest.agents.cursor.file, pluginFile = manifest.agents.opencode.file;
  const document = await json(cursorFile);
  document.hooks.postToolUse[0].timeout = 99;
  document.unrelated = 'keep';
  await writeFile(cursorFile, JSON.stringify(document));
  await writeFile(pluginFile, '// User replacement\n');
  await assert.rejects(install({ ...f.options, agents: 'cursor' }), /edited cursor/);
  await assert.rejects(install({ ...f.options, agents: 'opencode' }), /edited OpenCode/);
  const checks = (await doctor(f.options)).checks;
  assert.equal(checks.find(check => check.name === 'cursor integration').ok, false);
  assert.equal(checks.find(check => check.name === 'opencode integration').ok, false);
  const result = await uninstall(f.options);
  assert.ok(result.warnings.some(warning => warning.includes('Cursor')));
  assert.ok(result.warnings.some(warning => warning.includes('OpenCode')));
  assert.equal((await json(cursorFile)).hooks.postToolUse[0].timeout, 99);
  assert.equal((await json(cursorFile)).unrelated, 'keep');
  assert.equal(await readFile(pluginFile, 'utf8'), '// User replacement\n');
});

test('invalid Cursor settings or conflicting OpenCode plugin fail before any Git or agent changes', async t => {
  const f = await fixture(t);
  const cursorHome = lifecycleHome('cursor', f.paths, f.env), pluginDirectory = path.join(lifecycleHome('opencode', f.paths, f.env), 'plugins');
  await mkdir(cursorHome, { recursive: true }); await mkdir(pluginDirectory, { recursive: true });
  const cursorFile = path.join(cursorHome, 'hooks.json');
  await writeFile(cursorFile, 'secret-sentinel-invalid-json');
  await assert.rejects(install({ ...f.options, agents: 'pi,cursor' }), error => /invalid JSON/.test(error.message) && !error.message.includes('secret-sentinel'));
  assert.throws(() => f.git('config', '--global', '--get', 'core.hooksPath'));
  await assert.rejects(readFile(path.join(f.home, '.pi', 'agent', 'extensions', 'sphinx.js')), { code: 'ENOENT' });
  await rm(cursorFile); await writeFile(path.join(pluginDirectory, 'sphinx.js'), '// unrelated plugin');
  await assert.rejects(install({ ...f.options, agents: 'cursor,opencode' }), /existing or edited OpenCode/);
  await assert.rejects(readFile(cursorFile), { code: 'ENOENT' });
  assert.throws(() => f.git('config', '--global', '--get', 'core.hooksPath'));
});

test('Cursor and OpenCode refuse symlinked integration paths and isolated homes ignore ambient paths', async t => {
  const f = await fixture(t);
  const outside = path.join(f.base, 'outside'); await mkdir(outside);
  const cursorHome = lifecycleHome('cursor', f.paths, f.env);
  await symlink(outside, cursorHome);
  await assert.rejects(install({ ...f.options, agents: 'cursor' }), /symlinked/);
  await rm(cursorHome);
  const openCodeHome = lifecycleHome('opencode', f.paths, f.env);
  await mkdir(openCodeHome, { recursive: true }); await symlink(outside, path.join(openCodeHome, 'plugins'));
  await assert.rejects(install({ ...f.options, agents: 'opencode' }), /symlinked/);
  assert.equal(lifecycleHome('opencode', f.paths, { ...f.env, XDG_CONFIG_HOME: outside, OPENCODE_CONFIG_DIR: outside }), openCodeHome);
});

test('global installation chains custom hooks, preserves agent settings, and reverses idempotently', async t => {
  const f = await fixture(t);
  const oldHooks = path.join(f.base, 'old hooks');
  const output = path.join(f.base, 'chained');
  await executable(path.join(oldHooks, 'post-checkout'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$SPHINX_TEST_OUTPUT"\nexit 7\n');
  await executable(path.join(oldHooks, 'future-custom-hook'), '#!/bin/sh\nexit 0\n');
  f.git('config', '--global', 'core.hooksPath', oldHooks);
  const codexFile = path.join(f.paths.codexHome, 'hooks.json');
  const claudeFile = path.join(f.paths.claudeHome, 'settings.json');
  await mkdir(f.paths.codexHome, { recursive: true }); await mkdir(f.paths.claudeHome, { recursive: true });
  const existing = { description: 'Keep me', hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'other-hook' }] }], Stop: [] }, unrelated: { enabled: true } };
  await writeFile(codexFile, JSON.stringify(existing));
  await writeFile(claudeFile, JSON.stringify({ model: 'user-model', permissions: { deny: ['Bash(rm *)'] } }));
  const result = await install({ ...f.options, agents: 'codex,claude' });
  assert.deepEqual(result.agents, ['codex', 'claude']);
  assert.deepEqual(result.warnings, []);
  await install({ ...f.options, agents: 'codex,claude' });
  assert.equal((await json(codexFile)).hooks.SessionStart.length, 2);
  assert.equal((await json(claudeFile)).model, 'user-model');
  const hookDir = f.git('config', '--global', '--get', 'core.hooksPath');
  await readFile(path.join(hookDir, 'future-custom-hook'));
  await assert.rejects(async () => execFileSync(path.join(hookDir, 'post-checkout'), ['a b', "c'd"], { cwd: f.repo, env: { ...f.env, SPHINX_TEST_OUTPUT: output } }), error => error.status === 7);
  assert.equal(await readFile(output, 'utf8'), "a b\nc'd\n");
  await uninstall(f.options);
  assert.equal(f.git('config', '--global', '--get', 'core.hooksPath'), oldHooks);
  assert.deepEqual(await json(codexFile), existing);
  assert.equal((await json(claudeFile)).model, 'user-model');
  await uninstall(f.options);
  assert.equal(f.git('config', '--global', '--get', 'core.hooksPath'), oldHooks);
});

test('gated hooks preserve stdin and arguments and do not bypass an original rejection', async t => {
  const f = await fixture(t);
  const output = path.join(f.base, 'stdin');
  await executable(path.join(f.repo, '.git/hooks/pre-push'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$SPHINX_TEST_OUTPUT"\ncat >> "$SPHINX_TEST_OUTPUT"\nexit 19\n');
  await install(f.options);
  let calls = 0;
  assert.equal(await dispatchHook({ event: 'pre-push', args: ['origin', 'url with spaces'], input: 'refs/heads/main 123 refs/heads/main 456\n', cwd: f.repo, env: withGitShell({ ...f.env, SPHINX_TEST_OUTPUT: output }), gate: async () => { calls++; return 0; } }), 19);
  assert.equal(calls, 0);
  assert.equal(await readFile(output, 'utf8'), 'origin\nurl with spaces\nrefs/heads/main 123 refs/heads/main 456\n');
  await rm(path.join(f.repo, '.git/hooks/pre-push'));
  assert.equal(await dispatchHook({ event: 'pre-push', args: [], input: '', cwd: f.repo, env: f.env, gate: async () => 23 }), 23);
  assert.equal(await dispatchHook({ event: 'pre-commit', args: [], input: '', cwd: f.repo, env: { ...f.env, SPHINX_EVALUATOR: '1' }, gate: async () => 23 }), 0);
});

test('on Windows the original hook runs through sh with every argument quoted', async t => {
  const f = await fixture(t);
  await install(f.options);
  const hook = path.join(f.git('rev-parse', '--path-format=absolute', '--git-common-dir'), 'hooks', 'pre-push');
  await executable(hook, '#!/bin/sh\nexit 0\n');
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdin = { on() {}, end() {} };
    setImmediate(() => child.emit('close', 0, null));
    return child;
  };
  const args = ['origin', "D:\\x\\{a,b}\\it's.git"];
  const run = (platform, env) => dispatchHook({ event: 'pre-push', args, input: 'refs/heads/main 123 refs/heads/main 456\n', cwd: f.repo, env, gate: async () => 0, spawnImpl, platform });

  // The switch and its marker are Sphinx's own, so the user's hook gets the environment Git alone would give it.
  const added = { ...f.env, NoDefaultCurrentDirectoryInExePath: '1', SPHINX_ADDED_NO_CWD_SEARCH: '1' };
  assert.equal(await run('win32', added), 0);
  const [win] = calls;
  assert.equal(win.command, 'sh');
  assert.deepEqual(win.args, ['-c', `${RUN_HOOK}\nrun_hook "$0" "$@"`, hook, ...args].map(msys2Quote));
  assert.equal(win.options.windowsVerbatimArguments, true);
  assert.equal(win.options.cwd, f.repo);
  assert.deepEqual(win.options.stdio, ['pipe', 'inherit', 'inherit']);
  assert.equal(win.options.env.SPHINX_HOOK_DEPTH, '1');
  assert.equal('NoDefaultCurrentDirectoryInExePath' in win.options.env, false);
  assert.equal('SPHINX_ADDED_NO_CWD_SEARCH' in win.options.env, false);
  assert.equal(added.NoDefaultCurrentDirectoryInExePath, '1', 'dispatchHook leaves the environment it was given alone');

  // A switch the user set without Sphinx is theirs to keep.
  const owned = { ...f.env, NoDefaultCurrentDirectoryInExePath: '1' };
  delete owned.SPHINX_ADDED_NO_CWD_SEARCH;
  assert.equal(await run('win32', owned), 0);
  assert.equal(calls[1].options.env.NoDefaultCurrentDirectoryInExePath, '1');

  // Anywhere else the hook file is started directly, exactly as before.
  assert.equal(await run('linux', added), 0);
  const posix = calls[2];
  assert.equal(posix.command, hook);
  assert.deepEqual(posix.args, args);
  assert.equal('windowsVerbatimArguments' in posix.options, false);
  assert.deepEqual(posix.options.env, { ...added, SPHINX_HOOK_DEPTH: '1' });
  assert.equal(calls.length, 3);
});

test('an existing pre-push hook in a path with Hangul, an apostrophe, braces and spaces still chains', async t => {
  const f = await fixture(t, { prefix: "sphinx 한글 O'Neil {a,b} " });
  const output = path.join(f.base, 'stdin');
  await executable(path.join(f.repo, '.git/hooks/pre-push'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$SPHINX_TEST_OUTPUT"\ncat >> "$SPHINX_TEST_OUTPUT"\nexit 19\n');
  await install(f.options);
  // A UNC remote URL starts with two backslashes, which MSYS2 would halve if they were not escaped. localhost resolves at once,
  // while MSYS2 spends seconds on every argument whose server name does not.
  const args = ['origin', "\\\\localhost\\share\\x{a,b}\\it's.git"];
  const input = 'refs/heads/main 123 refs/heads/main 456\n';
  let calls = 0;
  assert.equal(await dispatchHook({ event: 'pre-push', args, input, cwd: f.repo, env: withGitShell({ ...f.env, SPHINX_TEST_OUTPUT: output }), gate: async () => { calls++; return 0; } }), 19);
  assert.equal(calls, 0);
  assert.equal(await readFile(output, 'utf8'), `${args.join('\n')}\n${input}`);
});

test('a chained pre-push that exits without reading a large stdin still lets the gate run', async t => {
  const f = await fixture(t);
  await executable(path.join(f.repo, '.git/hooks/pre-push'), '#!/bin/sh\nexit 0\n');
  await install(f.options);
  // More than a pipe holds, so the write is still pending when the hook exits: EPIPE on POSIX, EOF on Windows.
  const input = 'refs/heads/b 1 refs/heads/b 2\n'.repeat(4000);
  assert.equal(await dispatchHook({ event: 'pre-push', args: ['origin', 'url'], input, cwd: f.repo, env: withGitShell(f.env), gate: async () => 23 }), 23);
});

test('the hook runner starts a hook by the interpreter name in its shebang and drops the options, as Git for Windows does', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "sphinx run hook ' "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'output');
  const args = ['origin', "D:\\x\\{a,b}\\it's.git", 'a b'];
  const report = 'printf "%s\\n" "$@" > "$SPHINX_TEST_OUTPUT"\n';
  const cases = [
    // None of these interpreter directories exists. Git for Windows only looks at the name and finds it on PATH.
    ['an interpreter path that exists nowhere', `#!/nowhere/bin/sh\n${report}`, 0],
    ['options, which Git drops', `#!/nowhere/bin/sh -e\nfalse\n${report}`, 0],
    ['a Windows path and a CRLF line end', `#!C:\\nowhere\\sh\r\n${report}`, 0],
    ['env', `#!/usr/bin/env sh\n${report}`, 0],
    ['node', "#!/nowhere/bin/node\nrequire('fs').writeFileSync(process.env.SPHINX_TEST_OUTPUT, process.argv.slice(2).join('\\n') + '\\n');\n", 0],
    ['the exit status', '#!/nowhere/bin/sh\nexit 7\n', 7],
    ['an interpreter that is not installed', '#!/nowhere/bin/no-such-interpreter\n', 127],
  ];
  const env = withGitShell(prependPath({ ...process.env, SPHINX_TEST_OUTPUT: output }, path.dirname(process.execPath)));
  // As dispatchHook starts it: the script is the -c argument and the hook is $0. On Windows every argument is quoted for MSYS2.
  const argv = hook => ['-c', `${RUN_HOOK}\nrun_hook "$0" "$@"`, hook, ...args];
  for (const [name, content, status] of cases) {
    const hook = path.join(dir, 'hook');
    await executable(hook, content);
    await rm(output, { force: true });
    const run = process.platform === 'win32'
      ? spawnSync('sh', argv(hook).map(msys2Quote), { env, cwd: dir, encoding: 'utf8', windowsVerbatimArguments: true })
      : spawnSync('sh', argv(hook), { env, cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, status, `${name}: ${run.stderr}${run.error ?? ''}`);
    const received = await readFile(output, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    assert.equal(received, status === 0 ? `${args.join('\n')}\n` : null, name);
  }
});

test('only native Windows hook scripts start an existing hook through the shebang runner, and every other script is unchanged', async t => {
  const win = await fixture(t), other = await fixture(t);
  await install({ ...win.options, platform: 'win32' });
  await install({ ...other.options, platform: 'linux' });
  const file = (f, event) => path.join(f.paths.home, 'hooks', 'global', event);
  const [protocol, prepared, gated] = await Promise.all(['proc-receive', 'post-commit', 'pre-push'].map(event => readFile(file(win, event), 'utf8')));
  assert.ok(protocol.includes(`\n${RUN_HOOK}\n`));
  assert.ok(protocol.endsWith('\nif [ -x "$hook" ]; then\n  run_hook "$hook" "$@"\nfi\nexit 0\n'));
  assert.ok(prepared.includes(`\n${RUN_HOOK}\n`));
  assert.ok(prepared.includes('\nif [ -x "$hook" ]; then\n  (run_hook "$hook" "$@")\n  status=$?\nfi\n'));
  assert.doesNotMatch(gated, /run_hook/, 'Gated events hand the original hook to Sphinx, which starts it itself');
  for (const event of ['proc-receive', 'post-commit']) execFileSync('sh', ['-n', file(win, event)], { env: withGitShell(win.env) }); // valid shell

  const [posixProtocol, posixPrepared] = await Promise.all(['proc-receive', 'post-commit'].map(event => readFile(file(other, event), 'utf8')));
  assert.ok(posixProtocol.endsWith('\nif [ -x "$hook" ]; then\n  exec "$hook" "$@"\nfi\nexit 0\n'));
  assert.ok(posixPrepared.includes('\nif [ -x "$hook" ]; then\n  "$hook" "$@"\n  status=$?\nfi\n'));
  for (const text of [posixProtocol, posixPrepared]) assert.doesNotMatch(text, /run_hook|cntrl/);
});

test('on Windows a prepared hook still streams stdin, returns the original status, and schedules preparation afterwards', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const f = await fixture(t);
  const scheduled = path.join(f.base, 'scheduled');
  // The shared fixture CLI imports install.js by a plain path, which Node on Windows rejects. This one only records its arguments.
  await writeFile(f.cliPath, "import { writeFile } from 'node:fs/promises';\nawait writeFile(process.env.SPHINX_TEST_SCHEDULED, JSON.stringify(process.argv.slice(2)));\n");
  await executable(path.join(f.repo, '.git/hooks/post-rewrite'), '#!/nowhere/bin/sh\nread first\nprintf "ack:%s\\n" "$first"\nread second\nprintf "done:%s:%s\\n" "$1" "$second"\nexit 13\n');
  await install(f.options);
  const script = path.join(f.git('config', '--global', '--get', 'core.hooksPath'), 'post-rewrite');
  // Started from outside the repository, so the background preparation never keeps a directory of the test in use.
  const child = spawn('sh', [script, 'amend'], { cwd: tmpdir(), env: withGitShell({ ...f.env, GIT_DIR: path.join(f.repo, '.git'), SPHINX_TEST_SCHEDULED: scheduled }), stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let output = '';
  const acknowledged = new Promise(resolve => child.stdout.on('data', chunk => { output += chunk; if (output.includes('ack:first\n')) resolve(); }));
  const closed = new Promise(resolve => child.on('close', resolve));
  child.stdin.write('first\n'); await acknowledged;
  child.stdin.end('second\n');
  assert.equal(await closed, 13);
  assert.equal(output, 'ack:first\ndone:amend:second\n');
  for (let i = 0; i < 100 && !await readFile(scheduled, 'utf8').catch(() => ''); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(await json(scheduled), ['prepare']);
});

test('with Sphinx installed, hooks whose shebang names an interpreter by absolute path still run, for gated and ungated events', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const f = await fixture(t);
  const out = path.join(f.base, 'out');
  await mkdir(out);
  const marker = name => `require('fs').writeFileSync(process.env.SPHINX_TEST_OUTPUT + '/${name}', 'ran');\n`;
  // The shared fixture imports install.js by a plain path, which Node on Windows only accepts as a file URL.
  await writeFile(f.cliPath, `import { dispatchHook } from ${JSON.stringify(new URL('../src/install.js', import.meta.url).href)};\nlet input = ''; for await (const chunk of process.stdin) input += chunk;\nprocess.exitCode = await dispatchHook({ event: process.argv[4], args: process.argv.slice(5), input, gate: async () => 0 });\n`);
  // Git alone runs all of these, although neither interpreter path exists in Git's own tree.
  await executable(path.join(f.repo, '.git/hooks/pre-commit'), `#!/usr/local/bin/node\n${marker('pre-commit')}`);
  await executable(path.join(f.repo, '.git/hooks/commit-msg'), '#!/nowhere/bin/sh -e\nfalse\nprintf ran > "$SPHINX_TEST_OUTPUT/commit-msg"\n');
  await executable(path.join(f.repo, '.git/hooks/post-commit'), `#!/usr/bin/node\n${marker('post-commit')}`);
  await install(f.options);
  // SPHINX_EVALUATOR keeps post-commit from scheduling background preparation, which would outlive the test.
  const env = prependPath({ ...f.env, SPHINX_TEST_OUTPUT: out, SPHINX_EVALUATOR: '1' }, path.dirname(process.execPath));
  const commit = () => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: f.repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  commit();
  for (const name of ['pre-commit', 'commit-msg', 'post-commit']) assert.equal(await readFile(path.join(out, name), 'utf8'), 'ran', name);
  // A failing hook still blocks the commit.
  await executable(path.join(f.repo, '.git/hooks/commit-msg'), '#!/usr/bin/node\nprocess.exit(5);\n');
  assert.throws(commit, error => error.status === 1);
});

test('an existing pre-push hook started through node by absolute path gets its arguments and stdin intact', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const f = await fixture(t, { prefix: "sphinx 한글 O'Neil {a,b} " });
  const output = path.join(f.base, 'received');
  const body = "let input = '';\nprocess.stdin.on('data', chunk => { input += chunk; });\nprocess.stdin.on('end', () => {\n  require('fs').writeFileSync(process.env.SPHINX_TEST_OUTPUT, JSON.stringify({ args: process.argv.slice(2), input }));\n  process.exit(19);\n});\n";
  await executable(path.join(f.repo, '.git/hooks/pre-push'), `#!/usr/local/bin/node\n${body}`);
  await install(f.options);
  const args = ['origin', "\\\\localhost\\share\\x{a,b}\\it's.git"];
  const input = 'refs/heads/main 123 refs/heads/main 456\n'.repeat(3);
  let calls = 0;
  const env = withGitShell(prependPath({ ...f.env, SPHINX_TEST_OUTPUT: output }, path.dirname(process.execPath)));
  assert.equal(await dispatchHook({ event: 'pre-push', args, input, cwd: f.repo, env, gate: async () => { calls++; return 0; } }), 19);
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { args, input });
});

test('fresh repositories initialize and clone after global installation while existing reference hooks still reject', async t => {
  const f = await fixture(t);
  await install(f.options);
  const run = (args, cwd = f.base) => execFileSync('git', args, { cwd, env: f.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  run(['init', '-q', 'fresh']);
  run(['init', '-q', '--bare', 'fresh.git']);
  for (const directory of ['fresh/.git', 'fresh.git']) assert.match(run(['--git-dir', directory, 'symbolic-ref', 'HEAD']), /^refs\/heads\//);
  run(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'base'], path.join(f.base, 'fresh'));
  run(['clone', '-q', 'fresh', 'cloned']);
  run(['clone', '-q', '--bare', 'fresh', 'cloned.git']);
  assert.equal(run(['rev-parse', 'HEAD'], path.join(f.base, 'cloned')), run(['rev-parse', 'HEAD'], path.join(f.base, 'fresh')));

  const rejecting = '#!/bin/sh\ncat >/dev/null\n[ "$1" = prepared ] && { echo rejected by original hook >&2; exit 9; }\nexit 0\n';
  const template = path.join(f.base, 'template');
  await executable(path.join(template, 'hooks/reference-transaction'), rejecting);
  // Older Git creates the initial HEAD without running reference-transaction.
  let initRunsHook = true;
  try { run(['-c', `core.hooksPath=${path.join(template, 'hooks')}`, 'init', '-q', 'probe']); initRunsHook = false; } catch {}
  if (initRunsHook) assert.throws(() => run(['init', '-q', `--template=${template}`, 'templated']), error => /rejected by original hook/.test(error.stderr));
  f.git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'base');
  await executable(path.join(f.repo, '.git/hooks/reference-transaction'), rejecting);
  assert.throws(() => f.git('update-ref', 'refs/heads/blocked', 'HEAD'), error => /rejected by original hook/.test(error.stderr));
});

test('generated gate dispatcher safely quotes the Node, CLI and state paths', async t => {
  const f = await fixture(t);
  await install(f.options);
  const hookDir = f.git('config', '--global', '--get', 'core.hooksPath');
  await assert.rejects(async () => execFileSync(path.join(hookDir, 'pre-commit'), [], { cwd: f.repo, env: { ...f.env, SPHINX_TEST_GATE: '17' }, input: '' }), error => error.status === 17);
});

test('non-gated protocol hooks retain streaming stdin and stdout', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  await executable(path.join(f.repo, '.git/hooks/proc-receive'), '#!/bin/sh\nread first\nprintf "ack:%s\\n" "$first"\nread second\nprintf "done:%s\\n" "$second"\n');
  await install(f.options);
  const hookDir = f.git('config', '--global', '--get', 'core.hooksPath');
  const child = spawn(path.join(hookDir, 'proc-receive'), [], { cwd: f.repo, env: f.env, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let output = '';
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output === 'ack:one\n') child.stdin.end('two\n');
    });
  });
  child.stdin.write('one\n');
  await finished;
  assert.equal(output, 'ack:one\ndone:two\n');
});

test('repository override is diagnosed and explicitly chained without replacing existing files', async t => {
  const f = await fixture(t);
  await executable(path.join(f.repo, 'custom-hooks/pre-push'), '#!/bin/sh\nexit 12\n');
  f.git('config', '--local', 'core.hooksPath', 'custom-hooks');
  const global = await install(f.options);
  assert.ok(global.warnings.some(w => w.includes('overrides')));
  assert.equal((await doctor(f.options)).checks.find(c => c.name === 'Current repository').ok, false);
  await install({ ...f.options, repo: true });
  assert.equal((await doctor(f.options)).checks.find(c => c.name === 'Current repository').ok, true);
  const reinstalled = await install(f.options);
  assert.equal(reinstalled.warnings.some(w => w.includes('overrides')), false, 'An existing Sphinx repository dispatcher already covers this override');
  assert.equal(await dispatchHook({ event: 'pre-push', input: '', cwd: f.repo, env: withGitShell(f.env), gate: async () => 0 }), 12);
  await uninstall({ ...f.options, repo: true });
  assert.equal(f.git('config', '--local', '--get', 'core.hooksPath'), 'custom-hooks');
  assert.match(await readFile(path.join(f.repo, 'custom-hooks/pre-push'), 'utf8'), /exit 12/);
});

test('uninstall preserves subsequent Git, generated-hook, and agent settings edits', async t => {
  const f = await fixture(t);
  await install({ ...f.options, agents: 'codex' });
  const hookDir = f.git('config', '--global', '--get', 'core.hooksPath');
  await writeFile(path.join(hookDir, 'pre-push'), '# user-edited\n');
  f.git('config', '--global', 'core.hooksPath', 'new-user-path');
  const file = path.join(f.paths.codexHome, 'hooks.json');
  const settings = await json(file);
  settings.hooks.SessionStart[0].hooks[0].timeout = 99;
  settings.unrelated = 'keep';
  await writeFile(file, JSON.stringify(settings));
  const result = await uninstall(f.options);
  assert.equal(f.git('config', '--global', '--get', 'core.hooksPath'), 'new-user-path');
  assert.equal(await readFile(path.join(hookDir, 'pre-push'), 'utf8'), '# user-edited\n');
  delete settings.hooks.PostToolUse; // Unedited Sphinx native hook is removed; the edited SessionStart stays.
  assert.deepEqual(await json(file), settings);
  assert.ok(result.warnings.length >= 3);
});

test('invalid existing agent settings stop installation before mutating Git', async t => {
  const f = await fixture(t);
  await mkdir(f.paths.claudeHome, { recursive: true });
  const file = path.join(f.paths.claudeHome, 'settings.json');
  await writeFile(file, '{broken');
  await assert.rejects(install({ ...f.options, agents: 'claude' }), /Cannot read/);
  assert.throws(() => f.git('config', '--global', '--get', 'core.hooksPath'));
  assert.equal(await readFile(file, 'utf8'), '{broken');
});

test('malformed agent settings errors identify the file without exposing its contents', async t => {
  const f = await fixture(t);
  await mkdir(f.paths.claudeHome, { recursive: true });
  const file = path.join(f.paths.claudeHome, 'settings.json');
  const sentinel = 'private-settings-sentinel-651a';
  await writeFile(file, sentinel);
  await assert.rejects(install({ ...f.options, agents: 'claude' }), error => {
    assert.match(error.message, /invalid JSON/);
    assert.ok(error.message.includes(file));
    assert.equal(error.message.includes(sentinel), false);
    return true;
  });
});

test('reinstallation refuses to clobber user edits and hook recursion fails closed', async t => {
  const f = await fixture(t);
  await install(f.options);
  await assert.rejects(dispatchHook({ event: 'pre-push', cwd: f.repo, env: { ...f.env, SPHINX_HOOK_DEPTH: '1' }, gate: async () => 0 }), /Recursive/);
  const hookDir = f.git('config', '--global', '--get', 'core.hooksPath');
  await writeFile(path.join(hookDir, 'pre-push'), '# edited');
  await assert.rejects(install(f.options), /Refusing to overwrite edited hook/);
});

test('repository installation can inherit a global chain and outlive global uninstall', async t => {
  const f = await fixture(t);
  await install(f.options);
  await install({ ...f.options, repo: true });
  const manifest = await json(f.paths.install);
  const repoEntry = Object.values(manifest.installs).find(entry => entry.id !== 'global');
  assert.deepEqual(repoEntry.source, { kind: 'default' });
  await uninstall(f.options);
  assert.equal((await doctor(f.options)).checks.find(check => check.name === 'Current repository').ok, true);
  let calls = 0;
  assert.equal(await dispatchHook({ event: 'pre-push', cwd: f.repo, env: f.env, gate: async () => { calls++; return 0; } }), 0);
  assert.equal(calls, 1);
  await uninstall({ ...f.options, repo: true });
  assert.throws(() => f.git('config', '--local', '--get', 'core.hooksPath'));
});

test('integration-home override isolates Git even without GIT_CONFIG_GLOBAL', async t => {
  const f = await fixture(t);
  const env = { ...f.env, HOME: path.join(f.base, 'unrelated-home') };
  delete env.GIT_CONFIG_GLOBAL;
  await mkdir(env.HOME);
  await install({ ...f.options, env });
  assert.match(await readFile(path.join(f.home, '.gitconfig'), 'utf8'), /hooksPath/);
  await assert.rejects(readFile(path.join(env.HOME, '.gitconfig')), { code: 'ENOENT' });
});

test('reinstalling an edited agent hook refuses to create a second Sphinx handler', async t => {
  const f = await fixture(t);
  await install({ ...f.options, agents: 'claude' });
  const file = path.join(f.paths.claudeHome, 'settings.json');
  const settings = await json(file);
  settings.hooks.SessionStart[0].hooks[0].timeout = 42;
  await writeFile(file, JSON.stringify(settings));
  await assert.rejects(install({ ...f.options, agents: 'claude' }), /edited claude integration/);
  assert.deepEqual(await json(file), settings);
});

test('installer preserves user replacement symlinks and reports intentionally unselected agents as optional', async t => {
  const f = await fixture(t);
  await install(f.options);
  const report = await doctor({ ...f.options, platform: 'linux' });
  assert.equal(report.checks.every(check => check.ok), true);
  assert.match(report.checks.find(check => check.name === 'codex integration').detail, /Not selected/);
  const hookDir = f.git('config', '--global', '--get', 'core.hooksPath');
  const file = path.join(hookDir, 'pre-push');
  const original = await readFile(file, 'utf8');
  const target = path.join(f.base, 'user-hook');
  await writeFile(target, original);
  await rm(file);
  await symlink(target, file);
  await assert.rejects(install(f.options), /edited hook symlink/);
  const result = await uninstall(f.options);
  assert.ok(result.warnings.some(warning => warning.includes('hook symlink')));
  assert.equal((await lstat(file)).isSymbolicLink(), true);
  assert.equal(await readFile(target, 'utf8'), original);
});

test('native questionnaire hooks register host MCP servers without changing unrelated settings', async t => {
  const f = await fixture(t);
  const tomlFile = path.join(f.paths.codexHome, 'config.toml');
  const claudeFile = path.join(f.home, '.claude.json');
  const beforeToml = '# Keep this exact formatting\nmodel = "existing-model"\n\n[mcp_servers.other]\ncommand = "/bin/echo"\nargs = ["hello"]\n';
  const beforeClaude = { numStartups: 17, oauthAccount: { accountUuid: 'existing-test-id' }, projects: { '/other': { hasTrustDialogAccepted: false } }, mcpServers: { other: { type: 'stdio', command: '/bin/echo' } } };
  await mkdir(f.paths.codexHome, { recursive: true });
  await writeFile(tomlFile, beforeToml);
  await writeFile(claudeFile, JSON.stringify(beforeClaude));
  await install({ ...f.options, agents: 'codex,claude', platform: 'linux' });
  for (const name of ['codex', 'claude']) {
    const file = path.join(f.paths[`${name}Home`], name === 'codex' ? 'hooks.json' : 'settings.json');
    const document = await json(file);
    const events = name === 'codex' ? ['PostToolUse'] : ['PostToolUse', 'PostToolUseFailure'];
    assert.equal(document.hooks.SessionStart.length, 1);
    assert.equal(document.hooks.SessionStart[0].hooks[0].statusMessage, 'Sphinx session setup');
    for (const event of events) {
      const group = document.hooks[event][0];
      assert.equal(group.matcher, 'Bash');
      // A command hook needs no MCP connection, so sessions opened before install never error.
      assert.deepEqual(group.hooks[0], { type: 'command', command: document.hooks.SessionStart[0].hooks[0].command, timeout: 1800, statusMessage: 'Sphinx understanding check' });
    }
  }
  const toml = await readFile(tomlFile, 'utf8');
  assert.ok(toml.startsWith(beforeToml));
  assert.match(toml, /\[mcp_servers\.sphinx\]/);
  assert.match(toml, /tool_timeout_sec = 1800/);
  const claude = await json(claudeFile);
  assert.deepEqual(claude.oauthAccount, beforeClaude.oauthAccount);
  assert.deepEqual(claude.mcpServers.sphinx, { type: 'stdio', command: process.execPath, args: [f.cliPath, 'mcp'], env: { SPHINX_HOME: f.paths.home }, timeout: 1800000 });
  assert.equal((await doctor({ ...f.options, platform: 'linux' })).checks.every(check => check.ok), true);
  await install({ ...f.options, agents: 'codex,claude', platform: 'linux' });
  assert.equal((await readFile(tomlFile, 'utf8')).split('[mcp_servers.sphinx]').length, 2);
  assert.equal((await json(path.join(f.paths.claudeHome, 'settings.json'))).hooks.PostToolUseFailure.length, 1);
  await uninstall(f.options);
  assert.equal(await readFile(tomlFile, 'utf8'), beforeToml);
  assert.deepEqual(await json(claudeFile), beforeClaude);
});

test('legacy SessionStart-only manifest upgrades in place and removes cleanly', async t => {
  const f = await fixture(t);
  await install({ ...f.options, agents: 'codex' });
  const manifest = await json(f.paths.install), record = manifest.agents.codex;
  const hooks = await json(record.file);
  delete hooks.hooks.SessionStart[0].hooks[0].statusMessage;
  delete hooks.hooks.PostToolUse;
  await writeFile(record.file, JSON.stringify(hooks));
  await rm(record.mcp.file);
  delete record.hooks; delete record.mcp; delete record.emptyEvents;
  await writeFile(f.paths.install, JSON.stringify(manifest));
  assert.equal((await doctor(f.options)).checks.find(check => check.name === 'codex integration').ok, false);
  await install({ ...f.options, agents: 'codex' });
  const migrated = await json(record.file);
  assert.equal(migrated.hooks.SessionStart.length, 1);
  assert.equal(migrated.hooks.SessionStart[0].hooks[0].statusMessage, 'Sphinx session setup');
  assert.equal(migrated.hooks.PostToolUse.length, 1);
  assert.equal((await doctor(f.options)).checks.every(check => check.ok), true);
  await uninstall(f.options);
  await assert.rejects(readFile(record.file), { code: 'ENOENT' });
});

test('unlabelled native installations gain labels once and preserve unrelated hooks on removal', async t => {
  const f = await fixture(t);
  await install({ ...f.options, agents: 'codex,claude' });
  const manifest = await json(f.paths.install);
  const other = { type: 'command', command: 'my-session-hook', statusMessage: 'My session hook' };
  for (const name of ['codex', 'claude']) {
    const record = manifest.agents[name], document = await json(record.file);
    delete record.hooks.find(spec => spec.event === 'SessionStart').group.hooks[0].statusMessage;
    delete document.hooks.SessionStart[0].hooks[0].statusMessage;
    document.hooks.SessionStart[0].hooks.push(other);
    await writeFile(record.file, JSON.stringify(document));
  }
  await writeFile(f.paths.install, JSON.stringify(manifest));
  await install({ ...f.options, agents: 'codex,claude' });
  const upgraded = new Map();
  for (const name of ['codex', 'claude']) {
    const file = manifest.agents[name].file, document = await json(file);
    const handlers = document.hooks.SessionStart.flatMap(group => group.hooks);
    assert.equal(handlers.length, 2);
    assert.deepEqual(handlers.find(handler => handler.command === other.command), other);
    assert.equal(handlers.filter(handler => handler.statusMessage === 'Sphinx session setup').length, 1);
    upgraded.set(file, await readFile(file, 'utf8'));
  }
  await install({ ...f.options, agents: 'codex,claude' });
  for (const [file, text] of upgraded) assert.equal(await readFile(file, 'utf8'), text);
  assert.equal((await doctor(f.options)).checks.every(check => check.ok), true);
  await uninstall(f.options);
  for (const file of upgraded.keys()) assert.deepEqual(await json(file), { hooks: { SessionStart: [{ hooks: [other] }] } });
});

test('a user-edited hook label is preserved instead of overwritten or removed', async t => {
  const f = await fixture(t);
  await install({ ...f.options, agents: 'codex' });
  const record = (await json(f.paths.install)).agents.codex, document = await json(record.file);
  document.hooks.SessionStart[0].hooks[0].statusMessage = 'My custom checkpoint setup';
  await writeFile(record.file, JSON.stringify(document));
  await assert.rejects(install({ ...f.options, agents: 'codex' }), /Refusing to replace an edited codex integration/);
  await uninstall(f.options);
  assert.deepEqual(await json(record.file), { hooks: { SessionStart: document.hooks.SessionStart } });
});

test('existing MCP server names and edited native hook matchers are never overwritten', async t => {
  const f = await fixture(t);
  const file = path.join(f.home, '.claude.json');
  const original = { mcpServers: { sphinx: { type: 'stdio', command: '/my/sphinx' } } };
  await writeFile(file, JSON.stringify(original));
  await assert.rejects(install({ ...f.options, agents: 'claude' }), /existing or edited sphinx/);
  assert.deepEqual(await json(file), original);
  assert.throws(() => f.git('config', '--global', '--get', 'core.hooksPath'));
  await rm(file);
  await install({ ...f.options, agents: 'claude' });
  const settingsFile = path.join(f.paths.claudeHome, 'settings.json');
  const settings = await json(settingsFile);
  settings.hooks.PostToolUse[0].matcher = 'Write';
  await writeFile(settingsFile, JSON.stringify(settings));
  await assert.rejects(install({ ...f.options, agents: 'claude' }), /edited claude integration/);
  assert.deepEqual(await json(settingsFile), settings);
});

test('uninstall retains modified MCP registrations and later unrelated TOML additions', async t => {
  const f = await fixture(t);
  await install({ ...f.options, agents: 'codex,claude' });
  const codexFile = path.join(f.paths.codexHome, 'config.toml');
  const original = await readFile(codexFile, 'utf8');
  const addition = '\n[profiles.added-later]\nmodel = "keep-this"\n';
  await writeFile(codexFile, original + addition);
  const claudeFile = path.join(f.home, '.claude.json');
  const document = await json(claudeFile);
  document.mcpServers.sphinx.timeout = 123000;
  document.userPreference = true;
  await writeFile(claudeFile, JSON.stringify(document));
  assert.equal((await doctor(f.options)).checks.find(check => check.name === 'claude questionnaire server').ok, false);
  const result = await uninstall(f.options);
  assert.equal(await readFile(codexFile, 'utf8'), addition);
  assert.deepEqual(await json(claudeFile), document);
  assert.ok(result.warnings.some(warning => warning.includes('MCP server was edited')));
});

test('Codex registration rejects quoted and inline name conflicts but preserves multiline values', async t => {
  const f = await fixture(t);
  await mkdir(f.paths.codexHome, { recursive: true });
  const file = path.join(f.paths.codexHome, 'config.toml');
  for (const conflict of ['[mcp_servers."sphinx"]\ncommand="existing"\n', 'mcp_servers = { other = { command = "existing" } }\n', '[mcp_servers]\nsphinx = { command = "existing" }\n']) {
    await writeFile(file, conflict);
    await assert.rejects(install({ ...f.options, agents: 'codex' }), /existing|conflicts/);
    assert.equal(await readFile(file, 'utf8'), conflict);
  }
  const multiline = 'description = """\n[mcp_servers.sphinx]\nThis is text, not a table.\n"""\n[profiles."a.b"]\nmodel="existing"\n';
  await writeFile(file, multiline);
  await install({ ...f.options, agents: 'codex' });
  await uninstall(f.options);
  assert.equal(await readFile(file, 'utf8'), multiline);
});

test('malformed Claude MCP JSON errors never disclose settings contents', async t => {
  const f = await fixture(t);
  const secret = 'test-auth-sentinel-6c97';
  await writeFile(path.join(f.home, '.claude.json'), secret);
  await assert.rejects(install({ ...f.options, agents: 'claude' }), error => {
    assert.match(error.message, /invalid JSON/);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
  assert.throws(() => f.git('config', '--global', '--get', 'core.hooksPath'));
});

test('preparation hooks preserve streaming input and original status while scheduling without a terminal', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const scheduled = path.join(f.base, 'scheduled');
  await writeFile(f.cliPath, `import {writeFile} from 'node:fs/promises';\nlet input='';for await(const chunk of process.stdin)input+=chunk;\nawait writeFile(process.env.SPHINX_TEST_SCHEDULED,JSON.stringify({args:process.argv.slice(2),input}));\nsetTimeout(()=>{},1500);\n`);
  await executable(path.join(f.repo, '.git/hooks/post-rewrite'), '#!/bin/sh\nread first\nprintf "ack:%s\\n" "$first"\nread second\nprintf "done:%s:%s\\n" "$1" "$second"\nexit 13\n');
  await install(f.options);
  const hookDir = f.git('config', '--global', '--get', 'core.hooksPath');
  const child = spawn(path.join(hookDir, 'post-rewrite'), ['amend'], { cwd: f.repo, env: { ...f.env, SPHINX_TEST_SCHEDULED: scheduled }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let output = '';
  const acknowledged = new Promise(resolve => child.stdout.on('data', chunk => { output += chunk; if (output.includes('ack:first\n')) resolve(); }));
  const closed = new Promise(resolve => child.on('close', resolve));
  child.stdin.write('first\n'); await acknowledged;
  child.stdin.end('second\n');
  assert.equal(await closed, 13);
  assert.equal(output, 'ack:first\ndone:amend:second\n');
  for (let i = 0; i < 100; i++) {
    if (await readFile(scheduled, 'utf8').catch(() => '')) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(await json(scheduled), { args: ['prepare'], input: '' });
  // A scheduler that stays alive must not hold the post-hook's streams open.
  assert.equal(child.exitCode, 13);
  await rm(scheduled);
  execFileSync(path.join(hookDir, 'post-commit'), [], { cwd: f.repo, env: { ...f.env, SPHINX_EVALUATOR: '1', SPHINX_TEST_SCHEDULED: scheduled }, timeout: 1000 });
  await new Promise(resolve => setTimeout(resolve, 100));
  await assert.rejects(readFile(scheduled), error => error.code === 'ENOENT');
  for (const hook of ['post-commit', 'post-merge', 'post-rewrite', 'post-checkout']) assert.match(await readFile(path.join(hookDir, hook), 'utf8'), / prepare <\/dev\/null >\/dev\/null 2>&1 &/);
  await uninstall(f.options);
  assert.equal(await readFile(path.join(f.repo, '.git/hooks/post-rewrite'), 'utf8'), '#!/bin/sh\nread first\nprintf "ack:%s\\n" "$first"\nread second\nprintf "done:%s:%s\\n" "$1" "$second"\nexit 13\n');
});

test('a dotfiles-symlinked Claude settings file is updated through its link, and uninstall keeps the target', async t => {
  const f = await fixture(t);
  const dotfiles = path.join(f.base, 'dotfiles'), target = path.join(dotfiles, 'claude-settings.json'), link = path.join(f.paths.claudeHome, 'settings.json');
  await mkdir(dotfiles, { recursive: true }); await mkdir(f.paths.claudeHome, { recursive: true });
  await writeFile(target, JSON.stringify({ theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] } }));
  await symlink(target, link);
  await install({ ...f.options, agents: 'claude' });
  assert.ok((await lstat(link)).isSymbolicLink(), 'The dotfiles link is kept');
  const updated = await json(target);
  assert.equal(updated.theme, 'dark');
  assert.ok(updated.hooks.SessionStart?.length && updated.hooks.PostToolUse?.length, 'Hooks were written to the link target');
  assert.deepEqual(updated.hooks.Stop, [{ hooks: [{ type: 'command', command: 'mine' }] }]);
  await uninstall({ env: f.env });
  assert.ok((await lstat(link)).isSymbolicLink());
  const restored = await json(target);
  assert.equal(restored.theme, 'dark');
  assert.equal(restored.hooks.SessionStart, undefined);
});

test('a dangling settings symlink fails with a clear message and changes nothing', async t => {
  const f = await fixture(t);
  await mkdir(f.paths.claudeHome, { recursive: true });
  await symlink(path.join(f.base, 'missing.json'), path.join(f.paths.claudeHome, 'settings.json'));
  await assert.rejects(install({ ...f.options, agents: 'claude' }), /symlink to a missing file/);
});

test('hooks call the package manager shim on PATH so upgrades keep working; a checkout falls back to absolute paths', async t => {
  const { sphinxLauncher } = await import('../src/install.js');
  const f = await fixture(t);
  const cli = path.join(f.base, 'store', 'sphinx-understand@0.1.0_abc', 'node_modules', 'sphinx-understand', 'bin', 'sphinx.js');
  await executable(cli, '#!/usr/bin/env node\n');
  const npmBin = path.join(f.base, 'npm-bin'), pnpmBin = path.join(f.base, 'pnpm-home'), other = path.join(f.base, 'other');
  await mkdir(npmBin, { recursive: true }); await symlink(cli, path.join(npmBin, 'sphinx'));
  await executable(path.join(pnpmBin, 'sphinx'), '#!/bin/sh\nexec node "$basedir/global/5/node_modules/sphinx-understand/bin/sphinx.js" "$@"\n');
  await executable(path.join(other, 'sphinx'), '#!/bin/sh\necho unrelated tool\n');
  const node = '/opt/node/bin/node', q = value => `'${String(value).replaceAll("'", "'\\''")}'`;
  const npm = await sphinxLauncher(cli, { PATH: [other, npmBin].join(path.delimiter) }, node);
  assert.equal(npm.command, q(path.join(npmBin, 'sphinx')), 'An unrelated sphinx earlier on PATH is skipped');
  assert.equal(npm.env, `PATH='/opt/node/bin':"$PATH" `);
  const pnpm = await sphinxLauncher(cli, { PATH: pnpmBin }, node);
  assert.equal(pnpm.command, q(path.join(pnpmBin, 'sphinx')));
  const checkout = await sphinxLauncher(cli, { PATH: other }, node);
  assert.deepEqual(checkout, { env: '', command: `${q(node)} ${q(cli)}` });
  // Git's sh would split a Windows PATH prefix at the drive colon, so Windows never uses a shim or a PATH prefix.
  assert.deepEqual(await sphinxLauncher(cli, { PATH: npmBin }, node, 'win32'), { env: '', command: `${q(node)} ${q(cli)}` });
});

test('native Windows installs Git hooks only, rejects unsupported agents before changing anything, and doctor passes', async t => {
  const f = await fixture(t, { prefix: "sphinx 한글 ' " });
  // Both agent homes exist, so only the platform keeps `auto` from selecting them.
  await mkdir(f.paths.codexHome, { recursive: true }); await mkdir(f.paths.claudeHome, { recursive: true });
  const q = value => `'${String(value).replaceAll("'", "'\\''")}'`;
  const result = await install({ ...f.options, agents: 'auto', platform: 'win32' });
  assert.deepEqual(result.agents, []);
  assert.ok(result.warnings.includes(WINDOWS_AGENT_HINT));
  assert.equal(result.warnings.some(warning => warning.includes('No supported coding agent was detected')), false);
  const hookDir = f.git('config', '--global', '--get', 'core.hooksPath');
  assert.equal(hookDir, path.join(f.paths.home, 'hooks', 'global'));
  const prePush = await readFile(path.join(hookDir, 'pre-push'), 'utf8');
  assert.ok(prePush.includes(`exec ${q(process.execPath)} ${q(f.cliPath)} hook git 'pre-push' "$@"`));
  assert.doesNotMatch(prePush, /PATH=/);
  const report = await doctor({ env: f.env, cwd: f.repo, platform: 'win32' });
  assert.deepEqual(report.checks.filter(check => !check.ok), []);
  for (const name of ['codex', 'pi', 'cursor', 'opencode']) assert.equal(report.checks.find(check => check.name === `${name} integration`).detail, 'Not supported on native Windows yet.');
  assert.equal(report.checks.find(check => check.name === 'claude integration').detail, 'Not selected. Optional: sphinx install --agents claude.');
  assert.deepEqual(await detectAgents({ env: f.env, platform: 'win32' }), []);

  const g = await fixture(t);
  const claudeSettings = path.join(g.paths.claudeHome, 'settings.json');
  await mkdir(g.paths.codexHome, { recursive: true }); await mkdir(g.paths.claudeHome, { recursive: true });
  await writeFile(claudeSettings, '{broken');
  await assert.rejects(install({ ...g.options, agents: 'codex', platform: 'win32' }), /codex is not supported on native Windows yet; use WSL\./);
  // Claude Code is allowed, but one unsupported name rejects the whole list first, before its unreadable settings are opened.
  await assert.rejects(install({ ...g.options, agents: 'claude,pi', platform: 'win32' }), /pi is not supported on native Windows yet; use WSL\./);
  assert.throws(() => g.git('config', '--global', '--get', 'core.hooksPath'), error => error.status === 1);
  assert.equal(await readFile(claudeSettings, 'utf8'), '{broken');
  for (const file of [g.paths.install, path.join(g.paths.codexHome, 'hooks.json'), path.join(g.home, '.claude.json')]) await assert.rejects(readFile(file), { code: 'ENOENT' });

  assert.equal(WINDOWS_AGENT_HINT, 'On Windows, Sphinx installs Git hooks only. Add the optional Claude Code integration with sphinx install --agents claude.');
  for (const agents of ['auto', 'none', 'claude', ['claude']]) assert.doesNotThrow(() => checkAgentPlatform(agents, 'win32'));
  assert.throws(() => checkAgentPlatform('claude,pi', 'win32'), /pi is not supported/);
  assert.throws(() => checkAgentPlatform(['codex', 'cursor'], 'win32'), { message: 'Native Windows supports Git hooks and the optional Claude Code integration (--agents claude). codex, cursor are not supported on native Windows yet; use WSL.' });
  assert.doesNotThrow(() => checkAgentPlatform('codex', 'linux'));
});

test('the Windows agent check names each unsupported agent once and leaves unknown names to the existing validation', async t => {
  // Unknown names and empty entries are not "unsupported on Windows": prepareAgents reports them.
  for (const agents of ['codx', 'claude,', ',', 'Codex', 'claude,codx', ['claude', 'codx']]) assert.doesNotThrow(() => checkAgentPlatform(agents, 'win32'), JSON.stringify(agents));
  const message = names => `Native Windows supports Git hooks and the optional Claude Code integration (--agents claude). ${names} not supported on native Windows yet; use WSL.`;
  assert.throws(() => checkAgentPlatform('codex,codex', 'win32'), { message: message('codex is') });
  assert.throws(() => checkAgentPlatform('pi,codx,claude,codex,pi,,cursor', 'win32'), { message: message('pi, codex, cursor are') });
  const f = await fixture(t);
  for (const agents of ['codx', 'claude,']) await assert.rejects(install({ ...f.options, agents, platform: 'win32' }), /--agents must be auto, none, or a comma-separated list/);
  assert.throws(() => f.git('config', '--global', '--get', 'core.hooksPath'), error => error.status === 1);
});

test('Windows reinstall and uninstall restore an earlier backslash core.hooksPath exactly', async t => {
  const f = await fixture(t);
  const earlier = 'C:\\old hooks\\dir';
  f.git('config', '--global', 'core.hooksPath', earlier);
  await install({ ...f.options, platform: 'win32' });
  await install({ ...f.options, platform: 'win32' });
  assert.equal(f.git('config', '--global', '--get', 'core.hooksPath'), path.join(f.paths.home, 'hooks', 'global'));
  await uninstall(f.options);
  assert.equal(f.git('config', '--global', '--get', 'core.hooksPath'), earlier);
});

test('Windows install with auto keeps refreshing an opted-in Claude Code integration and shows the hint only when none is installed', async t => {
  const f = await fixture(t);
  const q = value => `'${String(value).replaceAll("'", "'\\''")}'`;
  // The CLI path after an update that moves it, for example into a new versioned package folder.
  const updated = path.join(f.base, "updated sphinx cli ' entry.mjs");
  await writeFile(updated, '');
  await install({ ...f.options, agents: 'claude', platform: 'win32' });
  const result = await install({ ...f.options, cliPath: updated, agents: 'auto', platform: 'win32' });
  assert.deepEqual(result.agents, ['claude']);
  assert.deepEqual(result.warnings, []);
  const settings = await json(path.join(f.paths.claudeHome, 'settings.json'));
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.equal(settings.hooks.SessionStart[0].hooks[0].command, `SPHINX_HOME=${q(f.paths.home)} ${q(process.execPath)} ${q(updated)} hook agent claude`);
  assert.deepEqual((await json(path.join(f.home, '.claude.json'))).mcpServers.sphinx.args, [updated, 'mcp']);
  assert.deepEqual((await doctor({ env: f.env, cwd: f.repo, platform: 'win32' })).checks.filter(check => !check.ok), []);
  // Only an integration the user opted into is kept: once it is gone, auto selects nothing and the hint returns.
  await uninstall(f.options);
  const bare = await install({ ...f.options, agents: 'auto', platform: 'win32' });
  assert.deepEqual(bare.agents, []);
  assert.deepEqual(bare.warnings, [WINDOWS_AGENT_HINT]);
});
