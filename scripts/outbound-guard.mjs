import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

// Test-only preload. Production/eval entry points never import this module.
const installed = Symbol.for('sphinx.test.networkGuard');
if (!globalThis[installed]) {
  globalThis[installed] = true;
  const local = host => {
    const value = String(host || 'localhost').toLowerCase().replace(/^\[|\]$/gu, '');
    return value === 'localhost' || value === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(value);
  };
  const deny = host => {
    if (!local(host)) throw Object.assign(new Error('Unit tests cannot make outbound network requests. Use an injected transport, loopback fixture, or the separate explicit live eval command.'), { code: 'SPHINX_TEST_NETWORK_BLOCKED' });
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('Unit-test fetch permits only loopback HTTP fixtures.'), { code: 'SPHINX_TEST_NETWORK_BLOCKED' });
    deny(url.hostname);
    return originalFetch(input, init);
  };
  const checkHttp = args => {
    let options = {}, first = args[0];
    if (typeof first === 'string' || first instanceof URL) { const url = new URL(first); options.hostname = url.hostname; }
    else options = { ...first };
    if (args[1] && typeof args[1] === 'object') options = { ...options, ...args[1] };
    if (options.socketPath) return;
    deny(options.hostname ?? options.host ?? 'localhost');
  };
  for (const module of [http, https]) for (const name of ['request', 'get']) {
    const original = module[name];
    module[name] = function (...args) { checkHttp(args); return Reflect.apply(original, this, args); };
  }
  // Also covers undici clients and redirects that bypass global fetch/http.
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const values = Array.isArray(args[0]) ? args[0] : args;
    const first = values[0];
    if (first && typeof first === 'object') { if (!first.path) deny(first.host ?? 'localhost'); }
    else if (typeof first === 'number') deny(typeof values[1] === 'string' ? values[1] : 'localhost');
    return Reflect.apply(connect, this, args);
  };

  // Preserve the guard even when a test deliberately supplies a small env to a
  // spawned CLI. This is not an OS sandbox and does not restrict non-Node tools.
  const preload = `--import ${JSON.stringify(import.meta.url)}`;
  const guardedOptions = options => {
    const env = { ...(options?.env ?? process.env) };
    const current = env.NODE_OPTIONS || '';
    env.NODE_OPTIONS = current.includes(import.meta.url) ? current : `${current} ${preload}`.trim();
    return { ...options, env };
  };
  // Windows cannot start the extensionless fixture CLIs that POSIX runs put first on PATH,
  // so a bare `claude`, `codex`, or `gh` would fall through to the developer's real install.
  // Both the wrapped functions and their promisify.custom variants call injected(), so both refuse.
  const realClis = new Set(['claude', 'codex', 'gh']);
  const refuseRealCli = (args, kind) => {
    if (process.platform !== 'win32' || typeof args[0] !== 'string') return;
    const program = kind === 'exec' ? args[0].trim().match(/^"[^"]*"|^'[^']*'|^\S*/u)[0].replace(/["']/gu, '') : args[0];
    if (realClis.has(path.win32.basename(program).toLowerCase().replace(/\.(?:exe|cmd|bat|com)$/u, ''))) {
      throw Object.assign(new Error('Unit tests cannot start a real provider or GitHub CLI on Windows. Use an injected runner or a fixture.'), { code: 'SPHINX_TEST_CLI_BLOCKED' });
    }
  };
  const injected = (args, kind) => {
    refuseRealCli(args, kind);
    const out = [...args];
    const index = kind === 'exec' ? 1 : Array.isArray(out[1]) || (out[1] == null && out[2] && typeof out[2] === 'object') ? 2 : 1;
    if (out[index] == null || typeof out[index] === 'object') out[index] = guardedOptions(out[index]);
    else out.splice(index, 0, guardedOptions());
    return out;
  };
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork', 'exec', 'execSync']) {
    const original = childProcess[name], kind = ['exec', 'execSync'].includes(name) ? 'exec' : 'file';
    const wrapped = function (...args) { return Reflect.apply(original, this, injected(args, kind)); };
    if (original[promisify.custom]) Object.defineProperty(wrapped, promisify.custom, { value: function (...args) { return Reflect.apply(original[promisify.custom], this, injected(args, kind)); } });
    childProcess[name] = wrapped;
  }
  syncBuiltinESMExports();
}
