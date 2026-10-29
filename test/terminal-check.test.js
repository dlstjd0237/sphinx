import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { Writable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSpinner, printHeader, runTerminalCheck } from '../src/terminal-check.js';
import { createTerminal, displayWidth, stripAnsi } from '../src/terminal.js';
import { openVisibleTerminal, prefersTerminal, runGitTerminalCheck } from '../src/git-interview.js';
import { DEFAULT_CONFIG, policyHash, validateConfig, validateRepositoryConfig } from '../src/config.js';
import { createSessionStore } from '../src/sessions.js';
import { createPrompts } from '../src/prompts.js';
import { activityText } from '../src/reviewer.js';
import { MODEL_OUTPUT_ERRORS } from '../src/evaluator.js';
import { modelUsageRef } from '../src/usage.js';
import { VERSION } from '../src/version.js';
import { EN, join, localize, msg, t as tx } from '../src/i18n.js';
import { KO } from '../src/i18n-ko.js';

const question = (id, prompt, extra = {}) => ({ id, prompt, choices: [], ...extra });
function harness({ answers, results, waitingGit = false, more = false, started, event = 'pre-push', width = 80, held = false, prompt = 'What happens on redelivery?\u001b[2J', language = 'en', draft }) {
  let output = '';
  const stream = new Writable({ write(chunk, _e, done) { output += chunk; done(); } });
  const q1 = question('q1', prompt, { evidence: [{ path: 'src/jobs/charge.js', reason: 'PRIVATE_REASON' }] });
  const session = { id: 'x', index: 0, questions: [q1], ...(held ? { status: 'passed', held: { at: '2026-10-23T00:00:00.000Z' } } : {}), ...(draft ? { draft: { questionId: 'q1', ...draft } } : {}), route: { provider: 'claude', model: 'sonnet' }, snapshot: { repoRoot: '/work/billing', event, target: { remote: 'origin', ref: 'refs/heads/main' }, stats: { files: 2, additions: 10, deletions: 1 } } };
  const sent = [], skips = [], prompts = [], starts = [];
  const store = {
    start: async (_id, _c, options) => { starts.push(options); return started ?? ({ status: 'active', question: q1, progress: { completed: 0, total: 1 } }); },
    read: async () => session, public: s => s,
    answer: async (_id, text, _c, options) => { sent.push({ text, ...options }); const result = results.shift(); if (result instanceof Error) throw result; return result; },
  };
  const ask = async prompt => { prompts.push(prompt); if (!answers.length) throw new Error(`Unexpected prompt: ${prompt}`); return answers.shift(); };
  const run = () => runTerminalCheck({ store, session, config: { ...DEFAULT_CONFIG, language }, ask, terminal: createTerminal({ stream, env: { NO_COLOR: '1' }, width }), stream, waitingGit, more, env: { SPHINX_HOME: '/nonexistent-sphinx-home' }, validate: async () => {}, choose: async () => 'pause', skip: async reason => skips.push(reason) });
  return { run, sent, skips, prompts, starts, output: () => output, q1 };
}

// sphinx check after a review that failed, wired the way cli.js wires it: the real session store, and the recovery menu
// that createPrompts draws in the questionnaire language.
const failure = (message, code, extra = {}) => () => Object.assign(new Error(message), { code, ...extra });
const RECOVERY = {
  switched: { planProviders: ['claude'], answers: ['1', ''], error: failure('OpenRouter HTTP 429 (code: 429; error_type: rate_limit_exceeded).', 'OPENROUTER_PROVIDER_ERROR', { status: 429, errorType: 'rate_limit_exceeded' }) },
  extended: { maxModelCalls: 3, answers: ['1', ''], error: failure('The reviewer did not retain changed-code evidence.', 'INSUFFICIENT_EVIDENCE') },
  setup: { error: failure('API key was rejected.', 'OPENROUTER_PROVIDER_ERROR', { status: 401, errorType: 'authentication' }) },
};
async function recoveryRun(t, { language = 'en', width = 80, maxModelCalls = 10, planProviders = [], answers = [], error }) {
  const home = await mkdtemp(path.join(tmpdir(), 'sphinx-terminal-recovery-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { SPHINX_HOME: home, SPHINX_USER_HOME: home };
  const config = { ...structuredClone(DEFAULT_CONFIG), maxModelCalls, language };
  const snapshot = { id: 'b'.repeat(64), repoRoot: '/test/repo', event: 'pre-push', target: { ref: 'refs/heads/main' }, files: ['app.js'], stats: { additions: 5, deletions: 1, files: 1 } };
  const store = createSessionStore({ env, validate: async () => {}, generate: async (_s, _c, options) => { await options.beforeCall(); throw error(); } });
  await store.ensure(snapshot, config);
  let output = '';
  const stream = new Writable({ write(chunk, _e, done) { output += chunk; done(); } });
  const terminal = createTerminal({ stream, env: { NO_COLOR: '1' }, width });
  const prompts = [], queue = [...answers];
  const ask = async prompt => { prompts.push(prompt); return queue.length ? queue.shift() : ''; };
  const code = await runTerminalCheck({ store, session: await store.read(snapshot.id), config, ask, terminal, stream, planProviders, env, validate: async () => {}, choose: createPrompts({ ask, ui: terminal, language }).choose });
  return { code, output, prompts };
}
const squash = text => text.replace(/\s+/gu, ' ');
const overflowing = (output, width = 80) => output.split('\n').filter(line => displayWidth(line) > width);

test('the terminal check shows the change, asks, grades, and passes', async () => {
  const done = { status: 'passed', question: null, progress: { completed: 1, total: 1 }, verdict: 'correct', feedback: '' };
  const h = harness({ answers: ['/hint', '', 'It charges twice'], results: [done] });
  assert.equal(await h.run(), 0);
  const out = h.output();
  assert.match(out, /◆ sphinx v\d+\.\d+\.\d+/);
  assert.match(out, /billing → origin\/main  ·  2 files  \+10 −1  ·  Claude Code sonnet/);
  assert.match(out, /Question 1 of 1\n {2}┃ What happens on redelivery\?/);
  assert.doesNotMatch(out, /\u001b\[2J/, 'model text cannot drive the terminal');
  assert.match(out, /Look at\n {4}src\/jobs\/charge\.js/);
  assert.doesNotMatch(out, /PRIVATE_REASON/);
  assert.doesNotMatch(out, /\/skip/, 'skip is only offered while Git waits');
  assert.match(out, /✓ Understanding check complete\./);
  assert.match(out, /Approval saved for this exact change and destination\. A waiting push or commit\s+goes through once you choose Continue in its questionnaire\./);
  assert.deepEqual(h.sent.map(item => item.text), ['It charges twice']);
});

test('a wrong answer explains and asks a labelled follow-up; /quit saves progress', async () => {
  const followUp = { status: 'active', question: question('q2', 'Now the crash is after charge().'), progress: { completed: 0, total: 1 }, verdict: 'incorrect', feedback: 'The job saves nothing before charge().' };
  const h = harness({ answers: ['Charged once', '/quit'], results: [followUp] });
  assert.equal(await h.run(), 1);
  assert.match(h.output(), /✗ Not quite\n {2}│ The job saves nothing before charge\(\)\./);
  assert.match(h.output(), /Question 1 of 1 · follow-up/);
  assert.match(h.output(), /Progress saved/);
});

test('after a miss or an explanation without a new question, the same question is shown again below the explanation', async () => {
  const results = [];
  const h = harness({ answers: ['Charged once', '/learn', 'It charges twice'], results });
  const same = feedback => ({ status: 'active', question: h.q1, progress: { completed: 0, total: 1 }, verdict: 'incorrect', feedback });
  results.push(same('The job saves nothing before charge().'), same('Here is how it works.'), { status: 'passed', question: null, progress: { completed: 1, total: 1 }, verdict: 'correct', feedback: '' });
  assert.equal(await h.run(), 0);
  const out = h.output();
  assert.match(out, /✗ Not quite\n {2}│ The job saves nothing before charge\(\)\.\n\n {2}Question 1 of 1 · still open\n {2}┃ What happens on redelivery\?/);
  assert.match(out, /Preparing an explanation…\n\n {2}◇ Here's how it works\n {2}│ Here is how it works\.\n\n {2}Question 1 of 1 · still open\n/);
  assert.doesNotMatch(out, /new scenario|follow-up/, 'Nothing promises a new question that did not come');
});

test('/skip asks for a reason and lets a waiting Git operation through', async () => {
  const h = harness({ answers: ['/skip', 'prod hotfix'], results: [], waitingGit: true });
  assert.equal(await h.run(), 3);
  assert.deepEqual(h.skips, ['prod hotfix']);
  assert.match(h.output(), /Skipped\. Git is continuing\./);
  const back = harness({ answers: ['/skip', 'n', '/quit'], results: [], waitingGit: true });
  assert.equal(await back.run(), 1); assert.deepEqual(back.skips, []);
});

test('auto uses the terminal unless the browser can open in the background', () => {
  assert.equal(prefersTerminal({ interface: 'auto' }, { env: {}, platform: 'darwin' }), false);
  assert.equal(prefersTerminal({ interface: 'auto' }, { env: { SSH_CONNECTION: '1' }, platform: 'darwin' }), true);
  assert.equal(prefersTerminal({ interface: 'auto' }, { env: {}, platform: 'linux' }), true);
  assert.equal(prefersTerminal({ interface: 'terminal' }, { env: {}, platform: 'darwin' }), true);
  assert.equal(prefersTerminal({ interface: 'browser' }, { env: { SSH_TTY: '/dev/x' }, platform: 'linux' }), false);
});

test('after a waiting pass, continue lets Git through and stop keeps the receipt without continuing', async () => {
  const done = { status: 'passed', question: null, progress: { completed: 1, total: 1 }, verdict: 'correct', feedback: '' };
  const continued = harness({ answers: ['It charges twice', 'continue'], results: [done], waitingGit: true });
  assert.equal(await continued.run(), 0);
  assert.match(continued.output(), /Continue the push\?\n {2}continue: the push goes through\. stop: it does not go through\. Your pass is\n {2}saved, so the next push of this change asks only whether to continue\.\n/);
  assert.match(continued.output(), /Approval saved\. Git is continuing\./);
  const halted = harness({ answers: ['It charges twice', 'stop'], results: [{ ...done }], waitingGit: true });
  assert.equal(await halted.run(), 4);
  assert.match(halted.output(), /‖ Push stopped\. It did not go through; your pass is saved\./);
  const retried = harness({ answers: ['It charges twice', 'maybe', '', 'c'], results: [{ ...done }], waitingGit: true });
  assert.equal(await retried.run(), 0);
  assert.equal(retried.output().match(/Type continue or stop\./g).length, 2, 'there is no default choice');
});

test('a pass that needed no questions asks before a waiting Git operation continues, and nothing is asked when none waits', async () => {
  const none = { status: 'passed', noQuestionReason: 'Only renames a local variable.', progress: { completed: 0, total: 0 } };
  const continued = harness({ answers: ['yes'], results: [], waitingGit: true, started: none });
  assert.equal(await continued.run(), 0);
  assert.match(continued.output(), /✓ No questions needed: Only renames a local variable\.\n\n {2}Continue the push\?/);
  assert.deepEqual(continued.prompts, ['  › continue / stop: ']);
  const halted = harness({ answers: ['/stop'], results: [], waitingGit: true, started: none, event: 'pre-commit' });
  assert.equal(await halted.run(), 4, 'the /stop command also answers stop here');
  assert.match(halted.output(), /Continue the commit\?\n {2}continue: the commit goes through\./);
  assert.match(halted.output(), /Your pass is\s+saved, so the next commit of this change asks only whether to continue\./);
  assert.match(halted.output(), /‖ Commit stopped\. It did not go through; your pass is saved\./);
  const manual = harness({ answers: [], results: [], started: none });
  assert.equal(await manual.run(), 0);
  assert.deepEqual(manual.prompts, []);
});

test('while Git waits, /stop or /quit stops it and says it did not go through; a manual check keeps /quit as it was', async () => {
  const waiting = harness({ answers: ['/stop'], results: [], waitingGit: true });
  assert.equal(await waiting.run(), 1);
  assert.match(waiting.output(), /Enter to send · \/hint {2}\/learn {2}\/dispute <reason> {2}\/skip {2}\/stop\n/);
  assert.match(waiting.output(), /\n {2}‖ Push stopped\. It did not go through; your progress is saved\.\n {4}Run git push again to continue; Sphinx reopens at this question\.\n$/);
  const alias = harness({ answers: ['/quit'], results: [], waitingGit: true, event: 'pre-commit' });
  assert.equal(await alias.run(), 1);
  assert.match(alias.output(), /‖ Commit stopped\. It did not go through; your progress is saved\.\n {4}Run git commit again to continue; Sphinx reopens at this question\./);
  const manual = harness({ answers: ['/stop', '/quit'], results: [] });
  assert.equal(await manual.run(), 1);
  assert.match(manual.output(), /Enter to send · \/hint {2}\/learn {2}\/dispute <reason> {2}\/quit\n/);
  assert.match(manual.output(), /Use \/hint, \/learn, \/dispute <reason>, \/quit, or type your answer\./);
  assert.match(manual.output(), /Progress saved\. Run sphinx check when you are ready to continue\./);
});

test('with more destinations to check in the same push, a pass does not ask yet', async () => {
  const done = { status: 'passed', question: null, progress: { completed: 1, total: 1 }, verdict: 'correct', feedback: '' };
  const h = harness({ answers: ['It charges twice'], results: [done], waitingGit: true, more: true });
  assert.equal(await h.run(), 0);
  assert.deepEqual(h.prompts, ['  › '], 'no continue / stop prompt before the last destination');
  assert.match(h.output(), /Approval saved\. This push has another destination to check next\./);
});

test('while Git waits, command hints name /stop, and on a narrow terminal the marked lines wrap clear of their mark', async () => {
  const failing = harness({ answers: ['/pause', 'It charges twice', '/stop'], results: [new Error('Provider timed out.')], waitingGit: true });
  assert.equal(await failing.run(), 1);
  assert.match(failing.output(), /Use \/hint, \/learn, \/dispute <reason>, \/stop, or type your answer\./);
  assert.match(failing.output(), /That didn't go through: Provider timed out\.\n {2}Your progress is kept\. Try again, or \/stop to stop here\./);
  const none = { status: 'passed', noQuestionReason: 'Only renames a local variable.', progress: { completed: 0, total: 0 } };
  const narrow = harness({ answers: ['stop'], results: [], waitingGit: true, started: none, width: 40 });
  assert.equal(await narrow.run(), 4);
  assert.match(narrow.output(), /\n {2}✓ No questions needed: Only renames a\n {4}local variable\.\n/);
  assert.match(narrow.output(), /\n {2}‖ Push stopped\. It did not go through;\n {4}your pass is saved\.\n/);
  const stopped = harness({ answers: ['/stop'], results: [], waitingGit: true, width: 40 });
  assert.equal(await stopped.run(), 1);
  assert.match(stopped.output(), /\n {2}‖ Push stopped\. It did not go through;\n {4}your progress is saved\.\n {4}Run git push again to continue;\n {4}Sphinx reopens at this question\.\n$/);
});

test('a held pass asks only whether to continue, saying it passed earlier, with nothing to answer', async () => {
  const held = { status: 'passed', held: true, progress: { completed: 1, total: 1 } };
  const stopped = harness({ answers: ['stop'], results: [], waitingGit: true, started: held, held: true });
  assert.equal(await stopped.run(), 4, 'stop reaches Git as a stopped check, which holds the pass again');
  const out = stopped.output();
  assert.match(out, /Loading your earlier pass…\n\n {2}✓ You passed this change earlier, but that push did not go through\.\n\n {2}Continue the push\?\n {2}continue: the push goes through\. stop: it does not go through\. Your pass is\n {2}saved, so the next push of this change asks only whether to continue\.\n/);
  assert.match(out, /‖ Push stopped\. It did not go through; your pass is saved\./);
  assert.doesNotMatch(out, /Understanding check complete|Question 1|Open-book|Loading prepared questions/);
  assert.deepEqual(stopped.prompts, ['  › continue / stop: ']);
  assert.deepEqual(stopped.sent, [], 'nothing is graded');
  const continued = harness({ answers: ['continue'], results: [], waitingGit: true, started: held, held: true, event: 'pre-commit', width: 40 });
  assert.equal(await continued.run(), 0);
  assert.match(continued.output(), /\n {2}✓ You passed this change earlier, but\n {4}that commit did not go through\.\n\n {2}Continue the commit\?\n/);
  assert.match(continued.output(), /Approval saved\. Git is continuing\./);
  const earlier = harness({ answers: [], results: [], waitingGit: true, more: true, started: held, held: true });
  assert.equal(await earlier.run(), 0);
  assert.deepEqual(earlier.prompts, [], 'an earlier destination of the push does not ask yet');
  assert.match(earlier.output(), /✓ You passed this change earlier, but that push did not go through\.\n {2}Approval saved\. This push has another destination to check next\./);
  const none = harness({ answers: ['stop'], results: [], waitingGit: true, started: { ...held, noQuestionReason: 'Only renames a local variable.' }, held: true });
  assert.equal(await none.run(), 4);
  assert.match(none.output(), /✓ This change needed no questions earlier, but that push did not go through\.\n/, 'nobody was asked anything to pass');
});

test('while Git waits a pass is saved held as it is made, and only a pass held when the check opened is called earlier', async () => {
  const done = { status: 'passed', held: true, question: null, progress: { completed: 1, total: 1 }, verdict: 'correct', feedback: '' };
  const waiting = harness({ answers: ['It charges twice', 'continue'], results: [done], waitingGit: true });
  assert.equal(await waiting.run(), 0);
  assert.equal(waiting.starts[0].hold, true); assert.equal(waiting.sent[0].hold, true);
  assert.match(waiting.output(), /✓ Understanding check complete\./); assert.doesNotMatch(waiting.output(), /earlier/);
  const none = harness({ answers: ['stop'], results: [], waitingGit: true, started: { status: 'passed', held: true, noQuestionReason: 'Only renames a local variable.', progress: { completed: 0, total: 0 } } });
  assert.equal(await none.run(), 4);
  assert.match(none.output(), /✓ No questions needed: Only renames a local variable\./); assert.doesNotMatch(none.output(), /earlier/);
  // A check with no Git operation waiting saves a plain receipt, as before.
  const manual = harness({ answers: ['It charges twice'], results: [{ ...done, held: undefined }] });
  assert.equal(await manual.run(), 0);
  assert.equal(manual.starts[0].hold, false); assert.equal(manual.sent[0].hold, false);
});

test('Git asks inline on its own terminal, else opens a window', async () => {
  const fakeChild = code => { const child = new EventEmitter(); child.kill = () => {}; queueMicrotask(() => child.emit('exit', code)); return child; };
  for (const [code, status] of [[0, 'passed'], [3, 'skipped'], [4, 'stopped'], [1, 'pending']]) {
    let spawned;
    const result = await runGitTerminalCheck({ request: { id: 'abc' }, env: { A: '1' }, openTty: () => 99, spawnImpl: (...args) => { spawned = args; return fakeChild(code); }, openWindow: () => assert.fail('no window when a terminal is visible') });
    assert.equal(result.status, status);
    assert.deepEqual(spawned[1].slice(1), ['check', '--id', 'abc']);
    assert.deepEqual(spawned[2].stdio, [99, 99, 99]);
    assert.equal(spawned[2].env.SPHINX_WAITING_GIT, '1');
    assert.equal(spawned[2].env.SPHINX_MORE_CHECKS, undefined);
  }
  let more;
  await runGitTerminalCheck({ request: { id: 'abc', more: true }, env: {}, openTty: () => 99, spawnImpl: (...args) => { more = args[2].env; return fakeChild(0); } });
  assert.equal(more.SPHINX_MORE_CHECKS, '1', 'an earlier destination of the push does not ask to continue yet');
  const windowed = await runGitTerminalCheck({ request: { id: 'abc' }, openTty: () => null, openWindow: async () => ({ status: 'unavailable' }) });
  assert.equal(windowed.status, 'unavailable');
});

test('Windows never looks for /dev/tty, which would resolve to a file on the current drive', t => {
  const opened = [];
  t.mock.method(fs, 'openSync', (file, flags) => { opened.push([file, flags]); return 99; });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.equal(openVisibleTerminal({ isTTY: true }, 'win32'), null);
  assert.deepEqual(opened, []);
  assert.equal(openVisibleTerminal({ isTTY: false }, 'linux'), null, "a coding agent's shell has no visible terminal");
  assert.deepEqual(opened, []);
  assert.equal(openVisibleTerminal({ isTTY: true }, 'linux'), 99, 'elsewhere the terminal Git was run from is opened as before');
  assert.deepEqual(opened, [['/dev/tty', 'r+']]);
});

test('interface is a personal setting outside the policy hash', () => {
  assert.throws(() => validateConfig({ ...structuredClone(DEFAULT_CONFIG), interface: 'tui' }), /interface/);
  assert.throws(() => validateRepositoryConfig({ interface: 'terminal' }), /cannot set interface/);
  assert.equal(policyHash(DEFAULT_CONFIG), policyHash({ ...DEFAULT_CONFIG, interface: 'terminal' }));
});

test('a failed grade keeps the question open instead of ending the check; cancelling still ends it', async () => {
  // The first grade fails the way issue #14 reported.
  const failing = harness({ answers: [], results: [] });
  let calls = 0;
  const done = { status: 'passed', question: null, progress: { completed: 1, total: 1 }, verdict: 'correct', feedback: '' };
  const store = { start: async () => ({ status: 'active', question: failing.q1, progress: { completed: 0, total: 1 } }), read: async () => ({}), public: s => s,
    answer: async () => { calls++; if (calls === 1) throw new Error("The grader's reply couldn't be used, so no explanation is shown. Asking again makes another model call."); return done; } };
  let output = '';
  const { Writable } = await import('node:stream');
  const stream = new Writable({ write(chunk, _e, next) { output += chunk; next(); } });
  const answers = ['/learn', 'It charges twice'];
  const code = await runTerminalCheck({ store, session: { id: 'x', questions: [failing.q1], route: {}, snapshot: { repoRoot: '/r', target: { ref: 'refs/heads/main' } } }, config: DEFAULT_CONFIG, ask: async () => answers.shift(), terminal: createTerminal({ stream, env: { NO_COLOR: '1' }, width: 80 }), stream, env: { SPHINX_HOME: '/nonexistent' }, validate: async () => {}, choose: async () => 'pause' });
  assert.equal(code, 0, 'the check carried on and passed');
  // The warning is wider than the terminal, so it wraps under its own text.
  assert.match(output, /That didn't go through: The grader's reply couldn't be used, so no\n {4}explanation is shown\./);
  assert.match(output, /Your progress is kept/);
  const cancelled = Object.assign(new Error('cancelled'), { code: 'SPHINX_CANCELLED' });
  const stopping = { ...store, answer: async () => { throw cancelled; } };
  await assert.rejects(runTerminalCheck({ store: stopping, session: { id: 'x', questions: [failing.q1], route: {}, snapshot: { repoRoot: '/r', target: { ref: 'refs/heads/main' } } }, config: DEFAULT_CONFIG, ask: async () => 'An answer', terminal: createTerminal({ stream, env: { NO_COLOR: '1' }, width: 80 }), stream, env: { SPHINX_HOME: '/nonexistent' }, validate: async () => {}, choose: async () => 'pause' }), /cancelled/);
});

test('no screen output contains [object Object] or message references', async t => {
  // The spinner redraws on an interval; a mocked one draws the progress line when the review reports it.
  t.mock.timers.enable({ apis: ['setInterval'] });
  for (const language of ['en', 'ko']) {
    const home = await mkdtemp(path.join(tmpdir(), 'sphinx-terminal-refs-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    const env = { SPHINX_HOME: home, SPHINX_USER_HOME: home };
    const config = { ...structuredClone(DEFAULT_CONFIG), maxModelCalls: 10, language };
    const snapshot = { id: 'c'.repeat(64), repoRoot: '/test/repo', event: 'pre-push', target: { ref: 'refs/heads/main' }, files: ['app.js'], stats: { additions: 5, deletions: 1, files: 1 } };
    const q1 = question('q1', 'Can a retry duplicate the insert? Why?', { concept: 'idempotency', expectedAnswer: 'Yes.', rationale: 'No deduplication.', evidence: [{ path: 'app.js', reason: 'Unconditional insertion.' }] });
    let reviews = 0;
    const store = createSessionStore({ env, validate: async () => {},
      generate: async (_s, _c, options) => {
        await options.beforeCall();
        options.onProgress(activityText('read_file', { path: 'app.js' }));
        t.mock.timers.tick(90);
        if (++reviews === 1) throw Object.assign(new Error('The reviewer did not retain changed-code evidence.'), { code: 'INSUFFICIENT_EVIDENCE' });
        return { questions: [q1] };
      },
      // The grader's reply cannot be used: the sessions store explains that in its own words.
      grade: async request => { await request.beforeCall(); throw Object.assign(new Error('Malformed grade.'), { code: MODEL_OUTPUT_ERRORS[0] }); },
    });
    await store.ensure(snapshot, config);
    let output = '';
    const stream = new Writable({ write(chunk, _e, done) { output += chunk; done(); } });
    stream.isTTY = true;
    const terminal = createTerminal({ stream, env: { NO_COLOR: '1' }, width: 80 });
    const answers = ['1', 'It inserts again.', '/quit'];
    const ask = async () => answers.shift();
    // As sphinx check wires it: the recovery menu, the progress line, the usage line, and a grading failure.
    const code = await runTerminalCheck({ store, session: await store.read(snapshot.id), config, ask, terminal, stream, env, validate: async () => {}, choose: createPrompts({ ask, ui: terminal, language }).choose });
    assert.equal(code, 1);
    assert.doesNotMatch(output, /\[object Object\]|"\$t"|\$join/u, language);
    const usage = join([msg('common.usage.tokens', { n: '0' }), msg('common.usage.calls', { calls: 1, limit: 10 })], ' · ');
    const expected = [
      ...['common.recovery.reviewFailedTitle', 'common.recovery.chooseHow', 'common.recovery.retryWithin', 'common.recovery.pauseLabel', 'common.recovery.pauseDescription'].map(key => msg(key)),
      msg('common.recovery.callsRemain', { remaining: 9, reserve: 1 }), msg('common.recovery.usedSoFar', { usage }),
      msg('terminal.spinner.reviewingProgress', { activity: msg('common.progress.readingFile', { path: 'app.js' }) }),
      msg('terminal.error.notThrough', { message: msg('common.grading.unusableAnswer') }),
    ].map(ref => localize(ref, language));
    for (const text of expected) {
      assert.ok(squash(output).includes(squash(text)), `${language}: ${text}\n${output}`);
      if (language === 'ko') assert.match(text, /[가-힣]/u, text);
    }
  }
});

test('a saved ungraded answer is shown once and Enter sends it again without retyping', async () => {
  const q1 = question('q1', 'What happens on redelivery?');
  const session = { id: 'x', index: 0, status: 'active', questions: [q1], draft: { questionId: 'q1', kind: 'dispute', text: 'It assumes one worker.' }, route: {}, snapshot: { repoRoot: '/r', target: { ref: 'refs/heads/main' } } };
  const sent = [];
  const done = { status: 'passed', question: null, progress: { completed: 1, total: 1 }, verdict: 'ambiguous', feedback: '' };
  const store = { start: async () => ({ status: 'active', question: q1, progress: { completed: 0, total: 1 } }), read: async () => session, public: s => s,
    answer: async (_id, text, _c, options) => { sent.push({ text, dispute: options.dispute }); return done; } };
  let output = '';
  const stream = new Writable({ write(chunk, _e, next) { output += chunk; next(); } });
  const answers = [''];
  const code = await runTerminalCheck({ store, session, config: DEFAULT_CONFIG, ask: async () => answers.shift(), terminal: createTerminal({ stream, env: { NO_COLOR: '1' }, width: 80 }), stream, env: { SPHINX_HOME: '/nonexistent' }, validate: async () => {}, choose: async () => 'pause' });
  assert.equal(code, 0);
  assert.match(output, /Your last dispute was not graded and is saved: It assumes one worker\./);
  assert.deepEqual(sent, [{ text: 'It assumes one worker.', dispute: true }]);
});

// Widths below are measured with displayWidth, never .length: .length counts a Hangul syllable as one column, so a
// Korean line that overflows the terminal would still pass.
test('the header and spinner fit the width with wide text', async t => {
  await t.test('the header pads the gap before its label by display columns', () => {
    const session = { snapshot: { repoRoot: '/work/billing', target: { remote: 'origin', ref: 'refs/heads/main' }, stats: { files: 2, additions: 10, deletions: 1 } }, route: { provider: 'claude', model: 'sonnet' } };
    const header = (width, language, score = null) => {
      const lines = [];
      const terminal = { ...createTerminal({ stream: { write() {} }, env: { NO_COLOR: '1' }, width }), language, line: text => lines.push(text) };
      printHeader(terminal, { session, score });
      return lines;
    };
    for (const width of [50, 80, 100]) {
      for (const language of ['en', 'ko']) {
        const [, line] = header(width, language);
        assert.equal(displayWidth(line), width, `${language} at ${width}: ${line}`);
        assert.ok(line.endsWith(tx(language, 'terminal.header.title')), line);
      }
    }
    // '이해도 점검' is 11 columns in 6 UTF-16 units: at 80 the gap before it is 51 spaces, where English has 43.
    assert.equal(header(80, 'ko')[1], `  ◆ sphinx v${VERSION}${' '.repeat(80 - displayWidth(`  ◆ sphinx v${VERSION}`) - 11)}이해도 점검`);
    assert.equal(header(80, 'en')[1], `  ◆ sphinx v${VERSION}${' '.repeat(80 - displayWidth(`  ◆ sphinx v${VERSION}`) - 19)}understanding check`);
    // The change's facts and the score line are drawn in the questionnaire language too.
    const korean = header(80, 'ko', { calibrating: false, accuracy: 80, streak: 3, recent: [true, false, true] });
    assert.equal(korean[2], '  billing → origin/main  ·  파일 2개  +10 −1  ·  Claude Code sonnet');
    assert.equal(korean[3], '  내 이해도  ●●●  80% · 3회 연속');
    assert.equal(header(80, 'ko', { calibrating: true, answered: 2, needed: 3, recent: [true, false] })[3], '  내 이해도  ●●○○○  집계 중 · 답변 3개 더 필요');
    assert.equal(header(80, 'en', { calibrating: false, accuracy: 80, streak: 3, recent: [true, false, true] })[3], '  Your understanding  ●●●  80% · 3 in a row');
  });

  // A frame wider than the terminal wraps, and the redraw's \r\x1b[2K clears only its last row, so each 90 ms redraw
  // would leave a stale row behind. Frames are collected with and without the seconds tail (it shows after 2 s).
  await t.test('the spinner cuts a wide label to the terminal width on a grapheme boundary', t => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const frames = (label, columns = 80, language = 'en', ms = 2100) => {
      let out = '';
      const stream = { isTTY: true, columns, write(chunk) { out += chunk; } };
      const spinner = createSpinner(stream, createTerminal({ stream, env: { FORCE_COLOR: '1' } }).style, language);
      spinner.start(label);
      t.mock.timers.tick(ms);
      spinner.stop();
      return out.split('\r\x1b[2K').filter(Boolean).map(stripAnsi);
    };
    const longPath = 'src/components/dashboard/widgets/RevenueChart.test.tsx';
    const korean = frames(`Reviewing · ${localize(activityText('read_file', { path: longPath }), 'ko')}`);
    for (const frame of korean) assert.ok(displayWidth(frame) <= 80, `${displayWidth(frame)} columns: ${frame}`);
    assert.ok(korean.length > 2 && korean[0].endsWith('…') && korean.at(-1).endsWith('… · 2s'), JSON.stringify([korean[0], korean.at(-1)]));
    // The cut counts display columns: whole rockets, never half a surrogate pair.
    const rockets = frames('🚀'.repeat(60));
    for (const frame of rockets) assert.doesNotMatch(frame, /\p{Surrogate}/u);
    assert.deepEqual([rockets[0], rockets.at(-1)].map(displayWidth), [77, 78]);
    // A label that fits is shown whole; one wide syllable too many is cut before it, leaving the ellipsis in its room.
    assert.ok(frames('리뷰하는 중').every(frame => frame.includes('리뷰하는 중') && !frame.includes('…')));
    assert.ok(frames('가'.repeat(37))[0].endsWith('가'.repeat(37)));
    assert.ok(frames('가'.repeat(38))[0].endsWith(`${'가'.repeat(36)}…`));
    // The Korean tail ' · 12초' is 7 columns in 6 UTF-16 units. It leaves 67 columns of the 76, so a 68-column label is
    // cut to 33 syllables and the ellipsis, and the frame is 78 columns.
    const long = frames('가'.repeat(34), 80, 'ko', 12100).at(-1);
    assert.equal(long, `  ${long[2]} ${'가'.repeat(33)}… · 12초`);
    assert.equal(displayWidth(long), 78);
    const short = frames('가'.repeat(34), 80, 'ko', 2100).at(-1);
    assert.equal(short, `  ${short[2]} ${'가'.repeat(34)} · 2초`, 'the label fits beside the shorter tail');
    assert.equal(displayWidth(short), 78);
  });
});

test('Korean model text wraps within 80 columns across the terminal check', async () => {
  const prompt = '재시도가 같은 결제 요청을 두 번 보내면 어떤 일이 일어나는지, 그리고 왜 그렇게 되는지 코드의 어느 부분을 근거로 들어 설명해 주세요.';
  const followUp = { status: 'active', question: question('q2', '두 번째 호출이 첫 번째 호출보다 먼저 끝나는 경우에는 저장된 결제 기록이 어떻게 바뀌는지 같은 방식으로 설명해 주세요.'), progress: { completed: 0, total: 1 }, verdict: 'incorrect', feedback: '아직 부족합니다. 이 작업은 결제를 보내기 전에 아무것도 저장하지 않으므로 두 번째 호출도 같은 요청을 다시 보내게 됩니다. 멱등 키가 없다는 점을 짚어 보세요.' };
  const h = harness({ answers: ['한 번만 결제됩니다', '/quit'], results: [followUp], prompt });
  assert.equal(await h.run(), 1);
  const wide = h.output().split('\n').filter(line => displayWidth(line) > 80);
  assert.deepEqual(wide, [], 'no line is wider than the terminal');
  assert.match(h.output(), /┃ 재시도가/);
  assert.match(h.output(), /│ 아직 부족합니다\./);
});

test('a Korean terminal questionnaire shows Korean text within 80 columns', async t => {
  const prompt = '같은 메시지가 다시 전달되면 결제가 몇 번 일어나는지, 그리고 왜 그렇게 되는지 코드를 근거로 설명해 주세요.';
  const followUp = { status: 'active', question: question('q2', '두 번째 전달이 첫 번째 전달보다 먼저 끝나면 저장된 결제 기록은 어떻게 됩니까?'), progress: { completed: 0, total: 1 }, verdict: 'incorrect', feedback: '이 작업은 결제하기 전에 아무것도 저장하지 않으므로 두 번째 전달도 같은 결제 요청을 다시 보냅니다.' };
  const done = { status: 'passed', question: null, progress: { completed: 1, total: 1 }, verdict: 'correct', feedback: '' };
  const draft = { kind: 'answer', text: '한 번만 결제됩니다. 메시지를 다시 받아도 결제 함수는 저장된 기록을 먼저 확인하기 때문입니다.' };
  const h = harness({ language: 'ko', waitingGit: true, prompt, draft, answers: ['/hint', '/wat', '/dispute', '한 번만 결제됩니다', '두 번 결제됩니다', '계속'], results: [followUp, done] });
  assert.equal(await h.run(), 0);
  const out = h.output(), lines = out.split('\n');
  assert.deepEqual(overflowing(out), [], out);
  assert.doesNotMatch(out, /\[object Object\]|"\$t"|\$join/u);
  // The header ends at the terminal's edge with the Korean title, and the command help is Korean.
  assert.equal(displayWidth(lines[1]), 80, lines[1]);
  assert.ok(lines[1].endsWith(KO['terminal.header.title']), lines[1]);
  assert.ok(out.includes(`\n  ${KO['terminal.commands.lineWaiting']}\n`), out);
  for (const key of ['terminal.score.label', 'terminal.hint.lookAt', 'terminal.commands.unknownWaiting', 'terminal.commands.disputeNeedsReason', 'terminal.spinner.loadingPrepared', 'terminal.spinner.checking', 'terminal.verdict.incorrect', 'terminal.verdict.correct', 'terminal.done.complete', 'terminal.consent.continuePush', 'terminal.done.gitContinuing', 'terminal.draft.resend']) {
    assert.ok(out.includes(KO[key]), `${key}\n${out}`);
  }
  for (const key of ['terminal.intro.openBook', 'terminal.consent.explainPush']) assert.ok(squash(out).includes(KO[key]), `${key}\n${out}`);
  assert.ok(squash(out).includes(tx('ko', 'terminal.draft.savedAnswer', { text: draft.text })), out);
  assert.ok(out.includes(`  ${tx('ko', 'terminal.question.number', { number: 1, total: 1 })}\n`) && out.includes(`  ${tx('ko', 'terminal.question.numberFollowUp', { number: 1, total: 1 })}\n`), out);
  assert.equal(h.prompts.at(-1), `  › ${KO['terminal.consent.prompt']} `);
  // None of Sphinx's own English sentences is left.
  for (const [key, value] of Object.entries(EN)) {
    if (key.startsWith('terminal.') && typeof value === 'string' && !value.includes('{')) assert.ok(!out.includes(value), `${key}: ${value}`);
  }
  // The review recovery: its notes ran past 80 columns in Korean (81, 86 and 104) and now wrap within them.
  const runs = {};
  for (const [name, scenario] of Object.entries(RECOVERY)) {
    runs[name] = await recoveryRun(t, { ...scenario, language: 'ko' });
    assert.deepEqual(overflowing(runs[name].output), [], `${name}:\n${runs[name].output}`);
    assert.doesNotMatch(runs[name].output, /\[object Object\]|"\$t"|\$join/u);
  }
  assert.ok(squash(runs.switched.output).includes(localize(msg('common.recovery.switchedNote', { plan: 'Claude Code' }), 'ko')), runs.switched.output);
  assert.ok(squash(runs.extended.output).includes(localize(msg('common.recovery.authorizedNote', { calls: 3 }), 'ko')), runs.extended.output);
  assert.ok(squash(runs.setup.output).includes(KO['common.recovery.noRetry']), runs.setup.output);
});

test('계속 and 중단 answer the consent step', async () => {
  const done = { status: 'passed', question: null, progress: { completed: 1, total: 1 }, verdict: 'correct', feedback: '' };
  for (const language of ['en', 'ko']) {
    // ㅊ, ㅛ, ㄴ and ㅜ are c, y, s and n typed with the Korean IME on.
    for (const [answer, code] of [['계속', 0], ['중단', 4], ['continue', 0], ['stop', 4], ['ㅊ', 0], ['ㅛ', 0], ['ㄴ', 4], ['ㅜ', 4], ['계속.', 0], ['stop!', 4], ['중단.', 4]]) {
      const h = harness({ language, answers: ['It charges twice', answer], results: [{ ...done }], waitingGit: true });
      assert.equal(await h.run(), code, `${language}: ${answer}`);
      assert.deepEqual(h.prompts, ['  › ', `  › ${tx(language, 'terminal.consent.prompt')} `], 'accepted the first time');
      assert.ok(h.output().includes(tx(language, code ? 'terminal.consent.stoppedPush' : 'terminal.done.gitContinuing')), h.output());
    }
  }
});

test('the skip confirmation goes back on n, no, the Korean no-words, 중단 and ㅜ in both languages; another answer is the reason', async () => {
  for (const language of ['en', 'ko']) {
    for (const word of ['n', 'no', 'N', 'No', '아니요', '아니오', '아니', '중단', 'ㅜ', 'ㅜㅐ', '취소', '아뇨', '아닙니다', 'no.', '아니요.', '아닙니다!', '취소?']) {
      const h = harness({ language, answers: ['/skip', word, '/stop'], results: [], waitingGit: true });
      assert.equal(await h.run(), 1, `${language}: ${word} goes back to the question`);
      assert.deepEqual(h.skips, [], `${language}: ${word} does not skip`);
      assert.doesNotMatch(h.output(), /↷/u);
    }
    const skipped = harness({ language, answers: ['/skip', '급한 수정'], results: [], waitingGit: true });
    assert.equal(await skipped.run(), 3);
    assert.deepEqual(skipped.skips, ['급한 수정']);
  }
});

test('a Korean recovery menu shows Korean prompt text', async t => {
  const run = await recoveryRun(t, { ...RECOVERY.extended, language: 'ko', answers: ['9', ''] });
  assert.equal(run.code, 1);
  const prompt = `\n${tx('ko', 'terminal.choose.promptDefault', { number: 2 })} `;
  assert.deepEqual(run.prompts, [prompt, prompt]);
  assert.ok(run.output.includes(`2. ${tx('ko', 'terminal.choose.defaultLabel', { label: KO['common.recovery.pauseLabel'] })}`), run.output);
  assert.ok(squash(run.output).includes(`! ${tx('ko', 'terminal.choose.invalidDefault', { max: 2, label: KO['common.recovery.pauseLabel'] })}`), run.output);
  assert.doesNotMatch(run.output, /Choose|\(default\)|Enter a number/u);
  // A choice with no default asks and warns in Korean too.
  let text = '';
  const ui = createTerminal({ stream: { write: chunk => { text += chunk; } }, env: { NO_COLOR: '1' }, width: 80 });
  const asked = [], answers = ['', '3', '1'];
  const prompts = createPrompts({ ui, language: 'ko', ask: async value => { asked.push(value); return answers.shift(); } });
  assert.equal(await prompts.choose({ title: '모델', requireSelection: true, current: 'b', choices: [{ value: 'a', label: 'A', description: '첫째' }, { value: 'b', label: 'B', description: '둘째' }] }), 'a');
  assert.deepEqual(asked, Array(3).fill(`\n${KO['terminal.choose.prompt']} `));
  assert.equal(text.split(tx('ko', 'terminal.choose.invalid', { max: 2 })).length - 1, 2, text);
  assert.doesNotMatch(text, /기본값|default|Enter/u, 'nothing is chosen for you');
});

test('a Korean grading failure line is Korean', async () => {
  const failed = Object.assign(new Error("The grader's reply couldn't be used, so this wasn't graded."), { ref: msg('common.grading.unusableAnswer') });
  const h = harness({ language: 'ko', answers: ['한 번만 결제됩니다', '/quit'], results: [failed] });
  assert.equal(await h.run(), 1);
  const out = squash(h.output());
  assert.ok(out.includes(`! ${tx('ko', 'terminal.error.notThrough', { message: KO['common.grading.unusableAnswer'] })}`), h.output());
  assert.ok(out.includes(KO['terminal.error.keptManual']), h.output());
  assert.ok(out.includes(KO['terminal.quit.progressSaved']), h.output());
  assert.doesNotMatch(h.output(), /go through|couldn't be used|progress is kept/u);
  // An error without a ref shows its own message inside the Korean line.
  const plainError = harness({ language: 'ko', answers: ['한 번만 결제됩니다', '/quit'], results: [new Error('Provider timed out.')] });
  assert.equal(await plainError.run(), 1);
  assert.ok(squash(plainError.output()).includes(tx('ko', 'terminal.error.notThrough', { message: 'Provider timed out.' })), plainError.output());
});

test('built-in fallback texts print in the questionnaire language', async () => {
  const { printSession } = await import('../src/cli.js');
  // Feedback blocks lose their rule here, so a sentence wrapped across them reads whole.
  const unblock = text => squash(text.replace(/\n {2}│ /gu, ' '));
  for (const language of ['en', 'ko']) {
    const catalog = language === 'ko' ? KO : EN;
    // printVerdict: a flagged question and an empty grade keep their English text beside a code.
    const results = [];
    const h = harness({ language, answers: ['A', 'B', 'C'], results });
    const same = (verdict, feedback, feedbackCode) => ({ status: 'active', question: h.q1, progress: { completed: 0, total: 1 }, verdict, feedback, feedbackCode });
    results.push(same('incorrect', EN['common.fallback.flagged'], 'flagged'), same('ambiguous', EN['common.fallback.empty'], 'empty'), { status: 'passed', question: null, progress: { completed: 1, total: 1 }, verdict: 'correct', feedback: 'Model feedback stays as written.' });
    assert.equal(await h.run(), 0);
    for (const key of ['common.fallback.flagged', 'common.fallback.empty']) assert.ok(unblock(h.output()).includes(catalog[key]), `${language} ${key}\n${h.output()}`);
    assert.ok(unblock(h.output()).includes('Model feedback stays as written.'));
    if (language === 'ko') assert.doesNotMatch(h.output(), /does not match the code|no explanation this time/u);
    // A pass with no questions (terminal-check.js's no-questions line): the documentation code, and a reviewer's own reason.
    const documentation = harness({ language, answers: [], results: [], started: { status: 'passed', noQuestionReason: EN['common.fallback.documentation'], noQuestionCode: 'documentation', progress: { completed: 0, total: 0 } } });
    assert.equal(await documentation.run(), 0);
    assert.ok(documentation.output().includes(`✓ ${tx(language, 'terminal.verdict.noQuestionsNeeded', { reason: catalog['common.fallback.documentation'] })}\n`), documentation.output());
    const reviewer = harness({ language, answers: [], results: [], started: { status: 'passed', noQuestionReason: 'Only renames a local variable.', progress: { completed: 0, total: 0 } } });
    assert.equal(await reviewer.run(), 0);
    assert.ok(reviewer.output().includes(`✓ ${tx(language, 'terminal.verdict.noQuestionsNeeded', { reason: 'Only renames a local variable.' })}\n`), reviewer.output());
    // sphinx answer, explain and dispute: the fallback, the headings and the usage line, in the questionnaire language.
    let printed = '';
    const ui = createTerminal({ stream: { write: chunk => { printed += chunk; } }, env: { NO_COLOR: '1' }, width: 80 });
    const route = { tier: 'small', provider: 'openrouter', model: 'openrouter/free' }, usage = { calls: 2, limit: 20 }, tokens = { input: 1200, output: 34, cost: 0.0031 };
    printSession({ status: 'active', verdict: 'incorrect', feedback: EN['common.fallback.empty'], feedbackCode: 'empty', route, usage, tokens, progress: { completed: 0, total: 1 }, question: { prompt: 'Q?', choices: [] } }, ui, language);
    assert.ok(printed.startsWith(`\n${tx(language, 'terminal.session.feedbackIncorrect')}\n${catalog['common.fallback.empty']}\n`), printed);
    assert.ok(printed.includes(`\n${tx(language, 'terminal.session.tierSmall')} · openrouter:openrouter/free · ${localize(modelUsageRef(usage, tokens), language)}\n`), printed);
    assert.ok(printed.includes(`\n${tx(language, 'terminal.question.number', { number: 1, total: 1 })}\nQ?\n`), printed);
    assert.ok(squash(printed).includes(tx(language, 'terminal.session.answerHint')), printed);
    printed = '';
    printSession({ status: 'passed', verdict: 'ambiguous', feedback: EN['common.fallback.flagged'], feedbackCode: 'flagged', route, usage, tokens, progress: { completed: 1, total: 1 } }, ui, language);
    assert.ok(squash(printed).includes(`${tx(language, 'terminal.session.feedbackAmbiguous')} ${catalog['common.fallback.flagged']}`), printed);
    assert.ok(printed.includes(`✓ ${tx(language, 'terminal.done.complete')}\n`), printed);
    assert.ok(squash(printed).includes(tx(language, 'terminal.done.approvalSaved')), printed);
    if (language === 'ko') assert.match(printed, /[가-힣]/u);
  }
});

test('notes and warnings wrap under their own text at the terminal width, and a row that fits keeps every byte', async t => {
  // The authorized and no-retry notes were 94 and 109 columns at 80; they now break between words under the note's indent.
  const extended = await recoveryRun(t, RECOVERY.extended);
  assert.ok(extended.output.includes('\n  Authorized up to 3 additional model calls, including grading. Earlier usage\n  remains counted.\n'), extended.output);
  const setup = await recoveryRun(t, RECOVERY.setup);
  assert.ok(setup.output.includes('\n  Resolve the reported setup or evidence problem before resuming. Repeating this\n  attempt is not offered here.\n'), setup.output);
  // A warning's later rows start under its text, clear of the mark.
  const warned = await recoveryRun(t, { error: failure('Codex reported: the sign-in for this machine expired while the review was reading the diff of app.js.', 'PROVIDER_FAILED') });
  assert.ok(warned.output.includes('\n  ! Codex reported: the sign-in for this machine expired while the review was\n    reading the diff of app.js.\n'), warned.output);
  for (const run of [extended, setup, warned]) assert.deepEqual(overflowing(run.output), [], run.output);
  // The saved-answer note keeps its line break: a long first row wraps under the note's indent; the second is as it was.
  const long = harness({ answers: ['/quit'], results: [], draft: { kind: 'answer', text: 'It charges twice, because the job saves nothing before charge() and the queue redelivers the message.' } });
  assert.equal(await long.run(), 1);
  assert.ok(long.output().includes('\n  Your last answer was not graded and is saved: It charges twice, because the\n  job saves nothing before charge() and the queue redelivers the message.\nPress Enter to send it again, or type a new response.\n'), long.output());
  const short = harness({ answers: ['/quit'], results: [], draft: { kind: 'dispute', text: 'It  assumes one worker.' } });
  assert.equal(await short.run(), 1);
  assert.ok(short.output().includes('\n  Your last dispute was not graded and is saved: It  assumes one worker.\nPress Enter to send it again, or type a new response.\n'), short.output());
});

test('a wrapped note or warning breaks only between words: a long word stays whole, and a row keeps its indentation and spacing', async t => {
  // A path or URL longer than the row is never cut: it stays whole on a row of its own, as before notes wrapped.
  const path = `/Users/someone/Library/Caches/codex/2026-10-28/${'0123456789abcdef'.repeat(5)}.json`;
  const long = await recoveryRun(t, { error: failure(`Codex could not read ${path}`, 'PROVIDER_FAILED') });
  assert.ok(long.output.includes(`\n  ! Codex could not read\n    ${path}\n`), long.output);
  const url = `https://openrouter.ai/api/v1/chat/completions/requests/${'0123456789abcdef'.repeat(3)}`;
  const graded = harness({ answers: ['It charges twice', '/quit'], results: [new Error(`Request to ${url} failed.`)] });
  assert.equal(await graded.run(), 1);
  assert.ok(graded.output().includes(`\n  ! That didn't go through: Request to\n    ${url}\n    failed.\n`), graded.output());
  // A later row keeps its own indentation, on each of its pieces.
  const detail = '    at /Users/someone/Library/Application Support/Codex/sessions/2026/10/28/rollout-2026-10-28T03-12-55.jsonl line 42';
  const indented = await recoveryRun(t, { error: failure(`Codex reported: the review stopped.\n${detail}`, 'PROVIDER_FAILED') });
  assert.ok(indented.output.includes('\n  ! Codex reported: the review stopped.\n    at /Users/someone/Library/Application\n    Support/Codex/sessions/2026/10/28/rollout-2026-10-28T03-12-55.jsonl line 42\n'), indented.output);
  // Spaces inside a wrapped row stay as they were typed; only the spaces where it breaks give way to the line break.
  const spaced = harness({ answers: ['/quit'], results: [], draft: { kind: 'answer', text: 'It charges twice:  the job saves nothing before charge(),  and the queue redelivers the message.' } });
  assert.equal(await spaced.run(), 1);
  assert.ok(spaced.output().includes('\n  Your last answer was not graded and is saved: It charges twice:  the job saves\n  nothing before charge(),  and the queue redelivers the message.\nPress Enter to send it again, or type a new response.\n'), spaced.output());
});
