import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { execFile, execFileSync, execSync, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import '../scripts/outbound-guard.mjs';

test('unit tests reject accidental real-provider requests before connecting', async () => {
  await assert.rejects(fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: '{}' }), { code: 'SPHINX_TEST_NETWORK_BLOCKED' });
  assert.throws(() => https.request('https://api.openai.com/v1/responses'), { code: 'SPHINX_TEST_NETWORK_BLOCKED' });
  assert.throws(() => http.get({ hostname: 'example.com', path: '/' }), { code: 'SPHINX_TEST_NETWORK_BLOCKED' });
  assert.throws(() => net.connect({ host: 'example.com', port: 443 }), { code: 'SPHINX_TEST_NETWORK_BLOCKED' });
});

test('loopback fixtures and injected transports remain usable', async t => {
  const server = http.createServer((_request, response) => response.end('local fixture'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(await result.text(), 'local fixture');
  const injected = async () => new Response('mock');
  assert.equal(await (await injected('https://openrouter.ai/')).text(), 'mock');
});

test('spawned Node fixtures inherit the guard even with an explicitly isolated env', async () => {
  const source = "try { await fetch('https://openrouter.ai/api/v1/chat/completions'); process.exitCode=1; } catch(error) { process.stdout.write(error.code || error.message); }";
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', source], { env: { PATH: process.env.PATH } });
  assert.equal(result.stdout, 'SPHINX_TEST_NETWORK_BLOCKED');
});

test('a loopback redirect cannot escape to an outbound provider', async t => {
  const server = http.createServer((_request, response) => { response.writeHead(302, { Location: 'https://openrouter.ai/api/v1/chat/completions' }); response.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(fetch(`http://127.0.0.1:${server.address().port}/`), error => error.code === 'SPHINX_TEST_NETWORK_BLOCKED' || error.cause?.code === 'SPHINX_TEST_NETWORK_BLOCKED');
});

// Windows cannot start the extensionless fixture CLIs, so PATH lookup would fall through to the real installs.
// Every blocked call must be refused before a process starts; only --version or no arguments is ever passed.
test('on Windows, tests cannot start a real claude, codex, or gh CLI', { skip: process.platform !== 'win32' }, async () => {
  const blocked = { code: 'SPHINX_TEST_CLI_BLOCKED' };
  assert.throws(() => spawn('claude', ['--version']), blocked);
  assert.throws(() => execFileSync('codex.cmd', ['--version']), blocked);
  assert.throws(() => spawnSync('C:\\Users\\x\\.local\\bin\\claude.exe', []), blocked);
  assert.throws(() => execSync('gh --version'), blocked);
  assert.throws(() => execSync('"C:\\Program Files\\GitHub CLI\\gh.exe" --version'), blocked);
  await assert.rejects(async () => promisify(execFile)('claude', ['--version']), blocked);
  assert.match(execFileSync('git', ['--version'], { encoding: 'utf8' }), /^git version/u);
});
