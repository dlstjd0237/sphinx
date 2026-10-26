import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, lstat, mkdir, open, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { getPaths, readJson, writeJson } from './config.js';
import { terminalCommand, spawnTerminal, createTerminalEnvironmentBridge, readTerminalEnvironment } from './terminal-launch.js';

const WORKER = fileURLToPath(new URL('./activation-worker.js', import.meta.url));
const AGENTS = ['codex', 'claude', 'pi', 'cursor', 'opencode'];
const TOKEN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SESSION_ENV = ['CODEX_THREAD_ID', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'PI_SESSION_ID', 'SPHINX_CLAUDE_SESSION', 'SPHINX_CURSOR_SESSION', 'SPHINX_OPENCODE_SESSION'];
const LABELS = { codex: 'Codex', claude: 'Claude Code', pi: 'Pi', cursor: 'Cursor', opencode: 'OpenCode' };
export const WINDOWS_ACTIVATION_NOTE = 'Sphinx does not open clients on Windows. Start a new Claude Code session in this repository to load Sphinx.';
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const desktop = (env, platform) => !env.SSH_CONNECTION && !env.SSH_TTY && !(env.CI && env.CI !== 'false' && env.CI !== '0') && (platform === 'darwin' || (platform === 'linux' && !!(env.DISPLAY || env.WAYLAND_DISPLAY)));
const freshEnvironment = env => Object.fromEntries(Object.entries(env).filter(([key]) => !SESSION_ENV.includes(key)));
const fileFor = (home, token) => path.join(home, 'activations', `${token}.json`);

function clientEnvironment(env) {
  const fresh = freshEnvironment(env);
  if (!env.SPHINX_USER_HOME) return fresh;
  const paths = getPaths(env);
  return { ...fresh, HOME: paths.userHome, CODEX_HOME: paths.codexHome, CLAUDE_CONFIG_DIR: paths.claudeHome, PI_CODING_AGENT_DIR: path.join(paths.userHome, '.pi', 'agent'), OPENCODE_CONFIG_DIR: path.join(paths.userHome, '.config', 'opencode'), XDG_CONFIG_HOME: path.join(paths.userHome, '.config'), XDG_DATA_HOME: path.join(paths.userHome, '.local', 'share'), XDG_STATE_HOME: path.join(paths.userHome, '.local', 'state'), XDG_CACHE_HOME: path.join(paths.userHome, '.cache') };
}

async function executable(name, env) {
  for (const directory of (env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    const file = path.resolve(directory, name);
    try { if ((await stat(file)).isFile()) { await access(file, constants.X_OK); return file; } } catch {}
  }
  return null;
}

async function cursorExecutable(env, platform, findExecutable) {
  const fromPath = await findExecutable('cursor', env);
  if (fromPath || platform !== 'darwin') return fromPath;
  // Use the editor's own launcher when "Install cursor command" was not run.
  // Test homes must never fall through to the real machine's Applications.
  const roots = env.SPHINX_USER_HOME ? [path.join(getPaths(env).userHome, 'Applications')] : ['/Applications', path.join(getPaths(env).userHome, 'Applications')];
  for (const root of roots) {
    const file = path.join(root, 'Cursor.app', 'Contents', 'Resources', 'app', 'bin', 'code');
    try { if ((await stat(file)).isFile()) { await access(file, constants.X_OK); return file; } } catch {}
  }
  return null;
}

async function clientVersion(binary, env) {
  return new Promise(resolve => {
    execFile(binary, ['--version'], { env, timeout: 2000, maxBuffer: 4096, encoding: 'utf8' }, (error, stdout) => {
      if (error) { resolve(null); return; }
      const match = /^(?:Cursor\s+)?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+][^\s]*)?\s*$/im.exec(stdout);
      resolve(match ? `${match[1]}.${match[2]}.${match[3] || 0}` : null);
    });
  });
}

async function activationDirectory(home) {
  const directory = path.join(home, 'activations');
  const info = await lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new Error('Refusing an unsafe client activation directory.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

/** Instructions stay in the terminal; they are never submitted as a model prompt. */
export function activationGuidance(agent) {
  const steps = {
    codex: 'In Codex, open /hooks to review and trust the Sphinx hooks.',
    claude: 'Respond to any Claude setup or MCP permission prompts. Use /mcp to inspect Sphinx.',
    pi: 'Blocking Git checks use a local browser page. Pi dialogs handle fallback checkpoints.',
    opencode: 'When Git requires a checkpoint, Sphinx serves a local browser questionnaire without moving your coding window.',
  };
  return `Sphinx · ${LABELS[agent]}\n${steps[agent]}\nStarting a fresh session in this repository. No prompt has been submitted.\n\n`;
}

/** Open configured clients only; the caller supplies the installed selection. */
export async function activateIntegrations({ agents = [], cwd = process.cwd(), env = process.env, platform = process.platform, findExecutable = executable, readClientVersion = clientVersion, launch = spawnTerminal, environmentBridge = createTerminalEnvironmentBridge, timeoutMs = 20000, pollMs = 50, wait = delay } = {}) {
  if (!Array.isArray(agents) || agents.some(agent => !AGENTS.includes(agent))) throw new Error('Choose codex, claude, pi, cursor, or opencode for activation.');
  if (typeof cwd !== 'string' || cwd.includes('\0') || !path.isAbsolute(cwd)) throw new Error('Client activation needs an absolute repository directory.');
  if (!(await stat(cwd)).isDirectory()) throw new Error('Client activation needs an existing directory.');
  const home = getPaths(env).home;
  const results = await Promise.all([...new Set(agents)].map(async agent => {
    const command = agent === 'cursor' ? `cursor --new-window ${quote(cwd)}` : agent;
    const result = (status, detail) => ({ agent, status, detail, command, cwd });
    if (platform === 'win32') return result('unavailable', WINDOWS_ACTIVATION_NOTE);
    if (env.SPHINX_EVALUATOR === '1') return result('unavailable', 'Client activation is disabled inside an evaluator.');
    if (!desktop(env, platform)) return result('unavailable', `No local desktop is available. Open a terminal in this repository and run ${command}.`);
    let binary;
    try { binary = agent === 'cursor' ? await cursorExecutable(env, platform, findExecutable) : await findExecutable(agent, env); }
    catch { return result('unavailable', `Could not locate ${LABELS[agent]}. Open it manually in this repository.`); }
    if (binary && (!path.isAbsolute(binary) || binary.includes('\0'))) return result('unavailable', `Could not locate a valid ${LABELS[agent]} executable.`);
    if (!binary) return result('unavailable', `${LABELS[agent]} is configured but its executable is not on PATH. Open it manually in this repository.`);
    if (agent === 'cursor') {
      // The editor CLI has this spelling; never substitute cursor-agent or agent.
      try {
        const version = await readClientVersion(binary, clientEnvironment(env));
        if (/^\d+\.\d+\.\d+$/.test(version || '')) {
          const [major, minor] = version.split('.').map(Number);
          // Hooks first appeared in Cursor 1.7. Passing this floor does not
          // certify support for every current hook event or verify permissions.
          if (major < 1 || (major === 1 && minor < 7)) return result('unavailable', `Cursor ${version} predates hook support. Update Cursor, then run sphinx activate --agents cursor.`);
        }
        const opened = await launch({ command: binary, args: ['--new-window', cwd], waitForExit: true }, { env: clientEnvironment(env) });
        return opened ? result('opened', 'Opened a new Cursor editor window. Start a new agent chat there; hook loading and permissions remain controlled by Cursor.') : result('failed', 'Cursor did not accept the window launch. Open the editor manually in this repository.');
      } catch { return result('failed', 'Cursor could not be opened. Open the editor manually in this repository.'); }
    }
    let bridge, recordFile, claimFile;
    try {
      await activationDirectory(home);
      const token = randomUUID();
      recordFile = fileFor(home, token); claimFile = `${recordFile}.claim`;
      const terminal = await terminalCommand({ recordFile, token, home, platform, env, findExecutable, workerPath: WORKER });
      if (!terminal) return result('unavailable', `No supported desktop terminal was found. Open a terminal in this repository and run ${command}.`);
      bridge = await environmentBridge(clientEnvironment(env), token);
      await writeJson(recordFile, { version: 1, token, home, agent, command: binary, cwd, envSocket: bridge.socketPath, status: 'starting', createdAt: Date.now() });
      const accepted = await launch(terminal, { env: clientEnvironment(env) });
      if (!accepted) return result('failed', `Could not open a terminal for ${LABELS[agent]}. Run ${command} in this repository.`);
      // Keep the one-shot IPC alive until the worker has received the environment
      // and its interactive client emits spawn. Never wait for the session to end.
      const deadline = Date.now() + timeoutMs;
      do {
        const current = await readJson(recordFile, null);
        if (current?.token !== token) return result('failed', `The ${LABELS[agent]} launch could not be confirmed. Open it manually.`);
        if (current.status === 'opened') return result('opened', agent === 'codex' ? 'Started a fresh Codex session. Open /hooks there to review and trust Sphinx hooks.' : `Started a fresh ${LABELS[agent]} session. Complete any setup or permissions in that terminal.`);
        if (current.status === 'failed') return result('failed', `${LABELS[agent]} could not start in the terminal. Run ${command} in this repository.`);
        if (Date.now() >= deadline) break;
        await wait(Math.min(pollMs, deadline - Date.now()));
      } while (true);
      return result('failed', `The terminal opened, but ${LABELS[agent]} startup was not confirmed. Check that terminal or run ${command} manually.`);
    } catch { return result('failed', `Could not start ${LABELS[agent]}. Run ${command} in this repository.`); }
    finally {
      await bridge?.close().catch(() => {});
      if (recordFile) await rm(recordFile, { force: true }).catch(() => {});
      if (claimFile) await rm(claimFile, { force: true }).catch(() => {});
    }
  }));
  return { results };
}

/** Runs in the opened terminal, never in the installing coding-agent session. */
export async function runActivationTerminal({ recordFile, token, env = process.env, isTTY = !!process.stdin.isTTY, spawnImpl = spawn, write = text => process.stdout.write(text), startupGraceMs = 300 } = {}) {
  const home = getPaths(env).home;
  if (!TOKEN.test(token) || recordFile !== fileFor(home, token)) throw new Error('Invalid client activation worker.');
  await activationDirectory(home);
  let claim;
  try { claim = await open(`${recordFile}.claim`, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') return { status: 'ignored', code: 1 }; throw error; }
  try {
    const record = await readJson(recordFile, null);
    if (!record || record.version !== 1 || record.token !== token || record.home !== home || !AGENTS.filter(agent => agent !== 'cursor').includes(record.agent) || record.status !== 'starting' || !path.isAbsolute(record.command || '') || record.command.includes('\0') || !path.isAbsolute(record.cwd || '') || record.cwd.includes('\0')) return { status: 'ignored', code: 1 };
    const status = async value => {
      // Installation can time out or finish while this worker remains alive.
      // It owns cleanup; do not recreate an already removed launch record.
      try {
        if ((await readJson(recordFile, null))?.token === token) await writeJson(recordFile, { ...record, status: value });
      } catch { /* The parent reports unconfirmed startup if acknowledgment fails. */ }
    };
    if (!isTTY) { await status('failed'); return { status: 'failed', code: 1 }; }
    let providerEnv;
    try { providerEnv = await readTerminalEnvironment(record.envSocket, token); }
    catch { await status('failed'); return { status: 'failed', code: 1 }; }
    if (!(await readJson(recordFile, null))) return { status: 'ignored', code: 1 };
    write(activationGuidance(record.agent));
    let opened = false, stateWrite = Promise.resolve();
    const code = await new Promise(resolve => {
      let child, timer;
      try { child = spawnImpl(record.command, [], { cwd: record.cwd, env: { ...freshEnvironment(env), ...providerEnv, SPHINX_HOME: home }, stdio: 'inherit' }); }
      catch { stateWrite = status('failed'); resolve(1); return; }
      child.once('spawn', () => {
        timer = setTimeout(() => { opened = true; stateWrite = stateWrite.then(() => status('opened')); }, startupGraceMs);
      });
      child.once('error', () => { clearTimeout(timer); stateWrite = stateWrite.then(() => status('failed')); resolve(1); });
      child.once('exit', code => {
        clearTimeout(timer);
        if (!opened) stateWrite = stateWrite.then(() => status('failed'));
        resolve(code ?? 1);
      });
    });
    await stateWrite;
    return { status: opened ? 'closed' : 'failed', code };
  } finally {
    await claim.close();
    await rm(`${recordFile}.claim`, { force: true }).catch(() => {});
  }
}
