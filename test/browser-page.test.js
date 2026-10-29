import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { browserPage, esc } from '../src/browser-page.js';
import { EN, pageCatalog, t } from '../src/i18n.js';
import { KO } from '../src/i18n-ko.js';

function page(fetchImpl = () => assert.fail('No request expected'), { narrow = false, language = 'en' } = {}) {
  const element = tag => ({ tag, textContent: '', hidden: false, value: '', disabled: false, children: [], style: {}, className: '', title: '', dataset: {}, attributes: {},
    scrollHeight: 0, scrollTop: 0, clientHeight: 0, placeholder: '', querySelectorAll() { return []; },
    setAttribute(name, value) { this.attributes[name] = String(value); }, getAttribute(name) { return this.attributes[name] ?? null; },
    classList: { values: new Set(), toggle(name, on) { if (on) this.values.add(name); else this.values.delete(name); }, contains(name) { return this.values.has(name); } },
    replaceChildren(...items) { this.children = [...items]; }, append(...items) { this.children.push(...items); }, focus() {},
    set innerHTML(_value) { assert.fail('Untrusted strings must not enter HTML'); },
  });
  const nodes = Object.fromEntries(['meta', 'usage', 'conversation', 'messages', 'composer', 'submit', 'status', 'message', 'feedback', 'error', 'question', 'prompt', 'choices', 'form', 'response', 'recovery', 'pause', 'waiting', 'skip', 'skipbar', 'skipreason', 'skipconfirm', 'skipcancel', 'label', 'dispute'].map(id => [id, element()]));
  const html = browserPage({ token: 'fixture-token', nonce: 'fixture-nonce', language });
  // The elements whose words the page fills from data-t* attributes, built from the markup. One with an id is the node the page looks up.
  const translatable = [...html.split('<script')[0].matchAll(/<(\w+)([^>]*\sdata-t[-=][^>]*)>/gu)].map(([, tag, attrs]) => {
    const id = attrs.match(/\sid="([^"]+)"/u)?.[1], item = id ? (nodes[id] ??= element(tag)) : element(tag);
    for (const [, name, key] of attrs.matchAll(/\sdata-(t(?:-\w+)?)="([^"]*)"/gu)) {
      item.attributes[`data-${name}`] = key;
      item.dataset[name.replace(/-(\w)/gu, (_, letter) => letter.toUpperCase())] = key;
    }
    return item;
  });
  const buttons = [nodes.pause, element(), { ...element(), dataset: { action: 'learn' } }, { ...element(), dataset: { action: 'dispute' } }];
  // A [data-t…] selector, or a comma list of them, finds only the translatable elements; every other selector keeps its old answer.
  const querySelectorAll = selector => selector.includes('[data-t')
    ? translatable.filter(item => selector.split(',').some(part => Object.hasOwn(item.attributes, part.trim().slice(1, -1))))
    : selector === '[data-action]' ? buttons.slice(2) : buttons;
  let events;
  const context = vm.createContext({ document: { visibilityState: 'visible', documentElement: { lang: language }, getElementById: id => nodes[id] ??= element('div'), createElement: element, querySelectorAll }, fetch: fetchImpl,
    EventSource: class { constructor() { events = this; this.closed = false; } close() { this.closed = true; } }, matchMedia: () => ({ matches: narrow }),
  });
  vm.runInContext(html.match(/<script[^>]*>([\s\S]*?)<\/script>/u)[1], context);
  const update = state => events.onmessage({ data: JSON.stringify(state) });
  return { nodes, buttons, translatable, context, update, get events() { return events; } };
}
const question = { id: 'a'.repeat(64), sequence: 1, revision: 'r1', phase: 'question', waitingGit: true, target: 'refs/heads/main', repoRoot: '/fixture', question: { id: 'q1', prompt: '<img src=x onerror=steal()>', choices: ['<script>attack()</script>'] }, progress: { completed: 0, total: 1 }, usage: { calls: 1, limit: 20 } };

test('browser renders source-controlled question text as literal text and does not auto-submit', () => {
  const p = page(); p.update(question);
  assert.equal(p.nodes.prompt.textContent, question.question.prompt);
  assert.equal(p.nodes.choices.children[0].textContent, question.question.choices[0]);
  assert.equal(p.nodes.status.textContent, 'Question 1 of 1');
  assert.equal(p.nodes.response.value, '');
});

test('late POST working response cannot overwrite a newer passed SSE update', async () => {
  let respond;
  const p = page(() => new Promise(resolve => { respond = resolve; }));
  p.update(question); p.nodes.response.value = 'My direct answer.';
  const submitted = p.context.send('answer');
  p.update({ ...question, sequence: 3, phase: 'passed', message: 'Complete.' });
  respond({ ok: true, json: async () => ({ ...question, sequence: 2, phase: 'working' }) });
  await submitted;
  assert.equal(p.nodes.status.textContent, 'Passed');
  assert.equal(p.nodes.question.hidden, true);
});

test('transient SSE disconnect disables actions without replay and reconnect restores the current question', () => {
  const p = page(); p.update(question); p.nodes.response.value = 'Unsent text';
  p.events.onerror();
  assert.equal(p.events.closed, false);
  assert.ok(p.buttons.every(button => button.disabled));
  assert.match(p.nodes.error.textContent, /Reconnecting/);
  p.update(question);
  assert.equal(p.nodes.response.value, 'Unsent text');
  assert.ok(p.buttons.every(button => !button.disabled));
  assert.equal(p.nodes.error.hidden, true);
});

test('completing one checkpoint keeps the event connection available for the next checkpoint in the batch', () => {
  const p = page(); p.update(question);
  p.update({ ...question, sequence: 2, phase: 'passed' });
  assert.equal(p.events.closed, false);
  p.events.onerror();
  assert.equal(p.events.closed, false, 'An intermediate pass must reconnect after a transient stream failure');
  assert.ok(p.buttons.every(button => button.disabled));
  p.update({ ...question, id: 'b'.repeat(64), sequence: 3 });
  assert.equal(p.nodes.status.textContent, 'Question 1 of 1');
  assert.equal(p.nodes.question.hidden, false);
  assert.ok(p.buttons.every(button => !button.disabled));
});

test('the page stops reconnecting only after an explicit operation-close update', () => {
  const p = page(); p.update(question);
  p.update({ ...question, sequence: 2, phase: 'passed', operationClosed: true });
  assert.equal(p.events.closed, true);
  assert.ok(p.buttons.every(button => button.disabled));
  p.events.onerror();
  assert.equal(p.nodes.error.hidden, true);
  assert.equal(p.nodes.status.textContent, 'Passed');
});

test('Enter submits an answer while Shift+Enter and IME composition do not', async () => {
  const bodies = [];
  const p = page(async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ...question, sequence: 2, phase: 'working' }) }; });
  p.update(question); p.nodes.response.value = 'Only the shared button changes.';
  const key = extra => { let prevented = false; p.nodes.response.onkeydown({ key: 'Enter', shiftKey: false, isComposing: false, repeat: false, preventDefault() { prevented = true; }, ...extra }); return prevented; };
  assert.equal(key({ shiftKey: true }), false);
  assert.equal(key({ isComposing: true }), false);
  assert.equal(bodies.length, 0);
  assert.equal(key(), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(bodies.map(body => [body.action, body.response]), [['answer', 'Only the shared button changes.']]);
});

test('the transcript renders questions, answers, feedback, and live activity as text', () => {
  const p = page();
  const messages = [
    { id: 'm1', role: 'sphinx', kind: 'activity', text: 'Reading src/app.js' },
    { id: 'm2', role: 'sphinx', kind: 'question', questionId: 'q1', number: 1, text: question.question.prompt, choices: [] },
    { id: 'm3', role: 'human', kind: 'answer', text: '<b>mine</b>', status: 'graded' },
    { id: 'm4', role: 'sphinx', kind: 'feedback', text: 'Close, but…' },
    { id: 'm5', role: 'sphinx', kind: 'activity', text: 'Drafting questions' },
  ];
  p.update({ ...question, phase: 'working', messages });
  const rows = p.nodes.messages.children;
  assert.equal(rows.length, 5);
  assert.match(rows[0].className, /activity/); assert.doesNotMatch(rows[0].className, /live/);
  assert.match(rows[4].className, /activity live/);
  const summary = row => row.children[0].children[0];
  assert.equal(summary(rows[4]).children[0].textContent, 'Drafting questions');
  assert.equal(rows[2].children.at(-1).textContent, '<b>mine</b>');
  assert.match(p.nodes.status.className, /busy/);
  assert.equal(p.nodes.question.hidden, true, 'A question already in the transcript is not shown twice');
});

test('Skip this time sends the optional reason even while the review is still working', async () => {
  const bodies = [];
  const p = page(async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ...question, sequence: 3, phase: 'skipped' }) }; });
  p.update({ ...question, phase: 'working' });
  p.nodes.skip.onclick();
  assert.equal(p.nodes.skipbar.hidden, false);
  p.nodes.skipreason.value = ' prod is down ';
  await p.nodes.skipconfirm.onclick();
  assert.deepEqual(bodies.map(body => [body.action, body.response]), [['skip', 'prod is down']]);
  assert.equal(p.nodes.status.textContent, 'Skipped');
  assert.equal(p.nodes.skip.hidden, true);
});

test('consecutive review steps collapse to one closed group showing only the latest step', () => {
  const p = page();
  const messages = ['Read the diff for 3 changed files', 'Reading src/a.js', 'Searching for “x”'].map((text, i) => ({ id: 'm' + i, role: 'sphinx', kind: 'activity', text }));
  p.update({ ...question, phase: 'working', messages });
  const rows = p.nodes.messages.children;
  assert.equal(rows.length, 1);
  const details = rows[0].children[0], [summary, list] = details.children;
  assert.equal(details.open, false);
  assert.deepEqual(summary.children.map(node => node.textContent), ['Searching for “x”', '3 steps']);
  assert.equal(list.children.length, 3);
});

test('a phase change scrolls the conversation so recovery choices are visible', () => {
  const p = page();
  p.update({ ...question, phase: 'working', messages: [{ id: 'm1', role: 'sphinx', kind: 'activity', text: 'Reading a.js' }] });
  Object.assign(p.nodes.conversation, { scrollHeight: 5000, scrollTop: 0, clientHeight: 600 });
  p.update({ ...question, sequence: 2, phase: 'recovery', choices: [{ value: 'retry', label: 'Continue the saved review', description: '' }] });
  assert.equal(p.nodes.conversation.scrollTop, 5000);
  assert.equal(p.nodes.recovery.hidden, false);
  assert.equal(p.nodes.recovery.children.length, 1);
});

test('state line names follow-ups and finished checks stop describing a waiting Git operation', () => {
  const p = page(); const asked = { role: 'sphinx', kind: 'question', questionId: 'q1', number: 1, text: 'First?' };
  p.update({ ...question, messages: [asked] });
  assert.equal(p.nodes.status.textContent, 'Question 1 of 1'); assert.match(p.nodes.status.className, /phase-question/);
  p.update({ ...question, sequence: 2, question: { id: 'q2', prompt: 'Again?' }, messages: [asked, { role: 'sphinx', kind: 'question', questionId: 'q2', number: 1, followUp: true, text: 'Again?' }] });
  assert.equal(p.nodes.status.textContent, 'Question 1 of 1 · Needs another answer'); assert.match(p.nodes.status.className, /retry/);
  assert.equal(p.nodes.waiting.textContent, 'After you pass, you choose whether the push goes through. Closing this tab leaves it waiting; Stop push stops it.');
  p.update({ ...question, sequence: 3, phase: 'passed' });
  assert.match(p.nodes.status.className, /phase-passed/);
  assert.equal(p.nodes.waiting.hidden, true);
});

test('Dispute is a reversible mode: Enter sends a dispute, and Back to answering restores normal answers', async () => {
  const bodies = [];
  const p = page(async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ...question, sequence: 9, phase: 'working' }) }; });
  p.update(question);
  const enter = () => p.nodes.response.onkeydown({ key: 'Enter', shiftKey: false, isComposing: false, repeat: false, preventDefault() {} });
  p.nodes.dispute.onclick();
  assert.equal(p.nodes.submit.textContent, 'Send dispute');
  assert.equal(p.nodes.dispute.textContent, 'Back to answering');
  assert.equal(p.nodes.form.classList.contains('disputing'), true);
  p.nodes.dispute.onclick();
  assert.equal(p.nodes.submit.textContent, 'Send');
  assert.equal(p.nodes.label.textContent, 'Your answer');
  p.nodes.response.value = 'My actual answer.';
  enter(); await new Promise(resolve => setImmediate(resolve));
  p.update({ ...question, sequence: 10 });
  p.nodes.dispute.onclick(); p.nodes.response.value = 'It assumes retries exist.';
  enter(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(bodies.map(body => body.action), ['answer', 'dispute']);
});

test('a streaming reply renders with a live cursor and hides the generic working status', () => {
  const p = page();
  p.update({ ...question, phase: 'working', messages: [
    { id: 'm1', role: 'human', kind: 'answer', text: 'Yes.', status: 'checking' },
    { id: 'm2', role: 'sphinx', kind: 'feedback', streaming: true, text: 'Not quite. The constant' },
  ] });
  const row = p.nodes.messages.children[1];
  assert.match(row.className, /streaming/);
  assert.equal(row.children.at(-1).textContent, 'Not quite. The constant');
  assert.equal(p.nodes.status.hidden, true);
});

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const header = { checkpoint: 'a'.repeat(64), repository: 'fixture', event: 'pre-push', remote: 'origin', destination: 'refs/heads/main', base: 'b'.repeat(40), head: 'c'.repeat(40), staged: false, excludedFiles: 1 };
const changedFiles = [
  { path: '<img src=x onerror=steal()>.js', status: 'modified', binary: false, additions: 2, deletions: 1 },
  { path: 'assets/logo.bin', status: 'modified', binary: true, additions: null, deletions: null },
  { path: 'gone.txt', status: 'deleted', binary: false, additions: 0, deletions: 2 },
  { path: 'src/new.js', oldPath: 'src/old.js', status: 'renamed', binary: false, additions: 3, deletions: 0 },
];
const totals = { files: 4, additions: 5, deletions: 3, binaryFiles: 1, uncountedFiles: 0 };
const fileDiff = (path, context = '3') => path === 'assets/logo.bin'
  ? { path, status: 'modified', binary: true, additions: null, deletions: null, context, hunks: [], truncated: null, note: 'binary' }
  : { path, status: 'modified', binary: false, additions: 2, deletions: 1, context, truncated: path === 'gone.txt' ? { shownRows: 3000, totalRows: 4200 } : null, note: null,
    hunks: [{ oldStart: 4, oldLines: 2, newStart: 4, newLines: 3, section: 'function <b>x</b>()', rows: [
      { type: 'context', old: 4, new: 4, text: '<script>keep()</script>' }, { type: 'deletion', old: 5, new: null, text: 'old' },
      { type: 'addition', old: null, new: 5, text: 'new' }, { type: 'addition', old: null, new: 6, text: 'more' }] }] };
function changePage() {
  const requests = [];
  const p = page(async url => {
    requests.push(url);
    const query = new URL(url, 'http://local').searchParams;
    if (url.includes('/change?')) return { ok: true, json: async () => ({ status: 'ready', id: question.id, header, totals, files: changedFiles, listed: changedFiles.length }) };
    if (url.includes('/diff?')) return { ok: true, json: async () => fileDiff(query.get('path'), query.get('context')) };
    if (url.endsWith('/action?language=1')) return { ok: true, json: async () => ({}) };
    assert.fail(`Unexpected request ${url}`);
  });
  return { p, requests };
}
const refs = [{ path: 'src/new.js', inChange: true, viewPath: 'src/new.js', ranges: [{ side: 'new', start: 5, end: 6 }] }, { path: 'lib/dependency.js', inChange: false, ranges: [{ side: 'new', start: 3, end: 8 }] }];
const withChange = { ...question, question: { id: 'q1', prompt: 'What changes?', choices: [] }, change: { status: 'ready', header, totals }, evidence: { questionId: 'q1', refs } };
const fileButtons = p => p.nodes['file-list'].children.map(li => li.children[0]).filter(Boolean);

test('the change header and file list show exact scope and render repository paths literally', async () => {
  const { p, requests } = changePage();
  p.update(withChange); await flush();
  p.nodes.hint.onclick(); await flush();
  assert.equal(requests.filter(url => url.includes('/change?')).length, 1);
  assert.equal(p.nodes['scope-op'].textContent, 'Push to origin / main');
  assert.equal(p.nodes['scope-range'].textContent, 'bbbbbbbbbb → cccccccccc');
  const stats = p.nodes['scope-stats'].children;
  assert.equal(stats.map(node => node.textContent).join(''), '4 files · +5 −3 lines · 1 binary file (no line counts)');
  assert.deepEqual(stats.filter(node => node.className).map(node => [node.className, node.textContent]), [['plus', '+5'], ['minus', '−3']], 'colored like git diff --stat');
  assert.equal(p.nodes['scope-progress'].textContent, 'Question 1 of 1');
  assert.match(p.nodes['scope-note'].textContent, /not necessarily an entire pull request.*1 more changed file excluded/);
  const buttons = fileButtons(p);
  assert.equal(buttons.length, 4);
  assert.equal(buttons[0].children[1].textContent, '<img src=x onerror=steal()>.js');
  assert.equal(buttons[1].children[0].textContent, 'Binary');
  assert.equal(buttons[1].children[2].textContent, 'binary', 'Binary files show no manufactured line counts');
  assert.equal(buttons[3].children[1].children[0].textContent, 'from src/old.js');
  assert.match(buttons[3].getAttribute('aria-label'), /Renamed src\/new\.js from src\/old\.js, 3 added, 0 removed lines, cited by this question/);
  assert.equal(p.nodes['count-all'].textContent, '4 files');
  assert.equal(p.nodes['count-relevant'].textContent, '1 file');
  assert.match(p.nodes['filter-total'].textContent, /^All changed files: 4 files · \+5 −3 lines/);
  assert.equal(p.nodes['scope-excluded'].textContent, '1 file not shown or counted');
});

test('browsing files, filters, context, and views preserves the draft answer and current question', async () => {
  const { p, requests } = changePage();
  p.update(withChange); await flush();
  p.nodes.hint.onclick(); await flush();
  p.nodes.response.value = 'My unfinished answer.';
  for (const button of fileButtons(p).slice(0, 3)) { button.onclick(); await flush(); }
  assert.equal(p.nodes['diff-title'].textContent, 'gone.txt');
  assert.match(p.nodes['diff-note'].textContent, /first 3,000 of 4,200 diff lines/);
  p.nodes['filter-relevant'].onclick();
  assert.deepEqual(fileButtons(p).map(button => button.dataset.path), ['src/new.js']);
  p.nodes['file-search'].value = 'nothing'; p.nodes['file-search'].oninput();
  p.nodes['filter-all'].onclick(); p.nodes['file-search'].value = ''; p.nodes['file-search'].oninput();
  assert.equal(fileButtons(p).length, 4);
  p.nodes['context-more'].onclick(); await flush();
  assert.match(requests.at(-1), /path=gone\.txt&context=25$/);
  p.nodes['tab-files'].onclick(); p.nodes['tab-diff'].onclick();
  assert.equal(p.nodes.workspace.className, 'workspace show-diff');
  p.nodes['back-question'].onclick();
  assert.equal(p.nodes.workspace.className, 'workspace show-question');
  p.update({ ...withChange, sequence: 2 }); await flush();
  assert.equal(p.nodes.response.value, 'My unfinished answer.');
  assert.equal(p.nodes.status.textContent, 'Question 1 of 1');
  assert.ok(requests.every(url => !url.endsWith('/action')), 'Browsing never submits or changes the question');
});

test('evidence links open the cited hunk with non-color markers and label unchanged dependencies', async () => {
  const { p, requests } = changePage();
  p.update(withChange); await flush();
  p.nodes.hint.onclick(); await flush();
  const [linked, dependency] = p.nodes['evidence-list'].children;
  assert.equal(dependency.className, 'static');
  assert.match(dependency.children[1].textContent, /Unchanged file, not part of this change\. lines 3–8/);
  assert.match(p.nodes['evidence-note'].textContent, /not a claim that every changed line was read/);
  linked.children[0].onclick(); await flush();
  assert.match(requests.at(-1), /path=src%2Fnew\.js&context=3$/);
  assert.equal(p.nodes.workspace.className, 'workspace show-diff');
  const rows = p.nodes['diff-body'].children[0].children[0].children;
  assert.equal(rows[0].children[0].textContent, '⋯ 3 unchanged lines not shown');
  assert.equal(rows[1].children[0].textContent, '@@ −4,2 +4,3 @@ function <b>x</b>()');
  const marked = rows.filter(row => row.className.includes('evidence'));
  assert.deepEqual(marked.map(row => row.children[0].textContent), ['▸', '▸']);
  assert.deepEqual(marked.map(row => row.children[3].textContent), ['+', '+']);
  assert.equal(rows[2].children[4].textContent, '<script>keep()</script>');
  assert.match(marked[0].getAttribute('aria-label'), /Added line 5, read by the reviewer/);
  assert.equal(p.nodes['diff-legend'].hidden, false);
});

test('unavailable change data or evidence keeps the question answerable with an honest fallback', async () => {
  const p = page();
  p.update({ ...question, change: { status: 'unavailable', reason: 'The checkpoint’s Git objects are unavailable.' }, evidence: { questionId: 'q1', refs: [] } });
  p.nodes.hint.onclick();
  assert.match(p.nodes['scope-stats'].textContent, /^Unavailable: The checkpoint/);
  assert.match(p.nodes['files-note'].textContent, /The question can still be answered/);
  assert.equal(p.nodes['evidence-note'].textContent, 'No specific code location is available for this question.');
  assert.ok(p.buttons.every(button => !button.disabled));
  p.update({ ...question, sequence: 2, phase: 'passed', change: { status: 'unavailable' } });
  assert.equal(p.nodes.evidence.hidden, true);
});

test('before Show hint, nothing points at the code behind the question; the hint reveals it once per question', async () => {
  const { p, requests } = changePage();
  p.update(withChange); await flush();
  assert.equal(p.nodes.evidence.hidden, true, 'No code references before the hint');
  assert.equal(p.nodes['filter-relevant'].hidden, true, 'No relevant-files filter before the hint');
  assert.ok(fileButtons(p).every(button => !/cited by this question/.test(button.getAttribute('aria-label'))));
  assert.ok(requests.every(url => !url.includes('/diff?')), 'The cited file is not opened automatically');
  assert.equal(p.nodes.hint.textContent, 'Show hint');
  p.nodes.hint.onclick(); await flush();
  assert.equal(p.nodes.evidence.hidden, false);
  assert.equal(p.nodes.hint.disabled, true);
  assert.equal(p.nodes.hint.textContent, 'Hint shown');
  p.update({ ...withChange, sequence: 3, question: { ...withChange.question, id: 'q2' } }); await flush();
  assert.equal(p.nodes.evidence.hidden, true, 'A new question starts without the hint');
});

test('passing shows a clear end state that says the tab can be closed', () => {
  const p = page(); p.update(question);
  p.update({ ...question, sequence: 2, phase: 'passed', message: 'You passed. You can close this tab; Git is finishing the push on its own.' });
  assert.equal(p.nodes.message.className, 'message passed');
  assert.match(p.nodes.message.textContent, /close this tab/);
});

const consent = { ...question, sequence: 2, phase: 'consent', question: undefined, message: 'You passed. Continue the push?', choices: [
  { value: 'proceed', label: 'Continue push', description: 'Continue: the push goes through.' },
  { value: 'stop', label: 'Stop push', description: 'Stop: it does not go through. Your pass is saved, so the next push of this change asks only whether to continue.' },
] };

test('consent after a waiting pass is one row, Continue in amber and Stop plain, explained in one line', async () => {
  const bodies = [];
  const p = page(async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ...question, sequence: 4, phase: 'passed', message: 'You passed. You can close this tab; Git is finishing the push on its own.' }) }; });
  p.context.document.visibilityState = 'hidden';
  p.update(consent);
  assert.equal(p.nodes.message.textContent, 'You passed. Continue the push?'); assert.equal(p.nodes.message.className, 'message passed');
  assert.equal(p.nodes.status.hidden, true, 'no chip repeating what the scope line says');
  assert.equal(p.nodes['scope-progress'].textContent, 'Continue or stop');
  assert.equal(p.nodes.recovery.hidden, true); assert.equal(p.nodes.consent.hidden, false);
  const [row, note] = p.nodes.consent.children;
  assert.equal(row.className, 'actions');
  assert.deepEqual(row.children.map(button => [button.textContent, button.className]), [['Continue push', 'primary'], ['Stop push', '']], 'red stays reserved for skipping the check');
  assert.equal(note.className, 'hint');
  assert.equal(note.textContent, 'Continue: the push goes through. Stop: it does not go through. Your pass is saved, so the next push of this change asks only whether to continue.');
  assert.equal(p.nodes.skip.hidden, true); assert.equal(p.nodes.pause.hidden, true); assert.equal(p.nodes.composer.hidden, true);
  assert.equal(p.nodes.waiting.textContent, 'The push waits for your choice. Closing this tab leaves it waiting.');
  assert.equal(p.context.document.title, '● Sphinx: continue the push?');
  await row.children[0].onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(bodies.map(body => body.action), ['proceed']);
  assert.equal(p.nodes.status.textContent, 'Passed'); assert.equal(p.nodes.consent.hidden, true);
});

const stopped = { ...question, sequence: 3, phase: 'stopped', question: undefined, resume: 'git push origin main', message: 'Push stopped. It did not go through. Your pass is saved, so the next push of this change asks only whether to continue. You can close this tab.' };

test('on a phone, consent comes into view on the Question tab with its buttons last, and the outcome after a choice stays in view', () => {
  const p = page(undefined, { narrow: true }), scrolled = [];
  p.update({ ...question, messages: [{ id: 'm1', role: 'sphinx', kind: 'question', questionId: 'q1', number: 1, text: 'First?' }] });
  p.context.setTab('diff');
  for (const id of ['message', 'consent', 'status']) p.nodes[id].scrollIntoView = options => scrolled.push([id, options.block]);
  p.update(consent);
  assert.equal(p.nodes.workspace.className, 'workspace show-question', 'consent is never left behind the Diff tab');
  assert.deepEqual(scrolled, [['message', 'nearest'], ['consent', 'nearest']], 'only as far as needed, and the buttons win over a long message');
  scrolled.length = 0; p.update(stopped);
  assert.deepEqual(scrolled, [['status', 'nearest'], ['message', 'nearest']], 'the result stays where it is instead of jumping back to the question');
  const wide = page(); wide.update(question); wide.nodes.consent.scrollIntoView = () => assert.fail('wide screens scroll the conversation instead');
  wide.update(consent);
});

test('the consent row is built once per step and takes focus as a group, so updates never drop focus and Enter confirms nothing', () => {
  const html = browserPage({ token: 'fixture-token', nonce: 'fixture-nonce' });
  assert.match(html, /<div id="consent" class="consent" role="group" aria-labelledby="message" aria-describedby="consent-hint" tabindex="-1" hidden><\/div>/);
  const p = page(); let focused = 0; p.update(question);
  p.nodes.consent.focus = () => { focused++; };
  p.update(consent);
  const [row, note] = p.nodes.consent.children;
  assert.equal(focused, 1); assert.equal(note.id, 'consent-hint');
  p.update({ ...consent, sequence: 3, distance: { current: 'mixed', next: 'low', scope: 'machine' } });
  assert.equal(p.nodes.consent.children[0], row, 'a display-only update keeps the same buttons');
  assert.equal(focused, 1, 'focus is taken once, on entering the step');
  p.nodes.consent.querySelectorAll = () => row.children;
  p.events.onerror();
  assert.ok(row.children.every(button => button.disabled), 'no choice can be sent while disconnected');
  p.update({ ...consent, sequence: 4 });
  assert.ok(row.children.every(button => !button.disabled));
});

test('during consent, a refused choice or a lost connection is shown, and the footer stops saying the push waits', async () => {
  const p = page(async () => ({ ok: false, json: async () => ({ error: 'This checkpoint changed. Use the current question.' }) }));
  p.update(question); p.update(consent);
  assert.equal(p.nodes.composer.hidden, true);
  await p.nodes.consent.children[0].children[0].onclick();
  assert.equal(p.nodes.error.textContent, 'This checkpoint changed. Use the current question.');
  assert.equal(p.nodes.error.hidden, false); assert.equal(p.nodes.composer.hidden, false); assert.equal(p.nodes.form.hidden, true, 'only the error line shows');
  p.events.onerror();
  assert.match(p.nodes.error.textContent, /^Connection interrupted\. Reconnecting/);
  assert.equal(p.nodes.waiting.hidden, true);
  p.update({ ...consent, sequence: 3 });
  assert.equal(p.nodes.error.hidden, true); assert.equal(p.nodes.composer.hidden, true);
  assert.equal(p.nodes.waiting.textContent, 'The push waits for your choice. Closing this tab leaves it waiting.'); assert.equal(p.nodes.waiting.hidden, false);
});

test('stopping after a pass is a finished check that no longer describes a waiting Git operation', () => {
  const p = page(); p.update(question);
  p.update(stopped);
  assert.match(p.nodes.message.textContent, /^Push stopped\. It did not go through\./);
  assert.equal(p.nodes.status.textContent, 'Stopped'); assert.equal(p.nodes.status.className, 'status phase-stopped', 'the same ‖ Stopped mark as any other stop');
  assert.equal(p.nodes.resume.hidden, false); assert.equal(p.nodes['resume-command'].textContent, 'git push origin main');
  assert.equal(p.nodes['scope-progress'].textContent, 'Stopped');
  assert.equal(p.nodes.waiting.hidden, true);
  assert.equal(p.nodes.skip.hidden, true);
  assert.equal(p.nodes.pause.hidden, true);
  assert.ok(p.buttons.every(button => button.disabled));
});

test('the header button reads Stop push or Stop commit while Git waits, and Pause check when nothing waits', async () => {
  const bodies = [];
  const p = page(async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ...question, sequence: 3, phase: 'paused', message: 'Push stopped. It did not go through, and your progress is saved.', resume: 'git push origin main' }) }; });
  p.update(question);
  assert.equal(p.nodes.pause.textContent, 'Stop push');
  await p.nodes.pause.onclick();
  assert.deepEqual(bodies.map(body => body.action), ['pause'], 'the same pause, named for what it does');
  assert.equal(p.nodes.status.textContent, 'Stopped'); assert.equal(p.nodes['scope-progress'].textContent, 'Stopped');
  assert.equal(p.nodes['resume-command'].textContent, 'git push origin main');
  const commit = page(); commit.update({ ...question, event: 'pre-commit' });
  assert.equal(commit.nodes.pause.textContent, 'Stop commit');
  assert.equal(commit.nodes.waiting.textContent, 'After you pass, you choose whether the commit goes through. Closing this tab leaves it waiting; Stop commit stops it.');
  const manual = page(); manual.update({ ...question, waitingGit: false });
  assert.equal(manual.nodes.pause.textContent, 'Pause check');
  assert.equal(manual.nodes.waiting.textContent, 'Closing this tab leaves the check waiting. Use Pause check to stop.');
  manual.update({ ...question, waitingGit: false, sequence: 2, phase: 'paused', message: 'Paused. Your progress is saved.' });
  assert.equal(manual.nodes.status.textContent, 'Paused');
});

test('the waiting line explains the three-minute stop when the page is the only signal', () => {
  const p = page(); p.update({ ...question, abandonAfterMs: 180000 });
  assert.equal(p.nodes.waiting.textContent, 'After you pass, you choose whether the push goes through. If every Sphinx tab stays closed for 3 minutes, the push stops; your progress is saved.');
  p.update({ ...question, sequence: 2, phase: 'passed', abandonAfterMs: 180000 });
  assert.equal(p.nodes.waiting.hidden, true, 'a finished check is not waiting, so the line stays blank');
  const deciding = page(); deciding.update({ ...consent, abandonAfterMs: 180000 });
  assert.equal(deciding.nodes.waiting.textContent, 'The push waits for your choice. If every Sphinx tab stays closed for 3 minutes, the push stops; your progress is saved. If you cancelled this push in your Git client, choose Stop push.');
  const commit = page(); commit.update({ ...question, event: 'pre-commit', abandonAfterMs: 50 });
  assert.equal(commit.nodes.waiting.textContent, 'After you pass, you choose whether the commit goes through. If every Sphinx tab stays closed for 1 minute, the commit stops; your progress is saved.');
  const idle = page(); idle.update({ ...question, abandonAfterMs: 0 });
  assert.equal(idle.nodes.waiting.textContent, 'After you pass, you choose whether the push goes through. Closing this tab leaves it waiting; Stop push stops it.', 'only a positive window changes the line');
});

test('the context line names the model reviewing this check', () => {
  const p = page();
  p.update({ ...question, route: { provider: 'openrouter', model: 'qwen/qwen3-coder', tier: 'small' }, tokens: { input: 5200, output: 900, cost: 0.0014 } });
  assert.equal(p.nodes.usage.textContent, 'OpenRouter qwen/qwen3-coder · 6.1k tokens · $0.0014 · 1/20 calls');
  p.update({ ...question, sequence: 2, route: { provider: 'claude', model: 'haiku', tier: 'small' } });
  assert.equal(p.nodes.usage.textContent, 'Claude Code haiku');
});

test('the score shows one dot per recent answer, empty slots while warming up, and the percentage once scored', () => {
  const p = page();
  p.update({ ...question, score: { calibrating: true, answered: 2, needed: 3, accuracy: null, streak: 2, skipRate: null, recent: [true, false] } });
  assert.equal(p.nodes.score.hidden, false);
  assert.deepEqual(p.nodes['score-dots'].children.map(dot => dot.className), ['hit', 'miss', '', '', '']);
  assert.equal(p.nodes['score-value'].textContent, 'warming up');
  p.update({ ...question, sequence: 2, score: { calibrating: false, answered: 34, needed: 0, accuracy: 82, streak: 3, skipRate: 6, recent: [true, true, false, true] } });
  assert.equal(p.nodes['score-value'].textContent, '82%');
  assert.equal(p.nodes['score-dots'].children.length, 4);
  assert.match(p.nodes['score-dots'].children.at(-1).className, /hit fresh/, 'A newly graded answer pops in');
  assert.equal(p.nodes['score-meta'].textContent, '3 in a row · skipped 6%');
});

test('a saved ungraded answer or dispute is restored when its question opens, keeping the error visible', () => {
  const p = page();
  p.update({ ...question, draft: { kind: 'answer', text: 'Saved <b>answer</b>.' } });
  assert.equal(p.nodes.response.value, 'Saved <b>answer</b>.');
  assert.equal(p.nodes.form.classList.contains('disputing'), false);
  const d = page();
  d.update({ ...question, error: 'OpenRouter HTTP 429.', draft: { kind: 'dispute', text: 'It assumes a unique index.' } });
  assert.equal(d.nodes.response.value, 'It assumes a unique index.');
  assert.equal(d.nodes.submit.textContent, 'Send dispute');
  assert.equal(d.nodes.error.textContent, 'OpenRouter HTTP 429.');
  // Later updates for the same question never overwrite what the human is typing.
  d.nodes.response.value = 'Edited.';
  d.update({ ...question, sequence: 2, draft: { kind: 'dispute', text: 'It assumes a unique index.' } });
  assert.equal(d.nodes.response.value, 'Edited.');
});

const ko = (key, params) => t('ko', key, params);

test('the page renders in Korean from the first Korean state', async () => {
  // Served in English, as when the language changed before the first state arrived.
  const { p } = changePage();
  p.update({ ...withChange, language: 'ko', messages: [{ id: 'm1', role: 'sphinx', kind: 'question', questionId: 'q1', number: 1, text: 'What changes?' }] });
  await flush();
  assert.equal(p.context.document.documentElement.lang, 'ko');
  // Static text and attributes.
  assert.equal(p.translatable.find(item => item.dataset.t === 'page.header.subtitle').textContent, ko('page.header.subtitle'));
  assert.equal(p.nodes['file-search'].placeholder, ko('page.files.searchPlaceholder'));
  assert.equal(p.nodes.messages.getAttribute('aria-label'), ko('page.conversation.listLabel'));
  assert.equal(p.nodes.response.placeholder, ko('page.composer.answerPlaceholder'));
  // The script's sentences: the question caption, the file count and the status line.
  assert.equal(p.nodes.messages.children[0].children[1].textContent, ko('page.conversation.questionNumber', { n: 1 }));
  assert.equal(p.nodes['count-all'].textContent, ko('page.unit.files', { count: 4, n: '4' }));
  assert.equal(p.nodes.status.textContent, ko('page.status.questionOf', { n: 1, total: 1 }));
  assert.equal(p.nodes.waiting.textContent, `${ko('page.waiting.passPush')} ${ko('page.waiting.closingStopPush')}`);
});

test('the html lang value is escaped', () => {
  assert.match(browserPage({ token: 'fixture-token', nonce: 'fixture-nonce', language: 'x"><b>' }), /<html lang="x&quot;&gt;&lt;b&gt;">/u);
});

test('a Korean page served in Korean starts in Korean', () => {
  const html = browserPage({ token: 'fixture-token', nonce: 'fixture-nonce', language: 'ko' }), markup = html.split('<script')[0];
  assert.match(html, /^<!doctype html>\n<html lang="ko">/u);
  assert.ok(html.includes(`<title>${esc(KO['page.title.default'])}</title>`));
  // Each element and attribute the page translates starts with its Korean text, escaped for HTML.
  const tags = Array.from(markup.matchAll(/<\w+[^>]*\sdata-t[-=][^>]*>[^<]*/gu), ([tag]) => tag);
  assert.ok(tags.length >= 40, `${tags.length} translatable elements`);
  for (const tag of tags) {
    for (const [attribute, shown] of [['data-t', />([^<]*)$/u], ['data-t-label', /\saria-label="([^"]*)"/u], ['data-t-placeholder', /\splaceholder="([^"]*)"/u], ['data-t-title', /\stitle="([^"]*)"/u]]) {
      const key = tag.match(new RegExp(`\\s${attribute}="([^"]+)"`, 'u'))?.[1];
      if (key) assert.equal(tag.match(shown)?.[1], esc(KO[key]), key);
    }
  }
  assert.ok(tags.some(tag => tag.includes(' data-t-title="page.language.chipTitle"')), 'the language chip’s tooltip too');
  // So does text the script rewrites later.
  assert.ok(markup.includes(`id="status" class="status" role="status" aria-live="polite">${esc(KO['page.status.connecting'])}<`));
  assert.ok(markup.includes(`placeholder="${esc(KO['page.composer.answerPlaceholder'])}"`));
});

test('catalog text is escaped in the HTML and the script', () => {
  assert.equal(esc('a"<&>'), 'a&quot;&lt;&amp;&gt;');
  // The script's JSON never holds a "<", so no value (here the token) can end the script or open a comment.
  const [, script] = browserPage({ token: '</script><!--', nonce: 'fixture-nonce' }).match(/<script[^>]*>([\s\S]*?)<\/script>/u);
  assert.ok(script.includes('"\\u003c/script>\\u003c!--"'), 'the token is escaped');
  assert.ok(script.includes(JSON.stringify(pageCatalog()).replace(/</gu, '\\u003c')), 'both catalogs are embedded, escaped the same way');
});

test('the page draws every page key as t() does, in both languages', () => {
  const keys = Object.keys(EN).filter(key => key.startsWith('page.'));
  assert.ok(keys.length > 200, `${keys.length} page keys`);
  for (const language of ['en', 'ko']) {
    const tx = vm.runInContext('tx', page(undefined, { language }).context);
    for (const key of keys) {
      // Each placeholder gets text that looks like another placeholder and a replacement pattern; a filled value is never read again.
      const names = Array.from(JSON.stringify(EN[key]).matchAll(/\{(\w+)\}/gu), ([, name]) => name);
      for (const count of [1, 2]) {
        const params = { count, ...Object.fromEntries(names.map(name => [name, `{count}$&${name}`])) };
        assert.equal(tx(key, params), t(language, key, params), `${language} ${key}`);
      }
    }
    assert.equal(tx('page.no.such.key'), 'page.no.such.key');
  }
});

// Opens the language chip's menu unless it is open, and picks a language from it, as a click does.
async function chooseLanguage(p, name) {
  if (p.nodes.language.getAttribute('aria-expanded') !== 'true') p.nodes.language.onclick();
  await p.nodes['language-menu'].children.find(item => item.children[1]?.textContent === name).onclick();
  await flush();
}

test('switching language redraws the transcript captions and the file counts', async () => {
  const { p } = changePage();
  const messages = [{ id: 'm1', role: 'sphinx', kind: 'question', questionId: 'q1', number: 1, text: 'What changes?' }, { id: 'm2', role: 'human', kind: 'answer', text: 'It retries.', status: 'checking' }];
  p.update({ ...withChange, language: 'en', messages }); await flush();
  assert.deepEqual(p.nodes.messages.children.map(row => row.children[0].textContent), ['Sphinx', 'You']);
  await chooseLanguage(p, '한국어');
  const [asked, answered] = p.nodes.messages.children;
  assert.equal(asked.children[1].textContent, ko('page.conversation.questionNumber', { n: 1 }));
  assert.equal(answered.children[0].textContent, ko('page.conversation.you'));
  assert.equal(answered.children.at(-1).textContent, ko('page.conversation.checking'));
  const files = n => ko('page.unit.files', { count: n, n: String(n) });
  assert.equal(p.nodes['count-all'].textContent, files(4));
  assert.equal(p.nodes['filter-total'].textContent, ko('page.files.allTotal', { totals: [files(4), `+5 −3 ${ko('page.totals.lines')}`, ko('page.totals.binaryFiles', { count: 1, n: '1' })].join(' · ') }));
  assert.equal(fileButtons(p)[1].children[0].textContent, ko('page.fileStatus.binary'));
  assert.equal(p.nodes['files-note'].textContent, ko('page.files.excludedNote', { count: 1, n: '1' }));
});

test('switching language in dispute mode keeps the dispute texts and the draft', async () => {
  const bodies = [];
  const p = page(async (url, init) => { bodies.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({ ...question, sequence: 9, phase: 'working', language: 'ko' }) }; });
  p.update({ ...question, language: 'en' });
  p.nodes.dispute.onclick(); p.nodes.response.value = 'draft';
  let focused = 0; p.nodes.response.focus = () => { focused++; };
  await chooseLanguage(p, '한국어');
  assert.deepEqual([p.nodes.label.textContent, p.nodes.response.placeholder, p.nodes.submit.textContent, p.nodes.dispute.textContent],
    [ko('page.composer.disputeLabel'), ko('page.composer.disputePlaceholder'), ko('page.composer.sendDispute'), ko('page.composer.backToAnswer')]);
  assert.equal(p.nodes.response.value, 'draft');
  assert.equal(focused, 0, 'a switch leaves the focus where it is');
  p.nodes.form.onsubmit({ preventDefault() {} }); await flush();
  assert.deepEqual(bodies.map(([url, body]) => [url, body.language ?? body.action, body.response]), [['/fixture-token/action?language=1', 'ko', undefined], ['/fixture-token/action', 'dispute', 'draft']]);
});

test('switching language with a diff open keeps the path title', async () => {
  // The hint is shown before the code references arrive, so only the switch itself can redraw the open diff.
  const { p } = changePage();
  p.update({ ...withChange, language: 'en', evidence: undefined }); await flush();
  p.nodes.hint.onclick(); fileButtons(p)[3].onclick(); await flush();
  assert.equal(p.nodes['diff-title'].textContent, 'src/new.js');
  await chooseLanguage(p, '한국어');
  assert.equal(p.nodes['diff-title'].textContent, 'src/new.js');
  assert.equal(p.nodes['diff-meta'].textContent, [ko('page.fileStatus.modified'), '+2 −1', ko('page.diff.contextLines', { n: '3' })].join(' · '));
  assert.equal(p.nodes['diff-body'].children[0].children[0].children[0].children[0].textContent, ko('page.diff.hiddenLines', { count: 3, n: '3' }));
});

test('switching language with no file open rewrites the diff pane and the copy button', async () => {
  const { p } = changePage();
  p.update({ ...withChange, language: 'en' }); await flush();
  await chooseLanguage(p, '한국어');
  assert.equal(p.nodes['diff-title'].textContent, ko('page.diff.noFile'));
  assert.equal(p.nodes['diff-meta'].textContent, ko('page.diff.browse'));
  assert.equal(p.nodes['resume-copy'].textContent, ko('page.resume.copy'));
});

test('switching language with only a model question redraws the speaker label', () => {
  const p = page();
  const messages = [{ id: 'm1', role: 'sphinx', kind: 'question', questionId: 'q1', number: 1, text: 'What changes?' }];
  p.update({ ...question, language: 'en', messages });
  const [row] = p.nodes.messages.children;
  assert.deepEqual(row.children.slice(0, 2).map(node => node.textContent), ['Sphinx', 'Question 1']);
  // Another tab switched. The server's next frame carries the same model text, so only the language marks it as new.
  p.update({ ...question, sequence: 2, language: 'ko', messages });
  const [redrawn] = p.nodes.messages.children;
  assert.notEqual(redrawn, row, 'the transcript is drawn again');
  assert.deepEqual(redrawn.children.slice(0, 2).map(node => node.textContent), [ko('page.conversation.sphinx'), ko('page.conversation.questionNumber', { n: 1 })]);
  assert.equal(p.nodes['scope-note'].textContent, ko('page.scope.note'), 'with no change header, nothing else writes the scope note');
});

test('switching language redraws the notes written once: load failures and the model menu error', async () => {
  // The changed files fail to load, and every later attempt hangs, so only the page can redraw the note.
  let changeAsked = 0;
  const failing = page(async url => {
    if (url.includes('/change?')) return ++changeAsked === 1 ? { ok: false, json: async () => ({}) } : new Promise(() => {});
    if (url.endsWith('/action?language=1')) return { ok: true, json: async () => ({}) };
    assert.fail(`Unexpected request ${url}`);
  });
  failing.update({ ...withChange, language: 'en' }); await flush();
  assert.equal(failing.nodes['files-note'].textContent, 'Changed files are unavailable: the request failed.');
  await chooseLanguage(failing, '한국어');
  assert.equal(failing.nodes['files-note'].textContent, ko('page.files.unavailable', { reason: ko('page.files.requestFailed') }));
  // One file's diff cannot be fetched, and another's is still loading.
  const p = page(async url => {
    if (url.includes('/change?')) return { ok: true, json: async () => ({ status: 'ready', id: question.id, header, totals, files: changedFiles, listed: changedFiles.length }) };
    if (url.includes('/diff?')) return url.includes('path=gone.txt') ? Promise.reject(new Error('offline')) : new Promise(() => {});
    if (url.endsWith('/action?language=1')) return { ok: true, json: async () => ({}) };
    assert.fail(`Unexpected request ${url}`);
  });
  p.update({ ...withChange, language: 'en' }); await flush();
  fileButtons(p)[2].onclick(); await flush();
  assert.equal(p.nodes['diff-note'].textContent, 'The diff could not be loaded. Your answer is unaffected.');
  await chooseLanguage(p, '한국어');
  assert.deepEqual([p.nodes['diff-title'].textContent, p.nodes['diff-meta'].textContent, p.nodes['diff-note'].textContent], ['gone.txt', '', ko('page.diff.loadFailed')]);
  fileButtons(p)[3].onclick(); await flush();
  await chooseLanguage(p, 'English');
  assert.deepEqual([p.nodes['diff-title'].textContent, p.nodes['diff-meta'].textContent], ['src/new.js', 'Loading diff…'], 'a failure before this load is not drawn again');
  // The model menu shows a refused switch, and another tab switches the language while it is open.
  const models = { groups: [{ provider: 'claude', label: 'Claude Code', billing: 'your plan', models: [{ model: 'haiku', label: 'haiku' }, { model: 'sonnet', label: 'sonnet' }] }] };
  const m = page(async () => ({ ok: false, json: async () => ({}) }));
  m.update({ ...question, language: 'en', models, route: { provider: 'claude', model: 'haiku' } });
  m.nodes.model.onclick();
  m.nodes['model-menu'].children.find(item => item.children[1]?.textContent === 'sonnet').onclick(); await flush();
  assert.equal(m.nodes['model-menu'].children.find(item => item.className === 'menu-error').textContent, 'Could not switch models.');
  m.update({ ...question, sequence: 2, language: 'ko', models, route: { provider: 'claude', model: 'haiku' } });
  assert.equal(m.nodes['model-menu'].children.find(item => item.className === 'menu-error').textContent, ko('page.model.switchFailed'));
});

test('a stale frame does not revert the language, another tab\'s switch is followed', async () => {
  const p = page(async () => ({ ok: true, json: async () => ({}) }));
  const shown = () => [p.context.document.documentElement.lang, p.nodes.status.textContent, p.nodes.language.children[0].textContent];
  const korean = ['ko', ko('page.status.questionOf', { n: 1, total: 1 }), '한국어'], english = ['en', 'Question 1 of 1', 'English'];
  p.update({ ...question, language: 'en' });
  await chooseLanguage(p, '한국어');
  assert.deepEqual(shown(), korean);
  // Sent before the server switched: it repeats the last state's language, so the pick stands.
  p.update({ ...question, sequence: 2, language: 'en' });
  assert.deepEqual(shown(), korean);
  // A state without a language changes nothing.
  p.update({ ...question, sequence: 3 });
  assert.deepEqual(shown(), korean);
  // The server took the pick; then another tab picks English.
  p.update({ ...question, sequence: 4, language: 'ko' });
  assert.deepEqual(shown(), korean);
  p.update({ ...question, sequence: 5, language: 'en' });
  assert.deepEqual(shown(), english);
  p.update({ ...question, sequence: 6 });
  assert.deepEqual(shown(), english);
});

test('the chip posts the language and shows languageError in its menu', async () => {
  const requests = [];
  const p = page(async (url, init) => { requests.push([url, init]); return { ok: true, json: async () => ({ ...question, sequence: 2, language: 'ko', languageError: 'Could not save the language setting: <b>EACCES</b>' }) }; });
  p.update({ ...question, language: 'en' });
  const chip = p.nodes.language, menu = p.nodes['language-menu'];
  assert.equal(chip.hidden, false);
  assert.equal(chip.children[0].textContent, 'English');
  chip.onclick();
  assert.deepEqual(menu.children.map(item => item.children.length ? item.children.map(part => part.textContent) : item.textContent), ['Questionnaire language', ['●', 'English'], ['', '한국어']]);
  let focused = 0; chip.focus = () => { focused++; };
  await chooseLanguage(p, '한국어');
  assert.equal(focused, 1, 'the redrawn menu dropped the focused option, so focus is back on the chip');
  assert.deepEqual(requests.map(([url, init]) => [url, init.method, { ...init.headers }, JSON.parse(init.body)]), [['/fixture-token/action?language=1', 'POST', { 'Content-Type': 'application/json', 'X-Sphinx-Token': 'fixture-token' }, { language: 'ko' }]]);
  assert.equal(chip.children[0].textContent, '한국어');
  assert.equal(menu.hidden, false, 'the menu stays open to show the error');
  const error = menu.children.at(-1);
  assert.equal(error.className, 'menu-error');
  assert.equal(error.textContent, 'Could not save the language setting: <b>EACCES</b>');
  assert.equal(menu.children[0].textContent, ko('page.language.menuTitle'));
});

test('a refused or unreachable pick shows its error in the menu, and the page follows the next state', async () => {
  let reply;
  const p = page(async () => reply());
  const shown = () => [p.context.document.documentElement.lang, p.nodes['language-menu'].children.at(-1).textContent];
  p.update({ ...question, language: 'en' });
  reply = () => ({ ok: false, json: async () => ({ error: 'This questionnaire is closing.' }) });
  await chooseLanguage(p, '한국어');
  assert.deepEqual(shown(), ['ko', 'This questionnaire is closing.'], 'the pick stands until the server says otherwise, and its error shows as sent');
  await chooseLanguage(p, '한국어');
  assert.deepEqual(shown(), ['ko', 'This questionnaire is closing.'], 'a second pick is not undone by its own redraw');
  // The server kept English, so its next state brings the page back.
  p.update({ ...question, sequence: 2, language: 'en' });
  assert.deepEqual([...shown(), p.nodes.status.textContent], ['en', 'This questionnaire is closing.', 'Question 1 of 1']);
  reply = () => Promise.reject(new Error('offline'));
  await chooseLanguage(p, '한국어');
  assert.deepEqual(shown(), ['ko', ko('page.menu.unreachable')]);
  p.update({ ...question, sequence: 3, language: 'en' });
  assert.deepEqual(shown(), ['en', 'Could not reach Sphinx. Try again.'], 'the menu’s own words follow too');
});

test('the language menu opens and closes like the other chip menus', () => {
  const p = page();
  const models = { groups: [{ provider: 'claude', label: 'Claude Code', billing: 'your plan', models: [{ model: 'haiku', label: 'haiku' }] }] };
  p.update({ ...question, language: 'en', models, route: { provider: 'claude', model: 'haiku' }, distance: { current: 'mixed', next: null, scope: 'machine' } });
  const chip = p.nodes.language, menu = p.nodes['language-menu'];
  let focused = 0; chip.focus = () => { focused++; };
  chip.onclick();
  assert.deepEqual([menu.hidden, chip.getAttribute('aria-expanded')], [false, 'true']);
  p.context.document.onkeydown({ key: 'Escape' });
  assert.deepEqual([menu.hidden, chip.getAttribute('aria-expanded'), focused], [true, 'false', 1], 'Escape closes it and returns to the chip');
  for (const other of ['model', 'distance']) {
    chip.onclick(); p.nodes[other].onclick();
    assert.deepEqual([menu.hidden, p.nodes[`${other}-menu`].hidden], [true, false], `opening the ${other} menu closes it`);
    chip.onclick();
    assert.deepEqual([menu.hidden, p.nodes[`${other}-menu`].hidden], [false, true], `opening it closes the ${other} menu`);
    chip.onclick();
  }
  chip.onclick(); p.context.document.onclick({ target: p.nodes.prompt });
  assert.equal(menu.hidden, true, 'a click outside closes it');
  chip.onclick();
  p.update({ ...question, sequence: 2, phase: 'passed', language: 'en' });
  assert.deepEqual([chip.hidden, menu.hidden], [true, true], 'a finished check has no chip');
});

test('a frame that switches the language and raises the score keeps the new dot\'s pop', () => {
  const p = page();
  const score = (answered, recent) => ({ calibrating: true, answered, needed: 5 - answered, accuracy: null, streak: 1, skipRate: null, recent });
  p.update({ ...question, language: 'en', score: score(1, [true]) });
  p.update({ ...question, sequence: 2, language: 'ko', score: score(2, [true, false]) });
  assert.equal(p.nodes['score-dots'].children[1].className, 'miss fresh');
  assert.equal(p.nodes['score-value'].textContent, ko('page.score.warmingUp'));
});

test('the Korean stamp tooltip says questions are quoted in their language', () => {
  const stamped = { ...question, stamp: { post: false, action: false } }, action = { post: true, action: true };
  const en = page(); en.update(stamped);
  assert.equal(en.nodes['stamp-row'].title, 'After you pass, Sphinx comments on this branch’s pull request with a summary: how many questions, which you got right first time, and the model. Your answers are not included unless you turn that on in your settings.');
  en.update({ ...stamped, sequence: 2, stamp: action });
  assert.equal(en.nodes['stamp-row'].title, 'This repository shows a Sphinx check on pull requests. After you pass, Sphinx comments on this branch’s pull request with a summary: how many questions, which you got right first time, and the model. The Sphinx check reads it. Your answers are not included unless you turn that on in your settings.');
  const kr = page(undefined, { language: 'ko' }); kr.update({ ...stamped, language: 'ko' });
  assert.equal(kr.nodes['stamp-row'].title, KO['page.stamp.tooltip']);
  kr.update({ ...stamped, sequence: 2, language: 'ko', stamp: action });
  assert.equal(kr.nodes['stamp-row'].title, KO['page.stamp.tooltipAction']);
  for (const key of ['page.stamp.tooltip', 'page.stamp.tooltipAction']) assert.ok(KO[key].includes('댓글은 질문을 물어본 언어 그대로 인용합니다.'), key);
});
