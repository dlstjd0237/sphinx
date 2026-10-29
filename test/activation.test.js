import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, chmod, symlink } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { activateIntegrations, runActivationTerminal, activationGuidance } from '../src/activation.js';
import { createTerminalEnvironmentBridge } from '../src/terminal-launch.js';
import { writeJson } from '../src/config.js';

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), "sphinx activation ' "));
  t.after(() => rm(base, { recursive: true, force: true }));
  const cwd = path.join(base, "repo $(do-not-execute) '"), home = path.join(base, 'state');
  await mkdir(cwd);
  const env = { HOME: '/not-the-test-home', SPHINX_USER_HOME: base, SPHINX_HOME: home, PATH: '/missing', DISPLAY: ':7', OPENROUTER_API_KEY: 'KEY-ONLY-IN-IPC', CODEX_THREAD_ID: 'old', CLAUDECODE: '1', PI_SESSION_ID: 'old', SPHINX_OPENCODE_SESSION: 'old', SPHINX_CURSOR_SESSION: 'old' };
  const findExecutable = async name => ['codex', 'claude', 'pi', 'opencode', 'cursor', 'xterm'].includes(name) ? `/fake/${name}` : null;
  return { base, cwd, home, env, options: { cwd, env, platform: 'linux', findExecutable, readClientVersion: async () => null, timeoutMs: 1000, pollMs: 5 } };
}

function fakeTerminals(f, { earlyExit, grace = 5 } = {}) {
  const captured = [], workers = [], children = [], records = [];
  const launch = async (command, options) => {
    if (command.command === '/fake/cursor') { captured.push({ agent: 'cursor', command, options }); return true; }
    const [recordFile, token] = command.args.slice(-2);
    const raw = await readFile(recordFile, 'utf8');
    assert.doesNotMatch(raw + JSON.stringify(command), /KEY-ONLY-IN-IPC|OPENROUTER_API_KEY/);
    records.push(JSON.parse(raw));
    const worker = runActivationTerminal({ recordFile, token, env: { SPHINX_HOME: f.home, HOME: '/terminal-home', CODEX_THREAD_ID: 'ambient', CLAUDECODE: '1' }, isTTY: true, startupGraceMs: grace, write: text => assert.match(text, /No prompt has been submitted/), spawnImpl: (binary, args, childOptions) => {
      captured.push({ agent: path.basename(binary), binary, args, options: childOptions });
      const child = new EventEmitter(); children.push(child);
      setImmediate(() => { child.emit('spawn'); if (earlyExit !== undefined) child.emit('exit', earlyExit); });
      return child;
    } });
    workers.push(worker);
    return true;
  };
  return { launch, captured, records, workers, close: async () => { for (const child of children) child.emit('exit', 0); await Promise.all(workers); } };
}

test('selected terminal clients start fresh with no prompt arguments and explicit homes through one-shot IPC', async t => {
  const f = await fixture(t), fake = fakeTerminals(f);
  const result = await activateIntegrations({ ...f.options, agents: ['codex', 'claude', 'pi', 'opencode', 'codex'], launch: fake.launch });
  try {
    assert.deepEqual(result.results.map(row => [row.agent, row.status]), [['codex', 'opened'], ['claude', 'opened'], ['pi', 'opened'], ['opencode', 'opened']]);
    assert.equal(fake.captured.length, 4);
    for (const call of fake.captured) {
      assert.deepEqual(call.args, []);
      assert.equal(call.options.cwd, f.cwd);
      assert.equal(call.options.stdio, 'inherit');
      assert.equal(call.options.env.OPENROUTER_API_KEY, 'KEY-ONLY-IN-IPC');
      assert.equal(call.options.env.HOME, f.base);
      assert.equal(call.options.env.CODEX_HOME, path.join(f.base, '.codex'));
      assert.equal(call.options.env.CLAUDE_CONFIG_DIR, path.join(f.base, '.claude'));
      assert.equal(call.options.env.PI_CODING_AGENT_DIR, path.join(f.base, '.pi', 'agent'));
      assert.equal(call.options.env.OPENCODE_CONFIG_DIR, path.join(f.base, '.config', 'opencode'));
      for (const name of ['CODEX_THREAD_ID', 'CLAUDECODE', 'PI_SESSION_ID', 'SPHINX_OPENCODE_SESSION', 'SPHINX_CURSOR_SESSION']) assert.equal(call.options.env[name], undefined);
    }
    assert.match(result.results[0].detail, /\/hooks/);
    assert.doesNotMatch(JSON.stringify(result), /KEY-ONLY-IN-IPC/);
    assert.deepEqual(await readdir(path.join(f.home, 'activations')), []);
  } finally { await fake.close(); }
});

test('activation only reports opened after the client remains alive through startup grace', async t => {
  const f = await fixture(t), fake = fakeTerminals(f, { earlyExit: 127, grace: 25 });
  const result = await activateIntegrations({ ...f.options, agents: ['pi'], launch: fake.launch });
  assert.equal(result.results[0].status, 'failed');
  assert.match(result.results[0].detail, /could not start/);
  await Promise.all(fake.workers);
});

test('Cursor opens the editor in a new window without using the coding-agent executable or claiming trust', async t => {
  const f = await fixture(t), fake = fakeTerminals(f);
  const result = await activateIntegrations({ ...f.options, agents: ['cursor'], launch: fake.launch });
  assert.equal(result.results[0].status, 'opened');
  assert.deepEqual(fake.captured[0].command, { command: '/fake/cursor', args: ['--new-window', f.cwd], waitForExit: true });
  assert.equal(fake.captured[0].options.env.CLAUDECODE, undefined);
  assert.equal(fake.captured[0].options.env.HOME, f.base);
  assert.match(result.results[0].detail, /controlled by Cursor/);
  assert.equal(fake.workers.length, 0);
});

test('macOS can find the bundled Cursor editor launcher without touching real Applications in test mode', async t => {
  const f = await fixture(t);
  const binary = path.join(f.base, 'Applications', 'Cursor.app', 'Contents', 'Resources', 'app', 'bin', 'code');
  await mkdir(path.dirname(binary), { recursive: true }); await writeFile(binary, '#!/bin/sh\n'); await chmod(binary, 0o700);
  let launched;
  const result = await activateIntegrations({ ...f.options, platform: 'darwin', agents: ['cursor'], findExecutable: async () => null, launch: async command => { launched = command; return true; } });
  assert.equal(result.results[0].status, 'opened');
  assert.equal(launched.command, binary);
  assert.deepEqual(launched.args, ['--new-window', f.cwd]);
});

test('known Cursor versions before hook support require an update rather than claiming activation', async t => {
  const f = await fixture(t);
  const result = await activateIntegrations({ ...f.options, agents: ['cursor'], readClientVersion: async () => '0.45.14', launch: () => assert.fail('do not open unsupported editor') });
  assert.equal(result.results[0].status, 'unavailable');
  assert.match(result.results[0].detail, /Update Cursor/);
  assert.match(result.results[0].detail, /0\.45\.14/);
  let calls = 0;
  const recent = await activateIntegrations({ ...f.options, agents: ['cursor'], readClientVersion: async () => '1.7.0', launch: async () => { calls++; return true; } });
  assert.equal(recent.results[0].status, 'opened'); assert.equal(calls, 1);
  assert.doesNotMatch(recent.results[0].detail, /hooks are active|trusted/);
});

test('missing clients, headless sessions, and evaluator contexts give actionable fallback without launching anything', async t => {
  const f = await fixture(t);
  const launch = () => assert.fail('must not open GUI');
  const absent = await activateIntegrations({ ...f.options, agents: ['pi'], findExecutable: async () => null, launch });
  assert.equal(absent.results[0].status, 'unavailable'); assert.match(absent.results[0].detail, /not on PATH/);
  for (const overrides of [{ DISPLAY: '' }, { SSH_CONNECTION: 'remote' }, { CI: 'true' }, { SPHINX_EVALUATOR: '1' }]) {
    const result = await activateIntegrations({ ...f.options, agents: ['codex', 'cursor'], env: { ...f.env, ...overrides }, launch });
    assert.ok(result.results.every(row => row.status === 'unavailable'));
  }
  assert.deepEqual(await activateIntegrations({ ...f.options, agents: [], launch }), { results: [] });
});

test('on Windows nothing is opened, and every agent gets the note to start a new Claude Code session', async t => {
  const f = await fixture(t);
  const note = 'Sphinx does not open clients on Windows. Start a new Claude Code session in this repository to load Sphinx.';
  const never = () => assert.fail('nothing may be looked up or launched on Windows');
  const bare = await activateIntegrations({ cwd: f.cwd, env: {}, platform: 'win32', agents: ['claude'], findExecutable: never, launch: never });
  assert.equal(bare.results[0].status, 'unavailable');
  assert.equal(bare.results[0].detail, note);
  // A display being set changes nothing: no client is looked up or launched.
  const all = await activateIntegrations({ ...f.options, platform: 'win32', agents: ['claude', 'codex'], findExecutable: never, launch: never });
  assert.deepEqual(all.results.map(row => [row.agent, row.status, row.detail]), [['claude', 'unavailable', note], ['codex', 'unavailable', note]]);
  await assert.rejects(readdir(path.join(f.home, 'activations')), { code: 'ENOENT' });
});

test('terminal acceptance alone is insufficient and timed-out startup cleans records and the environment socket', async t => {
  const f = await fixture(t); let socket;
  const result = await activateIntegrations({ ...f.options, agents: ['claude'], timeoutMs: 10, launch: async () => true, environmentBridge: async (...args) => { const bridge = await createTerminalEnvironmentBridge(...args); socket = bridge.socketPath; return bridge; } });
  assert.equal(result.results[0].status, 'failed'); assert.match(result.results[0].detail, /startup was not confirmed/);
  assert.deepEqual(await readdir(path.join(f.home, 'activations')), []);
  await assert.rejects(readFile(socket), { code: 'ENOENT' });
});

test('launcher errors stay generic and clean private state without exposing exception data', async t => {
  const f = await fixture(t);
  const result = await activateIntegrations({ ...f.options, agents: ['codex', 'cursor'], launch: async () => { throw new Error('SECRET-ERROR-DATA'); } });
  assert.ok(result.results.every(row => row.status === 'failed'));
  assert.doesNotMatch(JSON.stringify(result), /SECRET-ERROR-DATA/);
  assert.deepEqual(await readdir(path.join(f.home, 'activations')), []);
});

test('activation refuses unsupported names and symlinked state without running a client', async t => {
  const f = await fixture(t), launch = () => assert.fail('must not launch');
  await assert.rejects(activateIntegrations({ ...f.options, agents: ['agent'], launch }), /Choose codex/);
  await assert.rejects(activateIntegrations({ ...f.options, cwd: 'relative', launch }), /absolute/);
  const outside = path.join(f.base, 'outside'); await mkdir(outside); await mkdir(f.home); await symlink(outside, path.join(f.home, 'activations'));
  const result = await activateIntegrations({ ...f.options, agents: ['codex'], launch });
  assert.equal(result.results[0].status, 'failed'); assert.deepEqual(await readdir(outside), []);
});

test('activation worker requires exact private record/token, an interactive terminal, and an atomic claim', async t => {
  const f = await fixture(t), token = randomUUID(), recordFile = path.join(f.home, 'activations', `${token}.json`);
  const bridge = await createTerminalEnvironmentBridge(f.env, token); t.after(() => bridge.close());
  await writeJson(recordFile, { version: 1, token, home: f.home, agent: 'codex', command: '/fake/codex', cwd: f.cwd, status: 'starting', envSocket: bridge.socketPath });
  await assert.rejects(runActivationTerminal({ recordFile, token: randomUUID(), env: f.env, isTTY: true }), /Invalid/);
  let calls = 0, child;
  const options = { recordFile, token, env: f.env, isTTY: true, startupGraceMs: 1, write: () => {}, spawnImpl: () => { calls++; child = new EventEmitter(); setImmediate(() => child.emit('spawn')); return child; } };
  const first = runActivationTerminal(options);
  while (!child) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal((await runActivationTerminal(options)).status, 'ignored');
  child.emit('exit', 0); await first; assert.equal(calls, 1);
  await writeJson(recordFile, { version: 1, token, home: f.home, agent: 'codex', command: '/fake/codex', cwd: f.cwd, status: 'starting', envSocket: bridge.socketPath });
  assert.equal((await runActivationTerminal({ ...options, isTTY: false, spawnImpl: () => assert.fail('must not spawn') })).status, 'failed');
  assert.match(activationGuidance('codex'), /review and trust/);
});
