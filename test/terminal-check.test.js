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
import { join, localize, msg } from '../src/i18n.js';

const question = (id, prompt, extra = {}) => ({ id, prompt, choices: [], ...extra });
function harness({ answers, results, waitingGit = false, more = false, started, event = 'pre-push', width = 80, held = false, prompt = 'What happens on redelivery?\u001b[2J' }) {
  let output = '';
  const stream = new Writable({ write(chunk, _e, done) { output += chunk; done(); } });
  const q1 = question('q1', prompt, { evidence: [{ path: 'src/jobs/charge.js', reason: 'PRIVATE_REASON' }] });
  const session = { id: 'x', questions: [q1], ...(held ? { status: 'passed', held: { at: '2026-10-23T00:00:00.000Z' } } : {}), route: { provider: 'claude', model: 'sonnet' }, snapshot: { repoRoot: '/work/billing', event, target: { remote: 'origin', ref: 'refs/heads/main' }, stats: { files: 2, additions: 10, deletions: 1 } } };
  const sent = [], skips = [], prompts = [], starts = [];
  const store = {
    start: async (_id, _c, options) => { starts.push(options); return started ?? ({ status: 'active', question: q1, progress: { completed: 0, total: 1 } }); },
    read: async () => session, public: s => s,
    answer: async (_id, text, _c, options) => { sent.push({ text, ...options }); const result = results.shift(); if (result instanceof Error) throw result; return result; },
  };
  const ask = async prompt => { prompts.push(prompt); if (!answers.length) throw new Error(`Unexpected prompt: ${prompt}`); return answers.shift(); };
  const run = () => runTerminalCheck({ store, session, config: DEFAULT_CONFIG, ask, terminal: createTerminal({ stream, env: { NO_COLOR: '1' }, width }), stream, waitingGit, more, env: { SPHINX_HOME: '/nonexistent-sphinx-home' }, validate: async () => {}, choose: async () => 'pause', skip: async reason => skips.push(reason) });
  return { run, sent, skips, prompts, starts, output: () => output, q1 };
}

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
  assert.match(output, /That didn't go through: The grader's reply couldn't be used, so no explanation is shown\./);
  assert.match(output, /Your progress is kept/);
  const cancelled = Object.assign(new Error('cancelled'), { code: 'SPHINX_CANCELLED' });
  const stopping = { ...store, answer: async () => { throw cancelled; } };
  await assert.rejects(runTerminalCheck({ store: stopping, session: { id: 'x', questions: [failing.q1], route: {}, snapshot: { repoRoot: '/r', target: { ref: 'refs/heads/main' } } }, config: DEFAULT_CONFIG, ask: async () => 'An answer', terminal: createTerminal({ stream, env: { NO_COLOR: '1' }, width: 80 }), stream, env: { SPHINX_HOME: '/nonexistent' }, validate: async () => {}, choose: async () => 'pause' }), /cancelled/);
});

test('no screen output contains [object Object] or message references', async t => {
  // The spinner redraws on an interval; a mocked one draws the progress line when the review reports it.
  t.mock.timers.enable({ apis: ['setInterval'] });
  const squash = text => text.replace(/\s+/gu, ' ');
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
      join(['Reviewing', msg('common.progress.readingFile', { path: 'app.js' })], ' · '),
      join(["That didn't go through", msg('common.grading.unusableAnswer')], ': '),
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
    for (const width of [50, 80, 100]) {
      for (const label of [undefined, '이해도 점검']) {
        const lines = [];
        const terminal = { ...createTerminal({ stream: { write() {} }, env: { NO_COLOR: '1' }, width }), line: text => lines.push(text) };
        printHeader(terminal, { session, score: null, label });
        assert.equal(displayWidth(lines[1]), width, `${label ?? 'default label'} at ${width}: ${lines[1]}`);
        assert.ok(lines[1].endsWith(label ?? 'understanding check'), lines[1]);
      }
    }
  });

  // A frame wider than the terminal wraps, and the redraw's \r\x1b[2K clears only its last row, so each 90 ms redraw
  // would leave a stale row behind. Frames are collected with and without the seconds tail (it shows after 2 s).
  await t.test('the spinner cuts a wide label to the terminal width on a grapheme boundary', t => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const frames = (label, columns = 80) => {
      let out = '';
      const stream = { isTTY: true, columns, write(chunk) { out += chunk; } };
      const spinner = createSpinner(stream, createTerminal({ stream, env: { FORCE_COLOR: '1' } }).style);
      spinner.start(label);
      t.mock.timers.tick(2100);
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
