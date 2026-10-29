import test from 'node:test';
import assert from 'node:assert/strict';
import { colorEnabled, createTerminal, displayWidth, stripAnsi, wrapText, withProgress, formatError, SPHINX } from '../src/terminal.js';
import { printHelp, HELP } from '../src/help.js';
import { askInstall, askPolicy, createPrompts, installLanguage, languageQuestion } from '../src/prompts.js';
import { applyInstallOptions } from '../src/cli.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { presetOptions } from '../src/model-presets.js';
import { modelUsageText, modelLimitText } from '../src/usage.js';

function capture({ width = 80, env = {}, tty = false } = {}) {
  let text = '';
  const stream = { isTTY: tty, columns: width, write(value) { text += value; } };
  return { stream, ui: createTerminal({ stream, env }), text: () => text };
}

test('human usage shows tokens and cost, and calls only when a cap is set', () => {
  assert.equal(modelUsageText({ calls: 20, limit: null }, { input: 11800, output: 600, cost: 0.0031 }), '12.4k tokens · $0.0031');
  assert.equal(modelUsageText({ calls: 7, limit: 30 }, { input: 900, output: 50, cost: null }), '950 tokens · 7/30 calls');
  assert.equal(modelUsageText({ calls: 3, limit: null }, { input: 2_000_000, output: 0, cost: 1.5 }), '2.0M tokens · $1.50');
  assert.equal(modelUsageText({ calls: 1, limit: null }, { input: 53, output: 6, cost: 0.00001116 }), '59 tokens · <$0.0001');
  assert.equal(modelUsageText({ calls: 1, limit: null }, { input: 53, output: 6, cost: 0 }), '59 tokens · $0');
  assert.equal(modelLimitText(null), 'no limit');
  assert.equal(modelLimitText(30), '30 model calls per assessment');
});

test('color follows terminal, NO_COLOR, TERM=dumb, and explicit FORCE_COLOR policy', () => {
  assert.equal(colorEnabled({ stream: { isTTY: true }, env: {} }), true);
  assert.equal(colorEnabled({ stream: { isTTY: false }, env: {} }), false);
  assert.equal(colorEnabled({ stream: { isTTY: true }, env: { TERM: 'dumb' } }), false);
  assert.equal(colorEnabled({ stream: { isTTY: false }, env: { FORCE_COLOR: '1' } }), true);
  assert.equal(colorEnabled({ stream: { isTTY: true }, env: { FORCE_COLOR: '0' } }), false);
  assert.equal(colorEnabled({ stream: { isTTY: true }, env: { FORCE_COLOR: '1', NO_COLOR: '1' } }), false);
  assert.equal(colorEnabled({ stream: { isTTY: true }, env: { NO_COLOR: '' } }), false);
});

test('wrapping respects visible width, long tokens, indentation, and blank paragraphs', () => {
  const text = wrapText('\x1b[1mA rather long sentence\x1b[0m\n\n' + 'x'.repeat(100), 24, '  ');
  assert.ok(text.split('\n').every(line => stripAnsi(line).length <= 24));
  assert.ok(text.includes('\n\n'));
  assert.equal(stripAnsi(text).replace(/\s/g, ''), 'Aratherlongsentence' + 'x'.repeat(100));
});

// Widths below are measured with displayWidth, never .length: .length counts a Hangul syllable as one column, so a
// Korean line that overflows the terminal would still pass.
const fits = (text, width) => text.split('\n').every(line => displayWidth(line) <= width);
const startColumn = (line, marker) => displayWidth(line.slice(0, line.indexOf(marker)));
const ZWJ_FAMILY = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}';

test('displayWidth counts Hangul, emoji, ZWJ sequences, NFD jamo and ANSI by display columns', () => {
  assert.equal(displayWidth('한국어'), 6);
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('🚀'), 2);
  assert.equal(displayWidth(ZWJ_FAMILY), 2, 'a ZWJ family is one wide emoji');
  assert.equal(displayWidth('✓'), 1);
  assert.equal(displayWidth('\u{1112}\u{1161}\u{11AB}'), 2, 'a decomposed syllable is one wide cell');
  assert.equal(displayWidth('한글'.normalize('NFD')), 4);
  assert.equal(displayWidth('\x1b[31m한\x1b[0m'), 2, 'color codes take no column');
  assert.equal(displayWidth('a한b'), 4);
  // Marks and invisible characters add no column of their own.
  assert.equal(displayWidth(''), 0);
  assert.equal(displayWidth('e\u{301}'), 1);
  assert.equal(displayWidth('\u{301}'), 0);
  assert.equal(displayWidth('a\u{200B}b'), 2);
  assert.equal(displayWidth('\u{600}a'), 1, 'a grapheme is empty only when every code point in it is');
  // Emoji presentation, a variation selector, flags and full-width forms are wide; text symbols and half-width forms are not.
  assert.equal(displayWidth('\u{2764}\u{FE0F}'), 2);
  assert.equal(displayWidth('\u{2764}'), 1);
  assert.equal(displayWidth('\u{1F1F0}\u{1F1F7}'), 2);
  assert.equal(displayWidth('漢'), 2);
  assert.equal(displayWidth('\u{FF21}'), 2);
  assert.equal(displayWidth('\u{FF71}'), 1);
  assert.equal(displayWidth('\u{2705}'), 2, 'a BMP character with emoji presentation');
  assert.equal(displayWidth('\u{20DD}'), 0, 'an enclosing mark');
  assert.equal(displayWidth('\u{1161}\u{11AB}'), 0, 'vowel and final jamo alone');
  assert.equal(displayWidth('\u{D7B0}'), 0, 'extended jamo');
  // Both ends of every wide range are two columns, and the characters just outside them are one.
  for (const [from, to] of [[0x1100, 0x115F], [0x2E80, 0xA4CF], [0xAC00, 0xD7A3], [0xF900, 0xFAFF], [0xFE30, 0xFE4F], [0xFF00, 0xFF60], [0xFFE0, 0xFFE6], [0x20000, 0x3FFFD]]) {
    for (const codePoint of [from, to]) assert.equal(displayWidth(String.fromCodePoint(codePoint)), 2, `U+${codePoint.toString(16)}`);
  }
  for (const codePoint of [0x10FF, 0xA4D0, 0xD7A4, 0xFB00, 0xFF61, 0xFFE8]) assert.equal(displayWidth(String.fromCodePoint(codePoint)), 1, `U+${codePoint.toString(16)}`);
  // The glyphs Sphinx draws itself count one column, and printable ASCII is unchanged, so English keeps its width.
  for (const glyph of ['◆', '→', '·', '●', '○', '─', '┃', '│', '‖', '◇', '…', '−', '›', '✓', '✗', '↷']) assert.equal(displayWidth(glyph), 1, glyph);
  const ascii = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join('');
  assert.equal(displayWidth(ascii), ascii.length);
});

test('a soft hyphen takes one column, so English text with soft hyphens wraps as it did before display widths', () => {
  // Terminals draw U+00AD, so it is the one format character that is not zero-width.
  assert.equal(displayWidth('\u{AD}'), 1);
  assert.equal(displayWidth('re\u{AD}try'), 6);
  assert.equal(displayWidth('\u{200B}\u{AD}\u{2060}'), 1);
  // Expected output from wrapText as it was before Sphinx measured display columns, when each UTF-16 unit was one column.
  const text = 'Pass the idem\u{AD}po\u{AD}tency key to every re\u{AD}try so the pay\u{AD}ment runs once, and in\u{AD}ter\u{AD}na\u{AD}tion\u{AD}al\u{AD}iza\u{AD}tion stays in\u{AD}tact.';
  assert.equal(wrapText(text, 30, '  '), '  Pass the idem\u{AD}po\u{AD}tency key\n  to every re\u{AD}try so the\n  pay\u{AD}ment runs once, and\n  in\u{AD}ter\u{AD}na\u{AD}tion\u{AD}al\u{AD}iza\u{AD}tion\n  stays in\u{AD}tact.');
  assert.equal(wrapText(text, 20), 'Pass the\nidem\u{AD}po\u{AD}tency key to\nevery re\u{AD}try so the\npay\u{AD}ment runs once,\nand\nin\u{AD}ter\u{AD}na\u{AD}tion\u{AD}al\u{AD}iz\na\u{AD}tion stays\nin\u{AD}tact.');
  assert.ok(fits(wrapText(text, 30, '  '), 30) && fits(wrapText(text, 20), 20));
});

test('wrapText never exceeds the width with Korean text', () => {
  const text = '이 변경은 재시도 때 같은 결제가 두 번 저장될 수 있는지 확인합니다. 답을 보내기 전에 코드를 먼저 살펴보고, 확신이 없으면 /learn 으로 설명을 요청해 주세요.';
  for (const width of [20, 30, 80]) {
    for (const indent of ['', '  ', '한']) {
      const wrapped = wrapText(text, width, indent);
      assert.ok(fits(wrapped, width), `width ${width}, indent ${JSON.stringify(indent)}:\n${wrapped}`);
      assert.equal(wrapped.split('\n').map(line => line.slice(indent.length)).join('').replace(/\s/gu, ''), text.replace(/\s/gu, ''), 'no character is lost');
    }
  }
  const colored = wrapText(`\x1b[1m${text}\x1b[0m`, 30);
  assert.ok(fits(colored, 30), colored);
  assert.equal(stripAnsi(colored).replace(/\s/gu, ''), text.replace(/\s/gu, ''));
});

test('a long unbroken Hangul word wraps at grapheme boundaries', () => {
  const word = '대한민국만세'.repeat(10);
  assert.equal(word.length, 60);
  const lines = wrapText(word, 20).split('\n');
  assert.ok(lines.every(line => displayWidth(line) <= 20), lines.join('\n'));
  assert.equal(lines.length, 6);
  assert.equal(lines.join(''), word, 'the lines join back to the word');
  // Decomposed jamo: a syllable is two or three code points, and no line may end inside one.
  const jamo = word.normalize('NFD');
  const jamoLines = wrapText(jamo, 20).split('\n');
  assert.ok(jamoLines.every(line => displayWidth(line) <= 20), jamoLines.join('\n'));
  assert.equal(jamoLines.join(''), jamo);
  assert.ok(jamoLines.every(line => /^[가-힣]+$/u.test(line.normalize('NFC'))), 'no syllable is cut in two');
  // A ZWJ sequence and a surrogate pair are each one grapheme too.
  const familyLines = wrapText(ZWJ_FAMILY.repeat(15), 20).split('\n');
  assert.ok(familyLines.every(line => displayWidth(line) <= 20 && line === ZWJ_FAMILY.repeat(line.length / ZWJ_FAMILY.length)), JSON.stringify(familyLines));
  const rocketLines = wrapText('🚀'.repeat(25), 20).split('\n');
  assert.deepEqual(rocketLines, ['🚀'.repeat(10), '🚀'.repeat(10), '🚀'.repeat(5)]);
  // A color code inside a long word stays whole, in place, and takes no room.
  const colored = wrapText(`${'x'.repeat(18)}\x1b[31m${'y'.repeat(30)}\x1b[0m`, 20).split('\n');
  assert.deepEqual(colored, [`${'x'.repeat(18)}\x1b[31myy`, 'y'.repeat(20), `${'y'.repeat(8)}\x1b[0m`]);
  // A wide grapheme in a one-column room still moves on instead of looping or dropping it.
  assert.equal(wrapText('한글', 3, '  ').split('\n').join(''), '  한  글');
});

test('main help has the sphinx mark and command help stays scoped at narrow widths', () => {
  const main = capture(); printHelp(main.ui);
  assert.ok(main.text().includes(SPHINX[0]));
  assert.match(main.text(), /Get started/);
  for (const width of [24, 40, 60, 80]) {
    for (const command of Object.keys(HELP)) {
      const output = capture({ width, env: { FORCE_COLOR: '1' } });
      printHelp(output.ui, command);
      assert.ok(stripAnsi(output.text()).includes(`sphinx ${command}`));
      assert.equal(output.text().includes(SPHINX[0]), false);
      assert.ok(output.text().split('\n').every(line => stripAnsi(line).length <= width), `${command} overflowed ${width} columns`);
    }
  }
});

test('check help names /stop for a waiting Git operation and says what stop means after a pass', () => {
  const output = capture(); printHelp(output.ui, 'check');
  const text = stripAnsi(output.text()).replace(/\s+/g, ' ');
  assert.match(text, /\/stop While a Git operation waits: stop it now\. It does not go through, and progress is saved\. \/quit does the same\./);
  assert.match(text, /a pass \(including one that needs no questions\) asks you to continue or stop it, within its time limit; stop means it does not go through, and the pass is kept, so the next push or commit of that change asks only whether to continue\./);
});

test('status rows and narrow banners fit without decorative boxes or blue colors', () => {
  for (const width of [20, 24, 30, 40, 65, 80]) {
    const output = capture({ width, env: { FORCE_COLOR: '1' } });
    output.ui.banner();
    output.ui.rows([['Repository policy', '/long/path/'.repeat(15)], ['Current local branch', 'release/next-version']]);
    assert.ok(output.text().split('\n').every(line => stripAnsi(line).length <= width), `overflowed ${width} columns`);
    assert.equal(output.text().includes('\x1b[34m'), false);
  }
});

test('rows aligns Korean labels by display width', () => {
  const entries = [
    ['1. English', 'Alpha questions are asked in English, and this description is long enough to wrap onto a second and a third line.'],
    ['2. 한국어 (Korean)', '한국어 설명은 영어 설명과 같은 칸에서 시작하고, 줄이 길어지면 같은 칸에 맞추어 이어서 쓰입니다. 마지막 줄까지 폭 안에 들어옵니다.'],
  ];
  for (const width of [68, 80, 100]) {
    const output = capture({ width });
    output.ui.rows(entries);
    const lines = output.text().split('\n').filter(Boolean);
    assert.ok(fits(output.text(), width), `width ${width}:\n${output.text()}`);
    const english = lines.find(line => line.includes('1. English')), korean = lines.find(line => line.includes('2. 한국어'));
    const column = startColumn(english, 'Alpha');
    assert.equal(startColumn(korean, '한국어 설명은'), column, `width ${width}: both descriptions start in the same column\n${output.text()}`);
    assert.ok(lines.filter(line => line !== english && line !== korean).every(line => line.match(/^ */)[0].length === column), `width ${width}: wrapped lines continue in that column\n${output.text()}`);
  }
  // A label too wide for the inline layout stacks its description under it, as English labels of that width do.
  const stacked = capture({ width: 80 });
  stacked.ui.rows([[`1. ${'한'.repeat(20)}`, 'A description.'], ['2. Plain', 'Another one.']]);
  assert.ok(fits(stacked.text(), 80), stacked.text());
  assert.match(stacked.text(), /^ {4}A description\.$/m);
  for (const width of [20, 24, 40, 67]) {
    const narrow = capture({ width });
    narrow.ui.rows(entries);
    assert.ok(fits(narrow.text(), width), `width ${width}:\n${narrow.text()}`);
  }
});

test('table pads cells by display width', () => {
  const output = capture();
  output.ui.table(['Name', 'Calls'], [['한국어 라벨', '3'], ['English', '12']]);
  assert.deepEqual(output.text().split('\n').filter(Boolean).map(displayWidth), [21, 21, 21], output.text());
});

test('English output is unchanged', () => {
  // Captured from wrapText and rows before widths were measured in display columns: English words and emoji that were
  // already two units wide measure the same.
  const text = 'Ship it 🚀 now: the ✓ check passed, so the retry 🎉 is safe to push and \u{26A0}\u{FE0F} nothing else is waiting on you.';
  assert.equal(wrapText(text, 30, '  '), '  Ship it 🚀 now: the ✓ check\n  passed, so the retry 🎉 is\n  safe to push and \u{26A0}\u{FE0F} nothing\n  else is waiting on you.');
  const output = capture();
  output.ui.rows([['Rocket 🚀', 'Ships the 🎉 release once the ✓ check passes and \u{26A0}\u{FE0F} nothing else is waiting on you at all today.'], ['Plain', 'No emoji here.']]);
  assert.equal(output.text(), '  Rocket 🚀   Ships the 🎉 release once the ✓ check passes and \u{26A0}\u{FE0F} nothing else\n              is waiting on you at all today.\n  Plain       No emoji here.\n');
});

test('model progress uses only a live terminal and is suppressed for machine output', async () => {
  const pipe = capture(); await withProgress('Preparing questions', async () => 42, { stream: pipe.stream, env: {} });
  assert.equal(pipe.text(), '');
  const terminal = capture({ tty: true });
  assert.equal(await withProgress('Preparing questions', async () => 42, { stream: terminal.stream, env: {} }), 42);
  assert.match(stripAnsi(terminal.text()), /Preparing questions/);
  const machine = capture({ tty: true });
  await withProgress('Must not print', async () => 42, { stream: machine.stream, env: { FORCE_COLOR: '1' }, enabled: false });
  assert.equal(machine.text(), '');
});

test('plain protocol errors never contain ANSI despite forced color', () => {
  const output = capture({ tty: true });
  formatError(new Error('Unknown option --wat'), { stream: output.stream, env: { FORCE_COLOR: '1' }, plain: true });
  assert.equal(output.text().includes('\x1b'), false);
  assert.match(output.text(), /Sphinx: Unknown option --wat/);
});

test('numbered prompts validate choices and retry without accepting invalid input', async () => {
  const output = capture(), answers = ['99', 'nonsense', '2'];
  const prompts = createPrompts({ ui: output.ui, ask: async () => answers.shift() });
  const result = await prompts.choose({ title: 'Depth', current: 'standard', choices: [
    { value: 'relaxed', label: 'Relaxed', description: 'Up to 2 questions.' },
    { value: 'standard', label: 'Standard', description: 'Up to 3 questions.' },
  ] });
  assert.equal(result, 'standard');
  assert.equal((output.text().match(/Enter a number/g) || []).length, 2);
  assert.match(output.text(), /Standard \(default\)/);
});

test('required choices never accept Enter or display a default', async () => {
  const output = capture(), answers = ['', 'invalid', 'paid'];
  const prompts = createPrompts({ ui: output.ui, ask: async prompt => {
    assert.equal(prompt, '\nChoose: ');
    return answers.shift();
  } });
  assert.equal(await prompts.choose({ title: 'Models', requireSelection: true, current: 'paid', choices: [
    { value: 'paid', label: 'Paid route', description: 'Uses API credits.' },
    { value: 'free', label: 'Free route', description: 'Best effort.' },
  ] }), 'paid');
  assert.equal((output.text().match(/Enter a number/g) || []).length, 2);
  assert.doesNotMatch(output.text(), /default|press Enter/);
});

test('text prompts reject bad routes before returning a valid option', async () => {
  const output = capture(), answers = ['invalid', 'claude:sonnet'];
  const prompts = createPrompts({ ui: output.ui, ask: async () => answers.shift() });
  const value = await prompts.text({ title: 'Route', current: 'codex', validate: input => { if (!input.includes(':')) throw new Error('Use provider:model.'); } });
  assert.equal(value, 'claude:sonnet'); assert.match(output.text(), /Use provider:model/);
});

test('accepting onboarding defaults preserves existing per-tier models and reversed event order', async () => {
  const current = structuredClone(DEFAULT_CONFIG);
  current.maxModelCalls = 12;
  current.agentMaxTurns = 6;
  current.events = ['pre-commit', 'pre-push'];
  current.models = { small: { provider: 'openrouter', model: 'openrouter/free' }, medium: { provider: 'claude', model: 'sonnet' }, large: { provider: 'codex', model: 'custom-model' } };
  const output = capture();
  const values = await askInstall(current, {}, createPrompts({ ui: output.ui, ask: async () => '' }), { hasExistingConfig: true });
  const updated = applyInstallOptions(current, values);
  assert.deepEqual(updated.models, current.models);
  assert.deepEqual(updated.events, current.events);
  assert.equal(updated.maxModelCalls, 12);
  assert.equal(updated.agentMaxTurns, 6);
  assert.match(output.text().replace(/\s+/g, ' '), /no model-call cap by default/);
  assert.deepEqual(current.models.large, { provider: 'codex', model: 'custom-model' });
});

test('agent checkboxes accept arbitrary combinations, preselect detection, and skip when flags are explicit', async () => {
  const initial = { provider: 'claude', events: 'pre-push', branches: 'main', remotes: '*', level: 'standard', distance: 'high', mode: 'block' };
  let selections = 0;
  const output = capture();
  const prompts = createPrompts({ ui: output.ui, ask: () => assert.fail('other choices were supplied'), select: async options => {
    selections++;
    assert.equal(options.title, 'Which coding agents do you use?');
    assert.equal(options.description, 'Connect any combination. Detected agents are preselected; clear all for Git-only use. Previously connected agents remain installed.');
    assert.deepEqual(options.current, ['claude', 'pi']);
    assert.deepEqual(options.choices.map(choice => choice.value), ['codex', 'claude', 'pi', 'cursor', 'opencode']);
    return ['pi', 'cursor', 'opencode'];
  } });
  const result = await askInstall(DEFAULT_CONFIG, initial, prompts, { detectedAgents: ['claude', 'pi'], platform: 'linux' });
  assert.equal(result.agents, 'pi,cursor,opencode');
  assert.doesNotThrow(() => applyInstallOptions(DEFAULT_CONFIG, result));
  for (const agents of ['auto', 'none', 'codex,pi']) assert.equal((await askInstall(DEFAULT_CONFIG, { ...initial, agents }, prompts, { platform: 'linux' })).agents, agents);
  assert.equal(selections, 1);
  const cleared = await askInstall(DEFAULT_CONFIG, initial, { multiselect: async () => [] }, { platform: 'linux' });
  assert.equal(cleared.agents, 'none');
});

test('on Windows, guided setup offers only Claude Code, preselected only when already connected', async () => {
  const initial = { provider: 'claude', events: 'pre-push', branches: 'main', remotes: '*', level: 'standard', distance: 'high', mode: 'block' };
  const current = [], descriptions = [];
  let chosen = [];
  const prompts = createPrompts({ ui: capture().ui, ask: () => assert.fail('other choices were supplied'), select: async options => {
    assert.deepEqual(options.choices.map(choice => choice.value), ['claude']);
    current.push(options.current);
    descriptions.push(options.description);
    return chosen;
  } });
  // Another connected agent never preselects Claude Code, and clearing the box leaves Git hooks only.
  assert.equal((await askInstall(DEFAULT_CONFIG, initial, prompts, { detectedAgents: ['codex'], platform: 'win32' })).agents, 'none');
  chosen = ['claude'];
  assert.equal((await askInstall(DEFAULT_CONFIG, initial, prompts, { detectedAgents: ['claude', 'codex'], platform: 'win32' })).agents, 'claude');
  assert.deepEqual(current, [[], ['claude']]);
  // One choice is not "any combination", and nothing is detected there: the text says what Windows does.
  const onWindows = 'On Windows, Sphinx connects Claude Code only. It is preselected when already connected; clear it for Git-only use. A connected integration stays installed.';
  assert.deepEqual(descriptions, [onWindows, onWindows]);
});

test('checkbox line fallback toggles any agents and all without accepting partially invalid input', async () => {
  const choices = ['codex', 'claude', 'pi', 'cursor', 'opencode'].map(value => ({ value, label: value, description: '' }));
  const output = capture({ width: 40 });
  const answers = ['codex,invalid', '1', '6', ''];
  const selected = await createPrompts({ ui: output.ui, ask: async () => answers.shift() }).multiselect({ title: 'Agents', choices, current: ['codex'] });
  assert.deepEqual(selected, ['codex', 'claude', 'pi', 'cursor']);
  assert.match(output.text(), /1\. \[-\] All supported agents/);
  assert.match(output.text(), /1\. \[x\] All supported agents/);
  assert.match(output.text(), /Choose numbers/);
  assert.ok(output.text().split('\n').every(line => stripAnsi(line).length <= 40));
  const none = ['all', 'none', ''];
  assert.deepEqual(await createPrompts({ ui: output.ui, ask: async () => none.shift() }).multiselect({ title: 'Agents', choices }), []);
});

test('onboarding keeps intentionally empty branches and remotes on Enter', async () => {
  const current = { ...structuredClone(DEFAULT_CONFIG), branches: [], remotes: [], events: [] };
  const output = capture();
  const values = await askPolicy(current, {}, createPrompts({ ui: output.ui, ask: async () => '' }));
  const updated = applyInstallOptions(current, values);
  assert.deepEqual(updated.events, []); assert.deepEqual(updated.branches, []); assert.deepEqual(updated.remotes, []);
});

test('explicit model flags alter only their requested routes and reject invalid settings before setup', () => {
  const config = structuredClone(DEFAULT_CONFIG);
  const updated = applyInstallOptions(config, { large: 'claude:opus' });
  assert.deepEqual(updated.models.small, config.models.small);
  assert.deepEqual(updated.models.large, { provider: 'claude', model: 'opus' });
  const all = applyInstallOptions(config, { provider: 'codex' });
  for (const route of Object.values(all.models)) assert.deepEqual(route, { provider: 'codex', model: 'gpt-6-luna' });
  assert.throws(() => applyInstallOptions(config, { agents: 'unknown' }), /--agents/);
  assert.throws(() => applyInstallOptions(config, { large: 'openrouter:paid-model' }), /allow-paid/);
  assert.throws(() => applyInstallOptions(config, { level: 'anything' }), /level/);
});

test('guided setup defers branch, remote, and depth questions unless the human customizes', async () => {
  const output = capture(), answers = ['2', '', 'release/*', 'origin', 'thorough', 'low'];
  const values = await askInstall(DEFAULT_CONFIG, { agents: 'none', preset: 'claude-economy' }, createPrompts({ ui: output.ui, ask: async () => answers.shift() }), { hasExistingConfig: false });
  assert.match(output.text().replace(/\s+/g, ' '), /Before pushes to main, master on any remote, at standard depth, mixed questions\./);
  assert.match(output.text(), /When should Sphinx run\?/);
  assert.deepEqual(applyInstallOptions(DEFAULT_CONFIG, values).branches, ['release/*']);
  assert.equal(values.level, 'thorough');
  assert.equal(values.distance, 'low', 'Customizing also asks how close to the code questions get');
  const kept = await askInstall(DEFAULT_CONFIG, { agents: 'none', preset: 'claude-economy' }, createPrompts({ ui: capture().ui, ask: async () => '' }), { hasExistingConfig: false });
  assert.deepEqual(applyInstallOptions(DEFAULT_CONFIG, kept).branches, DEFAULT_CONFIG.branches);
  assert.equal(kept.events, undefined);
});

const onboardingPolicy = { events: 'pre-push', branches: 'main', remotes: '*', level: 'standard', distance: 'high', mode: 'block' };

test('fresh onboarding asks agents first, recommends economical CLI models, then offers recommended checkpoints', async () => {
  for (const agent of ['codex', 'claude']) {
    const order = [];
    const values = await askInstall(DEFAULT_CONFIG, {}, {
      multiselect: async options => { order.push(options.title); return [agent]; },
      choose: async options => { order.push(options.title); assert.equal(options.requireSelection ?? false, false); return options.current; },
      text: async options => { order.push(options.title); return options.current; },
    }, { hasExistingConfig: false, platform: 'linux' });
    assert.deepEqual(order, ['Which coding agents do you use?', 'Choose your evaluator models', 'When should Sphinx check your understanding?']);
    for (const key of ['events', 'branches', 'remotes', 'level']) assert.equal(values[key], undefined);
    assert.equal(values.agents, agent);
    assert.equal(values.preset, `${agent}-economy`);
    for (const tier of ['small', 'medium', 'large']) assert.equal(values[tier], presetOptions(`${agent}-economy`)[tier]);
    assert.equal(values['allow-paid'], undefined);
    const configured = applyInstallOptions(DEFAULT_CONFIG, values);
    assert.equal(configured.provider, agent);
    assert.equal(configured.model, configured.models.small.model);
    const next = applyInstallOptions(configured, { model: 'custom-followup-model' });
    for (const route of Object.values(next.models)) assert.deepEqual(route, { provider: agent, model: 'custom-followup-model' });
  }
});

test('fresh auto agent selection uses detection for the economical evaluator default', async () => {
  const values = await askInstall(DEFAULT_CONFIG, { ...onboardingPolicy, agents: 'auto' }, {
    choose: async options => { assert.equal(options.current, 'claude-economy'); return options.current; },
  }, { hasExistingConfig: false, detectedAgents: ['claude', 'pi'], platform: 'linux' });
  assert.equal(values.small, presetOptions('claude-economy').small);
});

test('other integrations require a deliberate evaluator choice and paid presets enable only their chosen routes', async () => {
  for (const agents of ['pi', 'cursor', 'opencode', 'pi,cursor,opencode', 'none']) {
    const output = capture(), answers = ['', 'openrouter-value'];
    const values = await askInstall(DEFAULT_CONFIG, { ...onboardingPolicy, agents }, createPrompts({ ui: output.ui, ask: async () => answers.shift() }), { hasExistingConfig: false });
    assert.match(output.text(), /Enter a number/);
    assert.doesNotMatch(output.text(), /\(default\)/);
    assert.match(output.text(), /choosing one enables paid requests/);
    assert.equal(values['allow-paid'], true);
    for (const tier of ['small', 'medium', 'large']) assert.equal(values[tier], presetOptions('openrouter-value')[tier]);
    assert.equal(values.agents, agents);
  }
});

test('explicit preset and route flags skip the evaluator picker and remain authoritative', async () => {
  for (const flags of [{ preset: 'claude-economy' }, { provider: 'codex' }, { model: 'custom-model' }, { small: 'claude:haiku', medium: 'codex:custom-model', large: 'openrouter:vendor/model:free' }]) {
    const initial = { ...onboardingPolicy, agents: 'none', ...flags };
    const values = await askInstall(DEFAULT_CONFIG, initial, {
      choose: () => assert.fail('explicit routes must skip the evaluator picker'),
      multiselect: () => assert.fail('explicit agents must skip checkboxes'),
      text: () => assert.fail('explicit policy must skip text prompts'),
    }, { hasExistingConfig: false });
    assert.deepEqual(values, initial);
  }
});

test('partial tier flags preserve saved defaults but require a choice for fresh unset tiers', async () => {
  const initial = { ...onboardingPolicy, agents: 'claude', small: 'codex:custom-small' };
  assert.deepEqual(await askInstall(DEFAULT_CONFIG, initial, {
    choose: () => assert.fail('saved remaining tiers must stay unchanged'),
  }, { hasExistingConfig: true }), initial);
  let choices = 0;
  const values = await askInstall(DEFAULT_CONFIG, initial, {
    choose: async options => { choices++; assert.equal(options.current, 'claude-economy'); return options.current; },
  }, { hasExistingConfig: false, platform: 'linux' });
  assert.equal(choices, 1);
  const configured = applyInstallOptions(DEFAULT_CONFIG, values);
  assert.deepEqual(configured.models.small, { provider: 'codex', model: 'custom-small' });
  for (const tier of ['medium', 'large']) assert.deepEqual(configured.models[tier], { provider: 'claude', model: 'haiku' });
});

test('fresh partial tiers retain overrides when deliberately selecting a paid preset', async () => {
  const values = await askInstall(DEFAULT_CONFIG, { ...onboardingPolicy, agents: 'none', large: 'claude:haiku' }, {
    choose: async () => 'openrouter-value',
  }, { hasExistingConfig: false });
  assert.equal(values.large, 'claude:haiku');
  assert.equal(values['allow-paid'], true);
  const configured = applyInstallOptions(DEFAULT_CONFIG, values);
  assert.equal(configured.allowPaid, true);
  for (const tier of ['small', 'medium']) assert.equal(configured.models[tier].provider, 'openrouter');
  assert.deepEqual(configured.models.large, { provider: 'claude', model: 'haiku' });
});

test('custom selection asks only for missing tiers and includes explicit paid tiers in consent', async () => {
  const asked = [];
  let permissions = 0;
  const values = await askInstall(DEFAULT_CONFIG, { ...onboardingPolicy, agents: 'none', small: 'openrouter:vendor/paid-model' }, {
    choose: async options => {
      if (options.title === 'Enable paid OpenRouter requests?') { permissions++; return 'allow'; }
      return 'custom';
    },
    text: async options => { asked.push(options.title); return 'claude:haiku'; },
  }, { hasExistingConfig: false });
  assert.deepEqual(asked, ['Evaluator for medium changes', 'Evaluator for large changes']);
  assert.equal(values.small, 'openrouter:vendor/paid-model');
  assert.equal(values.medium, 'claude:haiku');
  assert.equal(values.large, 'claude:haiku');
  assert.equal(permissions, 1);
  assert.equal(values['allow-paid'], true);
});

test('custom paid routes default back to model choice without enabling spending', async () => {
  let picks = 0;
  const values = await askInstall(DEFAULT_CONFIG, { ...onboardingPolicy, agents: 'none' }, {
    choose: async options => {
      if (options.title === 'Enable paid OpenRouter requests?') { assert.equal(options.current, 'back'); return options.current; }
      return picks++ === 0 ? 'custom' : 'openrouter-free';
    },
    text: async () => 'openrouter:vendor/paid-model',
  }, { hasExistingConfig: false });
  assert.equal(picks, 2);
  assert.equal(values['allow-paid'], undefined);
  for (const tier of ['small', 'medium', 'large']) assert.equal(values[tier], 'openrouter:openrouter/free');
});

test('custom paid routes require explicit permission unless machine-wide permission already exists', async () => {
  for (const allowed of [false, true]) {
    let permissions = 0;
    const values = await askInstall({ ...DEFAULT_CONFIG, allowPaid: allowed }, { ...onboardingPolicy, agents: 'none' }, {
      choose: async options => {
        if (options.title === 'Enable paid OpenRouter requests?') { permissions++; return 'allow'; }
        return 'custom';
      },
      text: async () => 'openrouter:vendor/paid-model',
    });
    assert.equal(permissions, allowed ? 0 : 1);
    assert.equal(values['allow-paid'], allowed ? undefined : true);
    for (const tier of ['small', 'medium', 'large']) assert.equal(values[tier], 'openrouter:vendor/paid-model');
  }
});

test('setup recommends an installed coding plan even when the user works in another agent', async () => {
  let seen;
  const values = await askInstall(DEFAULT_CONFIG, { agents: 'cursor', ...onboardingPolicy }, {
    choose: async options => { if (options.title === 'Choose your evaluator models') seen = options; return options.current; },
    multiselect: async () => [], text: async options => options.current,
  }, { hasExistingConfig: false, installedPlans: ['claude'] });
  assert.equal(seen.current, 'claude-economy');
  assert.equal(seen.choices[0].value, 'claude-economy');
  assert.match(seen.choices[0].label, /\(recommended\)/);
  assert.equal(values.preset, 'claude-economy');
  assert.ok(seen.choices.some(choice => /free router \(slow, best effort\)/.test(choice.label)));
});

test('on Windows, guided setup recommends a reviewer CLI only when Windows can start it', async () => {
  // Claude Code is the only agent offered there, but the CLI behind it may be an npm shim that cannot start.
  const modelPicker = async (installedPlans, platform) => {
    let seen;
    await askInstall(DEFAULT_CONFIG, onboardingPolicy, {
      multiselect: async () => ['claude'],
      choose: async options => { if (options.title === 'Choose your evaluator models') seen = options; return options.current ?? 'openrouter-free'; },
    }, { hasExistingConfig: false, installedPlans, platform });
    return seen;
  };
  const nothingFound = 'On Windows, the Claude Code and Codex presets need claude.exe or codex.exe from the native installers, and none was found; choose OpenRouter or install one first.';
  // An npm-only install leaves planProviders empty: nothing is recommended or preselected for Enter,
  // and the picker says why instead of leaving an unexplained empty default.
  const npmOnly = await modelPicker([], 'win32');
  assert.equal(npmOnly.current, undefined);
  assert.equal(npmOnly.requireSelection, true);
  assert.ok(npmOnly.choices.every(choice => !/\(recommended\)/.test(choice.label)));
  assert.ok(npmOnly.description.endsWith(` ${nothingFound}`), npmOnly.description);
  // Only codex.exe starts: recommend that, not the Claude Code the user connects.
  const codexOnly = await modelPicker(['codex'], 'win32');
  assert.equal(codexOnly.current, 'codex-economy');
  assert.equal(codexOnly.choices[0].value, 'codex-economy');
  assert.match(codexOnly.choices[0].label, /\(recommended\)/);
  // claude.exe starts: the agent the user works in stays the recommendation.
  for (const plans of [['claude'], ['claude', 'codex']]) assert.equal((await modelPicker(plans, 'win32')).current, 'claude-economy');
  // The note appears only when no runnable CLI was found, and never on other systems.
  for (const seen of [codexOnly, await modelPicker(['claude'], 'win32'), await modelPicker([], 'linux'), await modelPicker([], 'darwin')]) assert.ok(!seen.description.includes('none was found'), seen.description);
  // Other systems still trust the agent the user selected.
  assert.equal((await modelPicker([], 'linux')).current, 'claude-economy');
});

test('install preselects the system language only for a first setup', () => {
  assert.equal(installLanguage({ hasExistingConfig: false, current: { language: 'en' }, system: 'ko' }), 'ko');
  assert.equal(installLanguage({ hasExistingConfig: true, current: { language: 'en' }, system: 'ko' }), 'en');
});

test('languageQuestion offers English and Korean with the given default', async () => {
  assert.deepEqual(languageQuestion('ko'), {
    title: 'Which language should questionnaires use?',
    description: 'Questions, feedback, and questionnaire screens use this language, including questions quoted in GitHub comments. Other command output, Git hook messages, and Sphinx\'s own GitHub text stay in English. Change it later with sphinx config --language.',
    current: 'ko',
    choices: [
      { value: 'en', label: 'English', description: 'Questions and questionnaire screens in English.' },
      { value: 'ko', label: '한국어 (Korean)', description: 'Questions and questionnaire screens in Korean. Code, file paths, and Git terms stay as they are.' },
    ],
  });
  // Enter takes the given default.
  const output = capture();
  assert.equal(await createPrompts({ ui: output.ui, ask: async () => '' }).choose(languageQuestion('en')), 'en');
  assert.match(output.text(), /1\. English \(default\)/);
});

test('the install language question fits the terminal and aligns its descriptions at every width', async () => {
  // Measured with .length, the Korean row ('2. 한국어 (Korean) (default)') overflowed at widths 27-29, 68-70, 76-78,
  // 82-84, 87-89, 94-96 and 98-100, and its description started three columns right of the English row.
  for (const current of ['en', 'ko']) {
    for (let width = 20; width <= 100; width++) {
      const output = capture({ width });
      assert.equal(await createPrompts({ ui: output.ui, ask: async () => '' }).choose(languageQuestion(current)), current);
      assert.ok(fits(output.text(), width), `${current} at ${width}:\n${output.text()}`);
      if (width < 68) continue;
      const lines = output.text().split('\n');
      const english = lines.find(line => line.includes('1. English')), korean = lines.find(line => line.includes('2. 한국어'));
      assert.equal(startColumn(korean, 'Questions'), startColumn(english, 'Questions'), `${current} at ${width}: the descriptions align\n${output.text()}`);
    }
  }
});
