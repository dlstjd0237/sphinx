import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { getPaths, DEFAULT_CONFIG } from '../src/config.js';
import { runNativeCheckpoint } from '../src/native-check.js';
import { registerPiIntegration, elicitPiForm, preparePiIntegration, removePiIntegration, piIntegrationStatus, PI_GUIDANCE } from '../src/pi-integration.js';
import { KO } from '../src/i18n-ko.js';

function host(options = {}) {
  const handlers = new Map(), notifications = [], selections = [], inputs = [];
  const pi = { on: (event, handler) => handlers.set(event, handler) };
  const ctx = {
    cwd: '/repository', hasUI: true, mode: 'tui',
    sessionManager: { getSessionId: () => 'pi-current-session' },
    ui: {
      select: async (...args) => { selections.push(args); return 'Answer'; },
      input: async (...args) => { inputs.push(args); return 'HUMAN_PRIVATE'; },
      notify: (...args) => { notifications.push(args); },
    },
  };
  registerPiIntegration(pi, { env: {}, ...options });
  const event = { toolName: 'bash', input: { command: 'git -C /repository push' }, content: [{ type: 'text', text: 'Git hook stopped the push.' }], structuredContent: { exitCode: 1 }, isError: true };
  return { handlers, ctx, event, notifications, selections, inputs, run: (eventOverride = event, ctxOverride = ctx) => handlers.get('tool_result')?.(eventOverride, ctxOverride) };
}

test('Pi dialog answers go straight to Sphinx; only fixed outcome text enters the shell result', async () => {
  let received;
  const form = { message: 'QUESTION_PRIVATE', requestedSchema: {} };
  const h = host({ home: '/sphinx/state', runCheckpoint: async request => {
    received = request;
    assert.deepEqual(await request.elicit(form), { action: 'accept', content: { action: 'answer', response: 'HUMAN_PRIVATE' } });
    return { status: 'passed', question: 'QUESTION_PRIVATE', answer: 'HUMAN_PRIVATE', feedback: 'FEEDBACK_PRIVATE', rubric: 'RUBRIC_PRIVATE' };
  } });
  const result = await h.run();
  assert.equal(received.cwd, '/repository');
  assert.equal(received.host, 'pi');
  assert.equal(received.hostSession, 'pi-current-session');
  assert.equal(received.hookEvent, 'tool_result');
  assert.equal(received.env.SPHINX_HOME, '/sphinx/state');
  assert.equal(received.supportsForm, true);
  assert.equal(h.selections[0][0], 'QUESTION_PRIVATE');
  assert.match(h.inputs[0][0], /QUESTION_PRIVATE/);
  assert.match(result.content.at(-1).text, /fallback checkpoint passed/);
  assert.match(result.content.at(-1).text, /does not resume an exited Git process/);
  assert.match(result.content.at(-1).text, /Before retrying, verify that the original Git operation has exited with a Sphinx blocking failure/);
  assert.match(result.content.at(-1).text, /Never duplicate a waiting operation or repeat a successful operation/);
  assert.deepEqual(result.structuredContent, h.event.structuredContent);
  assert.equal(result.isError, undefined, 'The hook never rewrites the original failed Git status');
  assert.doesNotMatch(JSON.stringify([result, h.notifications]), /QUESTION_PRIVATE|HUMAN_PRIVATE|FEEDBACK_PRIVATE|RUBRIC_PRIVATE/);
});

test('a passed Pi fallback preserves successful advisory tool output and warns against replay', async () => {
  const h = host({ runCheckpoint: async () => ({ status: 'passed' }) });
  const event = { ...h.event, content: [{ type: 'text', text: 'Git push succeeded in advisory mode.' }], structuredContent: { exitCode: 0 }, isError: false };
  const result = await h.run(event);
  assert.deepEqual(result.content[0], event.content[0]);
  assert.deepEqual(result.structuredContent, { exitCode: 0 });
  assert.equal(result.isError, undefined);
  assert.match(result.content.at(-1).text, /Never duplicate a waiting operation or repeat a successful operation/);
  assert.deepEqual(h.selections, []);
});

test('Pi adds waiting and timeout guidance without replacing prompt sections or starting an interview', () => {
  const h = host({ runCheckpoint: () => { assert.fail('Guidance must not start a checkpoint'); } });
  const event = { systemPromptOptions: { promptGuidelines: ['Keep existing guidance.'], sections: { custom: 'Unrelated section' } } };
  assert.equal(h.handlers.get('before_agent_start')(event), undefined);
  h.handlers.get('before_agent_start')(event);
  assert.deepEqual(event.systemPromptOptions.promptGuidelines, ['Keep existing guidance.', ...PI_GUIDANCE]);
  assert.deepEqual(event.systemPromptOptions.sections, { custom: 'Unrelated section' });
  assert.match(PI_GUIDANCE.join('\n'), /waits up to 25 minutes, but the host may cancel the shell sooner/);
  assert.match(PI_GUIDANCE.join('\n'), /supported yielding or background execution; do not terminate or duplicate/);
  assert.deepEqual(h.selections, []);
});

test('Pi reports an existing questionnaire without suggesting another interview', async () => {
  const h = host({ runCheckpoint: async () => ({ status: 'busy' }) });
  const result = await h.run();
  assert.match(result.content.at(-1).text, /questionnaire is already open.*Wait for the human/);
  assert.doesNotMatch(result.content.at(-1).text, /sphinx check|retry/);
  assert.deepEqual(h.selections, []);
});

test('no queued work is silent, non-shell tools are ignored, and unsupported UI never elicits', async () => {
  let calls = 0;
  const h = host({ runCheckpoint: async request => { calls++; assert.equal(request.supportsForm, false); return { status: 'not-required' }; } });
  assert.equal(await h.run({ ...h.event, toolName: 'read' }), undefined);
  assert.equal(calls, 0);
  assert.equal(await h.run(h.event, { ...h.ctx, hasUI: false, mode: 'print' }), undefined);
  assert.equal(calls, 1);
  assert.deepEqual(h.notifications, []);
  assert.deepEqual(h.selections, []);
  assert.equal(host({ env: { SPHINX_EVALUATOR: '1' } }).handlers.size, 0);
});

test('dialog pause, cancellation, learning, and disputes preserve their distinct controller actions', async () => {
  const h = host();
  const form = { message: 'What changes after a retry?', requestedSchema: {} };
  for (const [choice, expected] of [
    ['Pause', { action: 'accept', content: { action: 'pause' } }],
    ['Learn, then try a new scenario', { action: 'accept', content: { action: 'learn' } }],
    [undefined, { action: 'cancel' }],
    ['unrecognized', { action: 'cancel' }],
  ]) {
    h.ctx.ui.select = async () => choice;
    assert.deepEqual(await elicitPiForm(h.ctx, form), expected);
  }
  h.ctx.ui.select = async () => 'Dispute this question';
  assert.deepEqual(await elicitPiForm(h.ctx, form), { action: 'accept', content: { action: 'dispute', response: 'HUMAN_PRIVATE' } });
  h.ctx.ui.input = async () => undefined;
  assert.deepEqual(await elicitPiForm(h.ctx, form), { action: 'cancel' });
});

test('Pi shows Korean action labels and maps them back to actions', async () => {
  const h = host();
  const form = { message: '재시도 뒤에는 무엇이 바뀝니까?', requestedSchema: {}, language: 'ko' };
  const labels = [KO['form.pi.answer'], KO['form.pi.learn'], KO['form.pi.dispute'], KO['form.pi.pause']];
  for (const [label, expected] of [
    [labels[0], { action: 'accept', content: { action: 'answer', response: 'HUMAN_PRIVATE' } }],
    [labels[1], { action: 'accept', content: { action: 'learn' } }],
    [labels[2], { action: 'accept', content: { action: 'dispute', response: 'HUMAN_PRIVATE' } }],
    [labels[3], { action: 'accept', content: { action: 'pause' } }],
  ]) {
    h.ctx.ui.select = async (...args) => { h.selections.push(args); return label; };
    assert.deepEqual(await elicitPiForm(h.ctx, form), expected);
  }
  assert.equal(new Set(labels).size, 4);
  for (const label of labels) assert.match(label, /[가-힣]/u);
  assert.deepEqual(h.selections.map(([title, options]) => [title, options]), Array(4).fill([form.message, labels]));
  // The answer and dispute prompts and the length hint are Korean too.
  assert.deepEqual(h.inputs.map(([title, hint]) => [title, hint]), [
    [`${form.message}\n\n${KO['form.pi.answerPrompt']}`, KO['form.pi.inputHint']],
    [`${form.message}\n\n${KO['form.pi.disputePrompt']}`, KO['form.pi.inputHint']],
  ]);
});

test('a form without language keeps the English labels', async () => {
  for (const language of [undefined, 'en']) {
    const h = host();
    const form = { message: 'What changes after a retry?', requestedSchema: {}, ...(language ? { language } : {}) };
    assert.deepEqual(await elicitPiForm(h.ctx, form), { action: 'accept', content: { action: 'answer', response: 'HUMAN_PRIVATE' } });
    h.ctx.ui.select = async (...args) => { h.selections.push(args); return 'Dispute this question'; };
    assert.deepEqual(await elicitPiForm(h.ctx, form), { action: 'accept', content: { action: 'dispute', response: 'HUMAN_PRIVATE' } });
    assert.deepEqual(h.selections.map(([title, options]) => [title, options]),
      Array(2).fill([form.message, ['Answer', 'Learn, then try a new scenario', 'Dispute this question', 'Pause']]), String(language));
    assert.deepEqual(h.inputs.map(([title, hint]) => [title, hint]), [
      [`${form.message}\n\nYour prediction and short reason`, 'Up to 8,000 characters. Escape pauses the checkpoint.'],
      [`${form.message}\n\nWhy is this question ambiguous or incorrect?`, 'Up to 8,000 characters. Escape pauses the checkpoint.'],
    ], String(language));
  }
});

test('Pi serializes sibling shell checkpoints and aborts dialog work at session shutdown', async () => {
  let active = 0, maximum = 0, calls = 0;
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const h = host({ runCheckpoint: async request => {
    calls++; active++; maximum = Math.max(maximum, active);
    if (calls === 1) await ready;
    active--;
    assert.equal(request.signal.aborted, false);
    return { status: 'not-required' };
  } });
  const first = h.run(), second = h.run();
  await Promise.resolve();
  assert.equal(calls, 1);
  release(); await Promise.all([first, second]);
  assert.equal(maximum, 1); assert.equal(calls, 2);
  let dialogSignal;
  h.ctx.ui.select = async (_title, _options, { signal }) => {
    dialogSignal = signal;
    return new Promise(resolve => signal.addEventListener('abort', () => resolve(undefined), { once: true }));
  };
  const pending = host({ runCheckpoint: async request => { await request.elicit({ message: 'PRIVATE', requestedSchema: {} }); return { status: 'passed' }; } });
  pending.ctx.ui = h.ctx.ui;
  const running = pending.run();
  await Promise.resolve(); await Promise.resolve();
  pending.handlers.get('session_shutdown')();
  const result = await running;
  assert.equal(dialogSignal.aborted, true);
  assert.match(result.content.at(-1).text, /paused/);
  assert.deepEqual(pending.notifications, []);
});

test('native controller keeps wrong answers in Pi dialogs until a transfer question is understood', async () => {
  const id = 'a'.repeat(64), grading = [], questions = ['PRIVATE_INITIAL_QUESTION', 'PRIVATE_TRANSFER_QUESTION'];
  const snapshot = { repoRoot: '/repository', target: { ref: 'refs/heads/main' } };
  const question = index => ({ id: `q${index}`, concept: 'retry behavior', prompt: questions[index], choices: ['Yes', 'No'] });
  let index = 0, status = 'pending', claimed = false;
  const state = () => ({ status, progress: { completed: status === 'passed' ? 1 : 0, total: 1 }, usage: { calls: index + 1, limit: 10 }, question: question(Math.min(index, 1)), target: 'refs/heads/main', ...(index ? { feedback: 'PRIVATE_FEEDBACK' } : {}) });
  const store = {
    read: async () => ({ id, snapshot, questions: [question(Math.min(index, 1))], index: 0, status }),
    start: async () => state(),
    answer: async (_id, answer, _config, options) => {
      grading.push({ answer, question: options.expectedQuestionId });
      index++;
      if (index === 2) status = 'passed';
      return state();
    },
    public: state,
  };
  const h = host({ runCheckpoint: options => runNativeCheckpoint({ ...options, store,
    listRequests: async () => claimed ? [] : [{ id, repoRoot: '/repository' }],
    claimRequest: async () => { claimed = true; return true; },
    readConfig: async () => structuredClone(DEFAULT_CONFIG), revalidate: async () => true,
    reserveDialog: async () => ({ status: 'claimed', id, token: 'test-only' }), releaseDialog: async () => {},
  }) });
  const result = await h.run();
  assert.equal(grading.length, 2);
  assert.deepEqual(grading.map(item => item.question), ['q0', 'q1']);
  assert.equal(h.selections.length, 2);
  assert.match(h.selections[1][0], /PRIVATE_TRANSFER_QUESTION/);
  assert.match(h.selections[1][0], /PRIVATE_FEEDBACK/);
  assert.doesNotMatch(JSON.stringify([result, h.notifications]), /PRIVATE/);
  assert.match(result.content.at(-1).text, /passed/);
  assert.equal(await h.run(), undefined, 'A completed attempt does not reopen on the next shell command');
});

async function installation(t) {
  const home = await mkdtemp(path.join(tmpdir(), "sphinx-pi ' "));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { SPHINX_USER_HOME: home, SPHINX_HOME: path.join(home, 'sphinx') };
  const paths = getPaths(env), cliPath = path.join(home, "sphinx cli '.js");
  return { home, env, paths, cliPath, options: { env, cliPath } };
}

test('Pi extension installation is reversible and loads through the real Pi extension loader', async t => {
  const f = await installation(t);
  const plan = await preparePiIntegration(f.paths, f.options);
  await assert.rejects(readFile(plan.record.file), { code: 'ENOENT' });
  await plan.commit();
  const installed = await readFile(plan.record.file, 'utf8');
  assert.match(installed, /registerPiIntegration/);
  assert.equal((await piIntegrationStatus(f.paths, { ...f.options, record: plan.record })).healthy, true);
  const { discoverAndLoadExtensions } = await import('@earendil-works/pi-coding-agent');
  const loaded = await discoverAndLoadExtensions([], f.home, path.dirname(path.dirname(plan.record.file)));
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions.find(item => item.path === plan.record.file);
  assert.ok(extension);
  assert.ok(extension.handlers.has('tool_result'));
  const again = await preparePiIntegration(f.paths, { ...f.options, previous: plan.record });
  await again.commit();
  assert.equal(await readFile(plan.record.file, 'utf8'), installed);
  await again.rollback();
  assert.equal(await readFile(plan.record.file, 'utf8'), installed);
  assert.deepEqual(await removePiIntegration(f.paths, plan.record), []);
  assert.equal((await piIntegrationStatus(f.paths, { ...f.options, record: plan.record })).healthy, false);
  assert.deepEqual(await removePiIntegration(f.paths, plan.record), []);
});

test('Pi installation preserves unrelated extensions, user edits, and symlinks', async t => {
  const f = await installation(t), plan = await preparePiIntegration(f.paths, f.options);
  await mkdir(path.dirname(plan.record.file), { recursive: true });
  const other = path.join(path.dirname(plan.record.file), 'other.js');
  await writeFile(other, 'export default () => {};');
  await plan.commit();
  await writeFile(plan.record.file, 'USER_EDIT_PRIVATE');
  await assert.rejects(preparePiIntegration(f.paths, { ...f.options, previous: plan.record }), error => !error.message.includes('USER_EDIT_PRIVATE') && /Refusing/.test(error.message));
  assert.equal((await removePiIntegration(f.paths, plan.record)).length, 1);
  assert.equal(await readFile(plan.record.file, 'utf8'), 'USER_EDIT_PRIVATE');
  assert.equal(await readFile(other, 'utf8'), 'export default () => {};');
  await rm(plan.record.file); await symlink(other, plan.record.file);
  await assert.rejects(preparePiIntegration(f.paths, f.options), /symlink/);
  assert.equal((await removePiIntegration(f.paths, plan.record)).length, 1);
  assert.equal(await readFile(other, 'utf8'), 'export default () => {};');
});

test('Pi preflight detects concurrent changes and rollback never removes later edits', async t => {
  const f = await installation(t), plan = await preparePiIntegration(f.paths, f.options);
  await mkdir(path.dirname(plan.record.file), { recursive: true });
  await writeFile(plan.record.file, 'new independent extension');
  await assert.rejects(plan.commit(), /changed during installation/);
  await rm(plan.record.file);
  const clean = await preparePiIntegration(f.paths, f.options);
  await clean.commit(); await clean.rollback();
  await assert.rejects(readFile(clean.record.file), { code: 'ENOENT' });
  const edited = await preparePiIntegration(f.paths, f.options);
  await edited.commit(); await writeFile(edited.record.file, 'later edit'); await edited.rollback();
  assert.equal(await readFile(edited.record.file, 'utf8'), 'later edit');
});
