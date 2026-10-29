import { createServer } from 'node:http';
import path from 'node:path';
import { readStats, scoreSummary } from './stats.js';
import { planProviders } from './evaluator.js';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { DISTANCES, loadConfig, policyHash, readJson, repositoryConfigInfo, saveConfig } from './config.js';
import { revalidateSnapshot, repositoryName } from './git.js';
import { createSessionStore, fallbackText, savedDraft } from './sessions.js';
import { prepareInteractiveCheck, isRateLimit, isCliFailure, switchChoices, PLAN_NAMES } from './check-recovery.js';
import { claimCheckpointDialog, finishCheckpointDialog, waitForCheckpointTerminal } from './terminal-launch.js';
import { browserPage } from './browser-page.js';
import { recordOverride } from './overrides.js';
import { withTextStream, partialField } from './stream.js';
import { loadChangeView } from './change-view.js';
import { updateStatus, updatePlan, scheduleUpdate } from './update.js';
import { modelChoices, validChoice } from './model-choices.js';
import { setRepositoryDistance } from './repo-config.js';
import { pullRequestPush, usesSphinxAction } from './github.js';
import { SESSION_ENV } from './activation.js';
import { envValue, withoutAddedCwdBlock } from './windows.js';
import { stderrLine } from './terminal.js';
import { LANGUAGES, join, localize, msg, t } from './i18n.js';

const ID = /^[a-f0-9]{64}$/u;
const cancelled = () => Object.assign(new Error('Check paused. Progress is saved.'), { code: 'SPHINX_CANCELLED' });
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const offLimits = env => env.SPHINX_EVALUATOR === '1' || (env.CI && !['false', '0'].includes(env.CI));
// The waiting Git operation, as the hook's own (English) lines name it.
const operation = event => event === 'pre-commit' ? 'commit' : 'push';
// Sphinx's sentences that name the waiting operation, one catalog key per operation: keys are never built at runtime.
// A sentence holds its varying parts as {placeholders}, so each language orders them its own way. keptPass is what a
// pass that did not go through still does: the Git gate holds it until Continue.
const OPERATION_KEYS = {
  push: {
    keptPass: 'server.keptPass.push', cutShort: 'server.paused.cutShortPush', gitStopped: 'server.paused.gitStoppedPush', chooseConsent: 'server.http.chooseConsentPush',
    passedEarlier: 'server.earlier.passedPush', noQuestionsEarlier: 'server.earlier.noQuestionsPush', notify: 'server.notify.continuePush', question: 'server.consent.questionPush',
    proceed: 'server.consent.continuePush', proceedDescription: 'server.consent.continueDescriptionPush', stop: 'server.consent.stopPush', stopped: 'server.stopped.push',
    nextDestination: 'server.passed.nextDestinationPush', gitFinishing: 'server.passed.gitFinishingPush',
  },
  commit: {
    keptPass: 'server.keptPass.commit', cutShort: 'server.paused.cutShortCommit', gitStopped: 'server.paused.gitStoppedCommit', chooseConsent: 'server.http.chooseConsentCommit',
    passedEarlier: 'server.earlier.passedCommit', noQuestionsEarlier: 'server.earlier.noQuestionsCommit', notify: 'server.notify.continueCommit', question: 'server.consent.questionCommit',
    proceed: 'server.consent.continueCommit', proceedDescription: 'server.consent.continueDescriptionCommit', stop: 'server.consent.stopCommit', stopped: 'server.stopped.commit',
    nextDestination: 'server.passed.nextDestinationCommit', gitFinishing: 'server.passed.gitFinishingCommit',
  },
};
const operationKeys = event => OPERATION_KEYS[operation(event)];

/**
 * A quiet macOS notification that questions (or the Continue choice) are waiting.
 * It is sent however the page opened: a terminal or coding agent opens it in a
 * background tab, and a GUI Git client's push opens it in front, where this is
 * only a second cue. Never steals focus; text travels as arguments, never as
 * script. Skipped over SSH, in CI, and off macOS. Never throws.
 */
export function notifyDesktop({ title, message, env = process.env, platform = process.platform, spawnImpl = spawn } = {}) {
  if (platform !== 'darwin' || offLimits(env) || env.SSH_CONNECTION || env.SSH_TTY) return false;
  try {
    const child = spawnImpl('/usr/bin/osascript', ['-e', 'on run argv\n  display notification (item 2 of argv) with title (item 1 of argv)\nend run', String(title), String(message)], { env, stdio: 'ignore', detached: false });
    child.once?.('error', () => {});
    return true;
  } catch { return false; }
}

/** The page is the only cue a Git client without a terminal can give, so Windows opens it in front. macOS has an
 * explicit background-open flag and uses it, unless `front` says nobody watches a terminal or a coding agent.
 * Elsewhere print the local URL; do not guess at window-manager focus rules or invoke a foreground opener.
 * Resolves 'background', 'foreground', or false when the page was not opened. */
export async function openQuestionnaireBrowser(url, { env = process.env, platform = process.platform, spawnImpl = spawn, front = false } = {}) {
  if (offLimits(env) || env.SSH_CONNECTION || env.SSH_TTY || !['darwin', 'win32'].includes(platform)) return false;
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) throw new Error('Invalid local questionnaire URL.');
  if (platform === 'win32') {
    // Run from System32, not the repository: a browser this call starts would keep that folder locked. rundll32 is a
    // GUI program, so no windowsHide. Its exit code is always 0 and says nothing, so it is never waited for or killed.
    // It is not detached and is unref'd, so a rundll32 stuck on a dialog of its own cannot keep the hook running once
    // Sphinx has stopped: libuv's job object ends it with the hook, while a browser it already started lives on.
    const system32 = path.win32.join(envValue(env, 'SystemRoot', 'win32') ?? process.env.SystemRoot ?? 'C:\\Windows', 'System32');
    // Drop the command-search block Sphinx set for itself first: once the filter drops its SPHINX_ marker, it would look like the user's.
    const clean = Object.fromEntries(Object.entries(withoutAddedCwdBlock(env)).filter(([key]) => !/^(GIT_|SPHINX_)/i.test(key)));
    return new Promise(resolve => {
      let child;
      try { child = spawnImpl(path.win32.join(system32, 'rundll32.exe'), ['url.dll,FileProtocolHandler', url], { cwd: system32, env: clean, stdio: 'ignore' }); }
      catch { resolve(false); return; }
      child.once('spawn', () => resolve('foreground'));
      child.on('error', () => resolve(false)); // after 'spawn' the promise is settled, so a late error only has to be heard
      child.on('exit', () => {});
      child.unref?.();
    });
  }
  return new Promise(resolve => {
    let child, timer, settled = false;
    const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    try { child = spawnImpl('/usr/bin/open', front ? [url] : ['-g', url], { env, stdio: 'ignore' }); }
    catch { finish(false); return; }
    child.once('error', () => finish(false));
    child.once('exit', code => finish(code === 0 ? (front ? 'foreground' : 'background') : false));
    timer = setTimeout(() => { child.kill(); finish(false); }, 5000);
  });
}

/** Git is waiting on this hook, yet no person looks at a terminal and no known coding agent started it: a Git client
 * with a window of its own (Sourcetree, Fork, GitHub Desktop) or a script. `env` is the operation's environment and
 * `terminal` says whether Git's stderr is a terminal. */
export const unattendedGit = (request, { env, terminal }) => request?.delivery === 'hook' && !request.host && !SESSION_ENV.some(key => env[key]) && !terminal;

async function readBody(req, limit) {
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) throw new Error('Request too large.'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}

function publicFields(state) {
  if (!state) return {};
  return {
    id: state.id, target: state.target, event: state.event,
    route: state.route && { provider: state.route.provider, model: state.route.model, tier: state.route.tier },
    progress: state.progress, usage: state.usage, tokens: state.tokens,
    ...(state.question ? { question: { id: state.question.id, prompt: state.question.prompt, choices: state.question.choices || [] } } : {}),
    // A pass held from an earlier operation shows no question, so its last grade's feedback would read
    // out of context. A pass made on this page is held too, but its transcript already shows that feedback.
    // A stored state has no feedbackCode, and its feedback passes through as it is.
    ...(state.feedback && !state.held ? { feedback: fallbackText(state.feedbackCode, state.feedback) } : {}),
  };
}

/** One loopback page for a whole Git batch. The caller closes it after Git has
 * independently verified the receipt. All form inputs come from the browser,
 * never from tool arguments; no private evaluator data enters HTTP responses. */
export function createBrowserInterview({ env = process.env, signal, timeoutMs = 25 * 60 * 1000,
  store: providedStore, readConfig = loadConfig, revalidate = revalidateSnapshot,
  reserve = claimCheckpointDialog, release = finishCheckpointDialog, waitForExisting = waitForCheckpointTerminal,
  openBrowser = openQuestionnaireBrowser, notify = notifyDesktop, output = stderrLine, logOverride = recordOverride, findPlans = planProviders,
  loadView = loadChangeView, checkUpdate = updateStatus, planUpdate = updatePlan, startUpdate = scheduleUpdate, watchMs = 1000,
  terminal = !!process.stderr.isTTY, abandonMs = 180000,
} = {}) {
  const token = randomBytes(32).toString('base64url'), nonce = randomBytes(24).toString('base64');
  let server, origin, url, opened = false, closed = false, active, skip, resolver, sequence = 0, waitingGit = false;
  // Whether the automatic open put the page in front of the person rather than behind their window.
  let openedFront = false;
  // While set, the check stops once no page has been open for this many ms, and the page says so.
  let abandonAfterMs;
  // A pause stops the waiting Git operation, and this page's server with it, so
  // the only way back is to run it again. Say so, with the command when known.
  // Cut short at the consent step (only Git or the deadline can), the pass is already saved.
  let resumeCommand = null;
  const pauseMessage = () => {
    const keys = operationKeys(state.event);
    if (!waitingGit) return msg('server.paused.manual');
    return state.phase === 'consent' ? msg(keys.cutShort, { keptPass: msg(keys.keptPass) }) : msg(keys.gitStopped);
  };
  // The questionnaire language: what each check's settings say, until the page picks one, which then holds for
  // every check this server shows. activeConfig is the running check's settings, so a pick reaches its next model call.
  let language = 'en', languageChoice = null, activeConfig = null;
  // The state keeps Sphinx's own sentences as message refs. Every exit draws them in the current language; nothing
  // drawn is ever stored back.
  let state = { phase: 'waiting', operationClosed: false, revision: randomUUID(), sequence, message: msg('server.state.waiting'), messages: [] };
  const outbound = () => ({ ...localize(state, language), language });
  // The chat transcript for the current checkpoint lives only in this process.
  // It contains public questions, feedback, and the human's own text.
  let transcript = [], turns = 0, score = null;
  // The installed version and whether npm has a newer one. Display only.
  let update = null;
  // The repository's name, which in a worktree differs from its folder.
  let repoName = null;
  // The reviewer picker: offered choices, plus what the running check is doing,
  // because a switch means something different in each phase.
  let models = null, reviewAttempt = null, grading = false, switchModel = null, pendingDefault = null;
  // This check's understanding distance, and a change for the repository's next checks.
  // Distance is part of the check's policy, so it is written only when this check ends.
  let distance = null;
  const afterClose = [];
  // This server's edits to the global settings (the language, the default model) run one after another, so neither
  // drops a key the other wrote. A failed edit does not stop the next one; its caller still gets the error.
  let configWrites = Promise.resolve();
  const writeGlobal = change => {
    const run = configWrites.then(() => loadConfig(undefined, env)).then(saved => saveConfig(change(saved), env));
    configWrites = run.catch(() => {});
    return run;
  };
  // Whether to post the Sphinx stamp to the pull request, per checkpoint; read by the Git hook after a pass.
  let stamp = null; const stampChoices = new Map();
  // The repository's understanding score, refreshed after every graded answer.
  const refreshScore = async (repoRoot, operationEnv) => { score = scoreSummary(await readStats(repoRoot, operationEnv)); };
  // Read-only display of the checkpoint's frozen comparison. It is loaded
  // beside the questionnaire and can never block, grade, or approve it.
  let view, evidence, evidenceKey;
  const viewState = () => !view ? undefined : view.status === 'ready'
    ? { status: 'ready', header: view.model.header, totals: view.model.totals }
    : { status: view.status, ...(view.reason ? { reason: view.reason } : {}) };
  const say = item => { transcript = [...transcript, { id: `m${++turns}`, ...item }]; };
  const settle = status => { transcript = transcript.map(item => item.role === 'human' && item.status === 'checking' ? { ...item, status } : item); };
  const showQuestion = visible => {
    const question = visible?.question;
    const number = visible?.progress ? visible.progress.completed + 1 : null;
    // A question is new by its place as well as its ID: a follow-up's invented ID
    // can match a later question's, which must still be shown.
    if (!question || transcript.some(item => item.kind === 'question' && item.questionId === question.id && item.number === number)) return;
    say({ role: 'sphinx', kind: 'question', questionId: question.id, number, followUp: transcript.some(item => item.kind === 'question' && item.number === number), text: question.prompt, choices: question.choices || [] });
  };
  const streams = new Set();
  const writeEvent = (stream, event) => {
    if (stream.destroyed || stream.writableEnded) { streams.delete(stream); return; }
    try {
      // A disconnected or stalled page must not retain an ever-growing buffer
      // or interrupt the assessment. EventSource reconnects with current state.
      if (stream.writableLength > 256 * 1024) stream.destroy();
      else stream.write(event);
    } catch { stream.destroy(); streams.delete(stream); }
  };
  // Display-only updates (change view, evidence) keep the revision, so they
  // never turn an answer already in flight into a stale submission.
  const publish = (next, { display = false } = {}) => {
    state = { ...next, messages: transcript, ...(score ? { score } : {}), ...(update ? { update } : {}), ...(repoName ? { repoName } : {}), ...(models ? { models: { groups: models.groups, reviewing: !!reviewAttempt, busy: grading } } : {}), ...(distance ? { distance: { current: distance.current, next: distance.next, scope: distance.scope } } : {}), ...(stamp ? { stamp } : {}), change: viewState(), evidence: evidence && evidence.checkpoint === next.id ? { questionId: evidence.questionId, refs: evidence.refs } : undefined, waitingGit, abandonAfterMs, operationClosed: closed, revision: display ? next.revision : randomUUID(), sequence: ++sequence };
    const event = `data: ${JSON.stringify(outbound())}\n\n`;
    for (const stream of streams) writeEvent(stream, event);
  };
  // `watch` polls for work done outside this page; a truthy result ends the wait as { action: 'saved' }.
  const waitForAction = (next, allowed, watch) => new Promise((resolve, reject) => {
    active.signal.throwIfAborted();
    const polling = new AbortController();
    const onAbort = () => { polling.abort(); resolver = undefined; reject(active.signal.reason || cancelled()); };
    const cleanup = () => { polling.abort(); active?.signal.removeEventListener('abort', onAbort); };
    resolver = { allowed, resolve: value => { cleanup(); resolver = undefined; resolve(value); }, reject: error => { cleanup(); resolver = undefined; reject(error); } };
    active.signal.addEventListener('abort', onAbort, { once: true });
    publish(next);
    if (watch) (async () => {
      const current = resolver;
      while (!polling.signal.aborted) {
        await delay(watchMs, undefined, { signal: polling.signal });
        const saved = await watch().catch(() => null);
        if (saved && resolver === current) { current.resolve({ action: 'saved', visible: saved }); return; }
      }
    })().catch(() => {});
  });
  const headers = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  };
  // Every reply draws its message refs (errors, the state, an update note) in the language current as it is sent.
  // ponytail: diffs and change summaries (up to 3000 rows) are walked too, for nothing; skip them if a profile ever says so.
  const send = (res, status, value) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(localize(value, language)));
  };
  async function handle(req, res) {
    if (req.headers.host !== new URL(origin).host || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return send(res, 403, { error: msg('server.http.forbidden') });
    const route = req.url?.split('?')[0];
    const segments = route?.split('/') || [];
    if (!equal(segments[1], token) || segments.length > 3 || (segments[2] && !['state', 'events', 'action', 'change', 'diff'].includes(segments[2]))) return send(res, 404, { error: msg('server.http.notFound') });
    if (req.method === 'GET' && !segments[2]) {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' }); res.end(browserPage({ token, nonce, language })); return;
    }
    if (req.method === 'GET' && segments[2] === 'state') return send(res, 200, outbound());
    if (req.method === 'GET' && ['change', 'diff'].includes(segments[2])) {
      const query = new URL(req.url, origin).searchParams, current = view;
      if (!current || query.get('id') !== current.id || state.id !== current.id) return send(res, 409, { error: msg('server.http.changeStale') });
      if (current.status !== 'ready') return send(res, current.status === 'loading' ? 202 : 200, viewState());
      try { await current.check(); } catch { return send(res, 409, { error: msg('server.http.viewStale') }); }
      if (segments[2] === 'change') return send(res, 200, { status: 'ready', id: current.id, ...current.model.summary() });
      try { return send(res, 200, await current.model.diff(query.get('path') ?? '', { context: query.get('context') ?? '3' })); }
      catch (error) { return send(res, 404, { error: error.code === 'CHANGE_VIEW_UNAVAILABLE' ? (error.ref ?? error.message) : msg('server.http.diffUnavailable') }); }
    }
    if (req.method === 'GET' && segments[2] === 'events') {
      if (streams.size >= 8) return send(res, 429, { error: msg('server.http.tooManyPages') });
      res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
      streams.add(res); writeEvent(res, `data: ${JSON.stringify(outbound())}\n\n`);
      const heartbeat = setInterval(() => writeEvent(res, ': keep-alive\n\n'), 10000); heartbeat.unref();
      res.once('close', () => { clearInterval(heartbeat); streams.delete(res); }); return;
    }
    if (req.method !== 'POST' || segments[2] !== 'action') return send(res, 405, { error: msg('server.http.unsupportedMethod') });
    if (req.headers.origin !== origin || !equal(req.headers['x-sphinx-token'], token) || req.headers['content-type']?.split(';')[0] !== 'application/json') return send(res, 403, { error: msg('server.http.forbidden') });
    if (new URL(req.url, origin).searchParams.get('language') === '1') {
      const picked = await readBody(req, 256).then(text => JSON.parse(text)?.language).catch(() => undefined);
      // Checked after the body arrives, with no wait between here and the save below: a pick either joins the saves
      // close() waits for, or is refused.
      if (closed) return send(res, 409, { error: msg('server.language.closing') });
      if (!LANGUAGES.includes(picked)) return send(res, 400, { error: msg('server.language.invalid') });
      // Language is display, not policy: it changes at any step and keeps the revision. It applies before the save,
      // so frames sent meanwhile use it, and to the running check's next model call; a call already running keeps its own.
      languageChoice = language = picked;
      if (activeConfig) activeConfig.language = picked;
      const failure = await writeGlobal(saved => ({ ...saved, language: picked })).then(() => null, error => error);
      publish(state, { display: true });
      // A failed save keeps the choice for this operation and never touches the state's error, which may be a question's.
      return send(res, 200, { ...outbound(), ...(failure ? { languageError: t(language, 'server.language.saveFailed', { reason: failure.message }) } : {}) });
    }
    if (new URL(req.url, origin).searchParams.get('stamp') === '1') {
      let post; try { post = JSON.parse(await readBody(req, 256))?.post; } catch { return send(res, 400, { error: msg('server.http.invalidChoice') }); }
      if (!stamp || typeof post !== 'boolean') return send(res, 409, { error: msg('server.http.noStamp') });
      stamp = { ...stamp, post }; stampChoices.set(state.id, post);
      publish(state, { display: true });
      return send(res, 200, { stamp });
    }
    if (new URL(req.url, origin).searchParams.get('distance') === '1') {
      let picked; try { picked = JSON.parse(await readBody(req, 1024))?.distance; } catch { return send(res, 400, { error: msg('server.http.invalidDistance') }); }
      if (!distance) return send(res, 409, { error: msg('server.http.waitForStart') });
      if (!Object.hasOwn(DISTANCES, picked)) return send(res, 400, { error: msg('server.http.chooseDistance') });
      distance.next = picked === distance.current ? null : picked;
      publish(state, { display: true });
      return send(res, 200, { distance: { current: distance.current, next: distance.next } });
    }
    if (new URL(req.url, origin).searchParams.get('model') === '1') {
      let picked; try { picked = JSON.parse(await readBody(req, 4096)); } catch { return send(res, 400, { error: msg('server.http.invalidModelChoice') }); }
      if (!switchModel || !models) return send(res, 409, { error: msg('server.http.waitForStart') });
      try { return send(res, 200, await switchModel({ provider: picked?.provider, model: typeof picked?.model === 'string' ? picked.model.trim() : '', saveDefault: picked?.saveDefault === true })); }
      catch (error) { return send(res, error.status || 409, { error: error.ref ?? error.message }); }
    }
    if (new URL(req.url, origin).searchParams.get('update') === '1') {
      // Independent of the check: the install runs only after this process exits.
      if (!update?.available || update.status === 'scheduled') return send(res, 409, { error: msg('server.http.noUpdate') });
      const plan = await planUpdate().catch(() => null);
      const started = !!plan?.command && await startUpdate({ command: plan.command, env });
      update = { ...update, status: started ? 'scheduled' : 'failed' };
      publish(state, { display: true });
      return send(res, 200, { update });
    }
    let bytes = 0; const chunks = [];
    // 8,000 characters can occupy 24KB in UTF-8 or 48KB when JSON-escaped.
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 64 * 1024) { send(res, 413, { error: msg('server.http.tooLong') }); req.destroy(); return; } chunks.push(chunk); }
    let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { error: msg('server.http.invalidResponse') }); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['id', 'revision', 'action', 'response', 'questionId'].includes(key))
      || typeof data.action !== 'string' || (data.response !== undefined && (typeof data.response !== 'string' || data.response.length > 8000))) return send(res, 400, { error: msg('server.http.invalidResponse') });
    // Live progress changes the revision often; Pause, Skip, Continue, and Stop only need the checkpoint.
    if (!active || active.signal.aborted || data.id !== state.id || (!['pause', 'skip', 'proceed', 'stop'].includes(data.action) && data.revision !== state.revision)) return send(res, 409, { error: msg('server.http.checkpointChanged') });
    if (['proceed', 'stop'].includes(data.action) && resolver?.allowed.includes(data.action)) {
      const current = resolver;
      send(res, 200, outbound()); current.resolve(data); return;
    }
    const consenting = ['proceed', 'stop'].some(action => resolver?.allowed.includes(action));
    if (data.action === 'skip') {
      if (consenting) return send(res, 409, { error: msg(operationKeys(state.event).chooseConsent) });
      // Available at any step, including while the review is still running.
      skip = { reason: data.response };
      active.abort(cancelled());
      publish({ ...publicFields(state), phase: 'skipped', message: msg(waitingGit ? 'server.skipped.gitContinuing' : 'server.skipped.closeTab') });
      return send(res, 200, outbound());
    }
    if (data.action === 'pause') {
      if (consenting) return send(res, 409, { error: msg(operationKeys(state.event).chooseConsent) });
      active.abort(cancelled());
      publish({ ...publicFields(state), phase: 'paused', message: pauseMessage(), ...(resumeCommand ? { resume: resumeCommand } : {}) });
      return send(res, 200, outbound());
    }
    if (!resolver || !resolver.allowed.includes(data.action)) return send(res, 409, { error: msg('server.http.waitForStep') });
    if (['answer', 'learn', 'dispute'].includes(data.action) && data.questionId !== state.question?.id) return send(res, 409, { error: msg('server.http.questionChanged') });
    if (['answer', 'dispute'].includes(data.action) && !data.response?.trim()) return send(res, 400, { error: msg('server.http.responseRequired') });
    const current = resolver;
    if (data.action === 'answer') say({ role: 'human', kind: 'answer', text: data.response.trim(), status: 'checking' });
    // The person's own text fills the placeholder once, so braces in it stay as typed.
    else if (data.action === 'dispute') say({ role: 'human', kind: 'dispute', text: msg('server.transcript.dispute', { text: data.response.trim() }), status: 'checking' });
    else if (data.action === 'learn') say({ role: 'human', kind: 'learn', text: msg('server.transcript.learn'), status: 'checking' });
    publish({ ...publicFields(state), phase: 'working', message: msg(data.action === 'answer' ? 'server.working.checkingAnswer' : data.action === 'learn' ? 'server.working.preparingExplanation' : data.action === 'dispute' ? 'server.working.reviewingQuestion' : 'server.working.continuing') });
    send(res, 202, outbound()); current.resolve(data);
  }
  async function ensureServer(operationEnv, { front }) {
    if (server) return;
    server = createServer((req, res) => {
      res.on('error', () => res.destroy());
      handle(req, res).catch(() => { if (!res.headersSent) send(res, 400, { error: msg('server.http.processFailed') }); else res.destroy(); });
    });
    server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 32;
    // Port 0 asks the OS for a free ephemeral loopback port, so an occupied
    // port cannot collide. If binding still fails, forget the half-made server
    // so a later checkpoint retries instead of serving with no origin.
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
    catch (error) { server = undefined; throw error; }
    origin = `http://127.0.0.1:${server.address().port}`; url = `${origin}/${token}`;
    Promise.resolve().then(() => checkUpdate({ env: operationEnv })).then(result => { update = result; publish(state, { display: true }); }).catch(() => {});
    output(`Sphinx questionnaire: ${url}`);
    if (!opened) {
      opened = true;
      const how = await Promise.resolve().then(() => openBrowser(url, { env: operationEnv, front })).catch(() => false);
      openedFront = how === 'foreground';
      output(how === 'foreground' ? 'Sphinx: questionnaire opened in your browser.'
        : how === 'background' ? 'Sphinx: questionnaire opened in a background browser tab. Your coding window stays in place.'
        : 'Sphinx: open the local URL above. No application was brought to the foreground.');
    }
  }
  function startView(request, snapshot, config, operationEnv, store) {
    evidence = undefined; evidenceKey = undefined;
    const current = view = { id: request.id, status: 'loading', store, check: async () => {
      const latest = await readConfig(snapshot.repoRoot, operationEnv);
      if (policyHash(latest) !== policyHash(config) || !(await revalidate(snapshot, latest, { env: operationEnv }))) throw new Error('stale');
    } };
    Promise.resolve().then(() => loadView(snapshot, config, { env: operationEnv })).then(model => {
      if (view !== current) return;
      current.status = 'ready'; current.model = model; publish(state, { display: true }); refreshEvidence(request.id);
    }, error => {
      if (view !== current) return;
      current.status = 'unavailable';
      current.reason = error?.code === 'CHANGE_VIEW_UNAVAILABLE' ? (error.ref ?? error.message) : msg('server.change.loadFailed');
      publish(state, { display: true });
    });
  }
  function refreshEvidence(id) {
    const current = view;
    if (current?.status !== 'ready' || current.id !== id || !current.store) return;
    current.store.read(id).then(async session => {
      const question = session.questions?.[session.index];
      if (!question || session.status === 'passed') return;
      const key = `${id}:${question.id}`;
      if (evidenceKey === key) return;
      evidenceKey = key;
      const refs = await current.model.evidenceFor(question, session.review).catch(() => []);
      if (view !== current || evidenceKey !== key) return;
      evidence = { checkpoint: id, questionId: question.id, refs };
      publish(state, { display: true });
    }).catch(() => {});
  }
  async function present({ request, env: operationEnv = env, signal: requestSignal = signal } = {}) {
    if (offLimits(operationEnv)) return { status: 'unavailable', reason: 'noninteractive', id: request?.id };
    if (closed || active) return { status: 'unavailable', id: request?.id };
    if (!request || !ID.test(request.id) || typeof request.repoRoot !== 'string') throw new Error('Invalid browser checkpoint request.');
    const controller = new AbortController(); active = controller; skip = undefined; waitingGit = request.delivery === 'hook';
    repoName = await repositoryName(request.repoRoot).catch(() => null);
    transcript = [];
    const cancel = () => controller.abort(requestSignal?.reason || cancelled());
    requestSignal?.addEventListener('abort', cancel, { once: true });
    if (requestSignal?.aborted) cancel();
    const timer = setTimeout(() => controller.abort(cancelled()), timeoutMs);
    let reservation, finalStatus = 'pending', abandonWatch;
    const skipped = async () => {
      // A human chose to let Git continue. Close the check and log it; never write a receipt.
      await store.skip?.(request.id).catch(() => {});
      await logOverride({ kind: 'skip', repoRoot: request.repoRoot, target: state.target, id: request.id, reason: skip.reason }, operationEnv).catch(() => {});
      return { status: 'skipped', id: request.id };
    };
    const localSignal = controller.signal;
    const validate = async (snapshot, expected) => {
      localSignal.throwIfAborted();
      const current = await readConfig(snapshot.repoRoot, operationEnv);
      if (policyHash(current) !== policyHash(expected) || !(await revalidate(snapshot, current, { env: operationEnv }))) throw new Error('The code or settings changed. Start a new Git operation for the updated change.');
      localSignal.throwIfAborted();
    };
    const store = providedStore || createSessionStore({ env: operationEnv, validate });
    try {
      localSignal.throwIfAborted();
      for (;;) {
        reservation = await reserve({ request, env: operationEnv, kind: 'browser' });
        if (reservation?.status === 'claimed') break;
        const status = await waitForExisting({ id: request.id, env: operationEnv, timeoutMs, signal: localSignal });
        // Nobody kept that page open, so this one asks instead. The pause keeps a lock another
        // process still holds from turning this into a busy loop, as for the other lock waits.
        if (status === 'abandoned') { await delay(50, undefined, { signal: localSignal }); continue; }
        // Passed in another window while Git waits on this one: this page still asks before it goes through.
        if (status !== 'passed' || !waitingGit || request.more) return { status: status === 'passed' || status === 'stopped' ? status : 'pending', id: request.id };
        break;
      }
      // A copy: a language picked on the page is set on it, never on what readConfig handed out.
      const session = await store.read(request.id), config = { ...(await readConfig(request.repoRoot, operationEnv)) };
      if (languageChoice) config.language = languageChoice;
      language = config.language; activeConfig = config;
      if (session.snapshot.repoRoot !== request.repoRoot) throw new Error('This checkpoint belongs to another repository.');
      await validate(session.snapshot, config);
      startView(request, session.snapshot, config, operationEnv, store);
      await refreshScore(request.repoRoot, operationEnv).catch(() => {});
      let visible = store.public(session);
      publish({ ...publicFields(visible), repoRoot: request.repoRoot, phase: 'working', message: msg('server.working.preparing') });
      const unattended = unattendedGit(request, { env: operationEnv, terminal });
      await ensureServer(operationEnv, { front: unattended });
      // A Git client shows nothing while its hook waits, and a push it cancelled can leave the hook
      // waiting: once no page has stayed open for abandonMs, stop as the deadline does.
      if (unattended && openedFront) {
        const op = operation(session.snapshot.event), minutes = Math.max(1, Math.round(abandonMs / 60000));
        let lastSeen = Date.now();
        abandonAfterMs = abandonMs;
        // A page that connects before the next update already says the wait ends.
        publish(state, { display: true });
        abandonWatch = setInterval(() => {
          if (streams.size) lastSeen = Date.now();
          else if (Date.now() - lastSeen >= abandonMs && !controller.signal.aborted) {
            output(`Sphinx: no questionnaire page was open for ${minutes} minute${minutes === 1 ? '' : 's'}, so this ${op} stopped. Your progress is saved; ${op} again to reopen the questionnaire.`);
            finalStatus = 'abandoned'; controller.abort(cancelled());
          }
        }, watchMs);
        abandonWatch.unref();
      }
      const notes = [];
      const recoveryUI = { warning: text => notes.push(text), note: text => notes.push(text), command: () => {} };
      const plans = await findPlans(operationEnv).catch(() => []);
      // Whether this repository chose its distance, or it comes from your machine-wide setting.
      const repoSets = await repositoryConfigInfo(request.repoRoot).then(info => info.exists && readJson(info.path)).then(local => Object.hasOwn(local || {}, 'distance')).catch(() => false);
      distance = { current: session.config?.distance ?? config.distance, next: null, scope: repoSets ? 'repository' : 'machine' };
      const target = session.snapshot.target || {}, branch = name => String(name || '').replace(/^refs\/heads\//, '');
      const source = branch(session.snapshot.sourceRef), destination = branch(target.ref);
      resumeCommand = !waitingGit ? `sphinx check --id ${request.id}`
        : session.snapshot.event === 'pre-commit' ? 'git commit'
        : target.remote && destination ? `git push ${target.remote} ${source && source !== destination ? `${source}:${destination}` : destination}` : 'git push';
      stamp = null;
      if (await pullRequestPush(session.snapshot).catch(() => false)) {
        const action = await usesSphinxAction(request.repoRoot).catch(() => false);
        stamp = { post: stampChoices.get(request.id) ?? (action || !!config.github?.comment), action };
        stampChoices.set(request.id, stamp.post);
      }
      const refreshModels = async route => { models = { groups: await modelChoices({ config, env: operationEnv, plans, current: route }).catch(() => []) }; };
      await refreshModels(visible.route);
      const applySwitch = async ({ provider, model, saveDefault }) => {
        visible = await store.switchRoute(request.id, config, provider, { model, signal: localSignal });
        if (saveDefault) pendingDefault = { provider, model };
        await refreshModels(visible.route);
        const name = join([visible.route.provider === 'openai' ? msg('server.transcript.yourEndpoint') : PLAN_NAMES[provider]?.[0] ?? 'OpenRouter', model], ' ');
        say({ role: 'sphinx', kind: 'notice', text: msg(saveDefault ? 'server.transcript.switchedToDefault' : 'server.transcript.switchedTo', { name }) });
        return visible;
      };
      let pendingSwitch = null;
      // What a picked model does depends on the phase: grade with it from now on,
      // restart a running review on it, or retry a failed review with it.
      switchModel = async picked => {
        // Like every translatable error, an English message and a ref the page draws.
        const error = key => Object.assign(new Error(t('en', key)), { status: 409, ref: msg(key) });
        const problem = validChoice(models.groups, picked.provider, picked.model, config);
        if (problem) throw Object.assign(new Error(localize(problem, 'en')), { status: 400, ref: problem });
        const route = store.public(await store.read(request.id)).route;
        if (route.provider === picked.provider && route.model === picked.model) { if (picked.saveDefault) pendingDefault = picked; return { ok: true }; }
        if (grading) throw error('server.modelSwitch.afterGrading');
        if (reviewAttempt) { pendingSwitch = picked; reviewAttempt.abort(cancelled()); return { ok: true, restarting: true }; }
        if (resolver?.allowed.includes('answer')) { await applySwitch(picked); publish({ ...state, ...publicFields(visible), route: visible.route }); return { ok: true }; }
        if (state.phase === 'recovery' && resolver) { await applySwitch(picked); resolver.resolve({ action: 'switched' }); return { ok: true }; }
        throw error('server.modelSwitch.afterStep');
      };
      visible = await prepareInteractiveCheck({ config, signal: localSignal, waitingGit: request.delivery === 'hook', ui: recoveryUI,
        planProviders: plans, switchRoute: provider => store.switchRoute(request.id, config, provider, { signal: localSignal }),
        inspect: async () => store.public(await store.read(request.id)),
        validate: () => validate(session.snapshot, config),
        authorizeMore: () => store.retryReview(request.id, config, { signal: localSignal }),
        start: async () => {
          for (;;) {
            notes.length = 0;
            const attempt = new AbortController(), stop = () => attempt.abort(localSignal.reason);
            localSignal.addEventListener('abort', stop, { once: true });
            reviewAttempt = attempt;
            try {
              publish({ ...publicFields(store.public(await store.read(request.id))), repoRoot: request.repoRoot, phase: 'working', message: msg('server.working.reviewing') });
              // A pass made while Git waits is saved held: only the Git gate releases it, after Continue.
              return await store.start(request.id, config, { signal: attempt.signal, hold: waitingGit, onProgress: text => {
                say({ role: 'sphinx', kind: 'activity', text }); publish(state);
                // Refresh tokens and cost from the per-call save without blocking review.
                store.read(request.id).then(saved => { if (active === controller && state.id === request.id) { const fresh = store.public(saved); publish({ ...state, usage: fresh.usage, tokens: fresh.tokens }); } }, () => {});
              } });
            } catch (error) {
              // A model picked mid-review stops this run; anything else is a real failure.
              if (!pendingSwitch || localSignal.aborted) throw error;
            } finally { reviewAttempt = null; localSignal.removeEventListener('abort', stop); }
            const picked = pendingSwitch; pendingSwitch = null;
            // Background preparation may have finished the review (questions, or a decision
            // to ask none) while the switch waited for it; then no review restarts.
            const switched = await applySwitch(picked);
            if (!switched.progress.total && switched.preparation?.status !== 'ready') say({ role: 'sphinx', kind: 'activity', text: msg('server.transcript.restarting') });
          }
        },
        choose: async prompt => {
          const current = store.public(await store.read(request.id));
          // The description and notes may be refs or English diagnostics; join() draws them together on the way out.
          const action = await waitForAction({ ...publicFields(current), repoRoot: request.repoRoot, phase: 'recovery', message: prompt.title, error: join([prompt.description, ...notes].filter(Boolean), '\n'), choices: prompt.choices }, prompt.choices.map(choice => choice.value));
          return action.action;
        },
      });
      if (!visible) return skip ? skipped() : { status: 'pending', id: request.id };
      const where = [repoName || path.basename(request.repoRoot), String(session.snapshot.target?.ref || '').replace(/^refs\/heads\//, '')].filter(Boolean).join(' → ');
      let notified = false;
      while (visible.status !== 'passed') {
        localSignal.throwIfAborted();
        showQuestion(visible); refreshEvidence(request.id);
        // The page may be in a background tab; say once that questions are ready.
        // notifyDesktop prints its title with String(), so it is drawn now.
        if (!notified) { notified = true; notify({ title: t(language, 'server.notify.answersNeeded'), message: where, env: operationEnv }); }
        // Answers can also arrive from sphinx answer or a terminal check. Follow
        // the saved session so this page, and the Git operation waiting on it, keep up.
        const shown = visible;
        const draft = savedDraft(await store.read(request.id));
        const action = await waitForAction({ ...publicFields(visible), repoRoot: request.repoRoot, phase: 'question', ...(draft ? { draft } : {}), ...(visible.browserError ? { error: visible.browserError } : {}) }, ['answer', 'learn', 'dispute'], async () => {
          const saved = store.public(await store.read(request.id));
          return saved.status === 'passed' || saved.progress.completed !== shown.progress.completed || saved.question?.id !== shown.question?.id ? saved : null;
        });
        if (action.action === 'saved') {
          visible = action.visible;
          if (visible.feedback && visible.feedback !== shown.feedback) say({ role: 'sphinx', kind: 'feedback', text: fallbackText(visible.feedbackCode, visible.feedback) });
          await refreshScore(request.repoRoot, operationEnv).catch(() => {});
          continue;
        }
        try {
          await validate(session.snapshot, config);
          // Type the grader's feedback into the conversation as it streams.
          // Only the first streamed feedback is shown; the saved result replaces it.
          let draft, step, frozen = false, lastPublish = 0;
          const onText = raw => {
            if (frozen) return;
            const field = partialField(raw, 'feedback');
            if (!field?.text) return;
            if (!draft) { say({ role: 'sphinx', kind: 'feedback', streaming: !field.complete, text: field.text }); draft = transcript.at(-1).id; }
            else transcript = transcript.map(item => item.id === draft ? { ...item, text: field.text, ...(field.complete ? { streaming: false } : {}) } : item);
            if (field.complete) {
              frozen = true;
              // The model is still writing the rest of its reply; say what, so the page never looks stalled.
              const next = msg(action.action === 'learn' || ['incorrect', 'ambiguous'].includes(partialField(raw, 'verdict')?.text) ? 'server.transcript.newScenario' : 'server.transcript.finishing');
              say({ role: 'sphinx', kind: 'activity', text: next }); step = transcript.at(-1).id;
            }
            const now = Date.now();
            if (field.complete || now - lastPublish > 60) { lastPublish = now; publish(state); }
          };
          const dropDraft = () => { transcript = transcript.filter(item => item.id !== draft && item.id !== step); };
          grading = true; publish(state, { display: true });
          visible = await withTextStream(onText, () => store.answer(request.id, action.action === 'learn' ? 'I do not know. Explain this concept and give me a different scenario to apply it to.' : action.response.trim(), config, {
            learn: action.action === 'learn', dispute: action.action === 'dispute', expectedQuestionId: action.questionId, signal: localSignal, hold: waitingGit,
          })).finally(() => { dropDraft(); grading = false; });
          settle('graded');
          await refreshScore(request.repoRoot, operationEnv).catch(() => {});
          if (visible.feedback) say({ role: 'sphinx', kind: 'feedback', text: fallbackText(visible.feedbackCode, visible.feedback) });
          // Without a usable new question no new bubble appears, so say that the same one stays open.
          if (visible.status !== 'passed' && visible.question?.id === action.questionId) say({ role: 'sphinx', kind: 'notice', text: msg('server.transcript.sameQuestion') });
        } catch (error) {
          settle('not-graded');
          localSignal.throwIfAborted(); await validate(session.snapshot, config);
          visible = store.public(await store.read(request.id));
          // A rate-limited API route can hand grading to the user's coding-agent plan.
          if ((isRateLimit(error, visible.route) || isCliFailure(error, visible.route)) && switchChoices(plans, visible.route.provider).length) {
            const choices = [...switchChoices(plans, visible.route.provider), { value: 'back', label: msg('server.gradingRecovery.backLabel'), description: msg('server.gradingRecovery.backDescription') }];
            const picked = await waitForAction({ ...publicFields(visible), repoRoot: request.repoRoot, phase: 'recovery', message: isRateLimit(error, visible.route) ? msg('server.gradingRecovery.rateLimited') : msg('server.gradingRecovery.cliFailed', { name: PLAN_NAMES[visible.route.provider][0] }), error: error.ref ?? error.message, choices }, choices.map(choice => choice.value));
            if (picked.action.startsWith('switch-')) {
              const provider = picked.action.slice('switch-'.length);
              visible = await store.switchRoute(request.id, config, provider, { signal: localSignal });
              say({ role: 'sphinx', kind: 'notice', text: msg('server.transcript.switchedToResend', { name: PLAN_NAMES[provider][0] }) });
              continue;
            }
          }
          publish({ ...publicFields(visible), repoRoot: request.repoRoot, phase: 'question', error: error.ref ?? error.message, message: msg('server.question.notAccepted') });
          // Re-display through waitForAction on the next iteration; never resend.
          visible = { ...visible, browserError: error.ref ?? error.message };
        }
      }
      localSignal.throwIfAborted(); await validate(session.snapshot, config);
      const keys = operationKeys(session.snapshot.event);
      const result = visible.noQuestionReason ? msg('server.result.noQuestions', { reason: fallbackText(visible.noQuestionCode, visible.noQuestionReason) }) : msg('server.result.passed');
      // Held when this page opened, the pass was made for an earlier push or commit that did not
      // go through; nothing else is asked. (A pass made here is held too, until Git sees Continue.)
      const earlier = session.status === 'passed' && session.held && msg(visible.noQuestionReason ? keys.noQuestionsEarlier : keys.passedEarlier);
      // A push to several destinations asks once, after the last one passes.
      if (waitingGit && !request.more) {
        // A pass that needed no questions, or a held one, can arrive before anyone looked at the page.
        if (!notified) notify({ title: t(language, keys.notify), message: where, env: operationEnv });
        const consent = await waitForAction({ ...publicFields(visible), repoRoot: request.repoRoot, phase: 'consent', message: msg(keys.question, { lead: earlier || result }), choices: [
          { value: 'proceed', label: msg(keys.proceed), description: msg(keys.proceedDescription) },
          { value: 'stop', label: msg(keys.stop), description: msg('server.consent.stopDescription', { keptPass: msg(keys.keptPass) }) },
        ] }, ['proceed', 'stop']);
        if (consent.action === 'stop') {
          finalStatus = 'pending';
          publish({ ...publicFields(visible), repoRoot: request.repoRoot, phase: 'stopped', message: msg(keys.stopped, { keptPass: msg(keys.keptPass) }), ...(resumeCommand ? { resume: resumeCommand } : {}) });
          return { status: 'stopped', id: request.id };
        }
      }
      finalStatus = 'passed';
      const passed = msg(!waitingGit ? 'server.passed.closeTab' : request.more ? keys.nextDestination : keys.gitFinishing, { result });
      // The page shows what follows the line break as a note; a pass without questions has no answers to note.
      publish({ ...publicFields(visible), repoRoot: request.repoRoot, phase: 'passed', message: visible.noQuestionReason ? passed : join([passed, msg('server.result.recordsNote')], '\n') });
      return { status: 'passed', id: request.id };
    } catch (error) {
      settle('not-graded');
      if (skip) return skipped();
      // The waiting Git operation discarded this check because it no longer applies.
      if (localSignal.reason?.code === 'SPHINX_STALE') publish({ ...publicFields(state), repoRoot: request.repoRoot, phase: 'error', message: msg('server.error.noLongerApplies'), error: localSignal.reason.ref ?? localSignal.reason.message });
      else publish({ ...publicFields(state), repoRoot: request.repoRoot, phase: localSignal.aborted ? 'paused' : 'error', message: localSignal.aborted ? pauseMessage() : msg('server.error.couldNotFinish'), ...(localSignal.aborted ? (resumeCommand ? { resume: resumeCommand } : {}) : { error: error.ref ?? error.message }) });
      return { status: 'pending', id: request.id };
    } finally {
      clearInterval(abandonWatch); abandonAfterMs = undefined;
      clearTimeout(timer); requestSignal?.removeEventListener('abort', cancel); resolver?.reject(cancelled()); resolver = undefined;
      if (reservation?.status === 'claimed') await release({ id: request.id, token: reservation.token, status: finalStatus, env: operationEnv });
      // Write settings chosen for future checks on close(). Distance is part of a
      // check's policy, which the Git hook re-checks after this returns; the
      // default model is not, and is saved at the same time.
      if (pendingDefault) {
        const { provider, model } = pendingDefault; pendingDefault = null;
        afterClose.push(() => writeGlobal(saved => ({ ...saved, models: { small: { provider, model }, medium: { provider, model }, large: { provider, model } } })));
      }
      if (distance?.next) { const { next } = distance, root = request.repoRoot; afterClose.push(() => setRepositoryDistance(root, next, { env: operationEnv })); }
      // The language and a page's pick of it outlive the check; only the check's settings object does not.
      switchModel = null; models = null; distance = null; stamp = null; activeConfig = null;
      active = undefined;
    }
  }
  async function close() {
    closed = true; active?.abort(cancelled()); resolver?.reject(cancelled()); resolver = undefined;
    // A language choice still saving lands before the settings for future checks are written beside it.
    await configWrites;
    for (const write of afterClose.splice(0)) await write().catch(() => {});
    if (server) {
      // A passed checkpoint may be followed by another destination. Only this
      // explicit end-of-operation update tells the page to stop reconnecting.
      publish(state);
      // Flush the final SSE update before closing the per-operation listener.
      await delay(40);
      for (const stream of streams) stream.end(); streams.clear();
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
  }
  // stampChoice(id): the human's choice to post a checkpoint's stamp to its PR, or undefined when not offered.
  return { present, close, stampChoice: id => stampChoices.get(id), get url() { return url; }, get state() { return structuredClone(outbound()); } };
}
