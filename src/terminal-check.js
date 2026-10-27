import path from 'node:path';
import { readStats, scoreSummary } from './stats.js';
import { prepareInteractiveCheck } from './check-recovery.js';
import { fallbackText, savedDraft } from './sessions.js';
import { VERSION } from './version.js';
import { chunks, displayWidth, wrapText } from './terminal.js';
import { localize, msg, t } from './i18n.js';

// The terminal questionnaire: the same check as the browser page, laid out for
// a terminal. Used by `sphinx check` and when Git asks inline in a headless
// session. Model text is printed as plain text; it never sets terminal state.
// Sphinx's own words are drawn in the questionnaire language; commands stay English.
const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const LEARN = 'I do not know. Explain this concept and give me a different scenario to apply it to.';
// Strip control characters from model text so it cannot move the cursor or recolor the terminal.
const plain = text => String(text ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
const PROVIDERS = { openrouter: 'OpenRouter', openai: 'Endpoint', claude: 'Claude Code', codex: 'Codex' };
const routeText = route => route?.provider ? [PROVIDERS[route.provider] || route.provider, route.model].filter(Boolean).join(' ') : '';
const count = n => Number(n || 0).toLocaleString('en-US');
// Answers accepted in every language. ㅊ, ㅛ, ㄴ and ㅜ are c, y, s and n typed with the Korean IME on.
// The continue step:
const CONTINUE = ['continue', 'c', 'y', 'yes', 'proceed', '계속', 'ㅊ', 'ㅛ'], STOP = ['stop', 's', 'n', 'no', '/stop', '/quit', '중단', 'ㄴ', 'ㅜ'];
// What goes back from the skip confirmation instead of becoming its reason:
const BACK = ['n', 'no', '아니요', '아니오', '아니', '중단', 'ㅜ'];

/** A note or warning, one row per line of its text; only the first row has the lead, as before. A row that fits the width
 * is written as it is. A longer one breaks only at its spaces, each piece under the row's own text and indentation; the
 * spaces at a break are dropped and all others kept. A word longer than the room is never cut: it stays whole on a row of
 * its own, as before notes wrapped. */
function fit(text, width, lead) {
  return String(text).split('\n').map((row, index) => {
    const head = index ? '' : lead;
    if (displayWidth(head + row) <= width) return head + row;
    const own = row.match(/^\s*/u)[0], under = ' '.repeat(displayWidth(head)) + own;
    const [first, ...rest] = row.slice(own.length).trimEnd().split(/(\s+)/u);
    const lines = [];
    let line = head + own + first;
    for (let i = 0; i < rest.length; i += 2) {
      if (displayWidth(line + rest[i] + rest[i + 1]) <= width) line += rest[i] + rest[i + 1];
      else { lines.push(line); line = under + rest[i + 1]; }
    }
    return [...lines, line].join('\n');
  }).join('\n');
}

/** One status line that redraws in place on a TTY, and prints once otherwise. A label may be a message ref. */
export function createSpinner(stream, style, language = 'en') {
  let timer = null, label = '', started = 0, index = 0;
  const width = () => Math.max(20, (stream.columns || 80) - 4);
  const draw = () => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    const tail = seconds >= 2 ? ` · ${t(language, 'terminal.spinner.elapsed', { seconds })}` : '';
    const room = width() - 2 - displayWidth(tail);
    const text = displayWidth(label) > room ? `${chunks(label, room - 1)[0]}…` : label;
    stream.write(`\r\x1b[2K  ${style.amber(FRAMES[index++ % FRAMES.length])} ${text}${style.muted(tail)}`);
  };
  return {
    start(text) {
      this.stop(); label = plain(localize(text, language)); started = Date.now();
      if (stream.isTTY) { draw(); timer = setInterval(draw, 90); timer.unref?.(); }
      else stream.write(`  ${label}…\n`);
    },
    update(text) { label = plain(localize(text, language)); },
    stop() { if (timer) { clearInterval(timer); timer = null; stream.write('\r\x1b[2K'); } },
  };
}

function scoreLine(score, style, language) {
  if (!score) return '';
  const recent = score.recent || [];
  const slots = score.calibrating ? score.answered + score.needed : Math.max(recent.length, 1);
  const dots = Array.from({ length: slots }, (_, i) => i < recent.length ? (recent[i] ? style.green('●') : style.amber('●')) : style.muted('○')).join('');
  const value = score.calibrating ? style.muted(t(language, 'terminal.score.warmingUp', { needed: score.needed })) : style.strong(`${score.accuracy}%`);
  const extra = !score.calibrating && score.streak > 1 ? style.muted(` · ${t(language, 'terminal.score.streak', { streak: score.streak })}`) : '';
  return `  ${style.muted(t(language, 'terminal.score.label'))}  ${dots}  ${value}${extra}`;
}

/** A line led by a symbol; wrapped lines keep clear of it. */
function mark(terminal, symbol, text) {
  const [first, ...rest] = wrapText(text, terminal.width - 4).split('\n');
  terminal.line(`  ${symbol} ${first}`);
  for (const line of rest) terminal.line(`    ${line}`);
}

/** A quoted block with a left rule, wrapped to the terminal. */
function block(terminal, text, rule) {
  const { style } = terminal;
  for (const line of wrapText(plain(text), terminal.width - 4, '').split('\n')) terminal.line(`  ${rule(style)} ${line}`);
}

// The title on the right is drawn in terminal.language. The gap before it counts display columns, so a Korean title still
// ends at the terminal's edge.
export function printHeader(terminal, { session, score }) {
  const { style, language } = terminal, snapshot = session.snapshot || {};
  const repo = snapshot.repoRoot ? path.basename(snapshot.repoRoot) : '';
  const destination = snapshot.target?.ref ? `${snapshot.target.remote ? `${snapshot.target.remote}/` : ''}${snapshot.target.ref.replace(/^refs\/heads\//, '')}` : '';
  const stats = snapshot.stats ? `${t(language, 'terminal.header.files', { count: snapshot.stats.files, n: count(snapshot.stats.files) })}  ${style.green(`+${count(snapshot.stats.additions)}`)} ${style.amber(`−${count(snapshot.stats.deletions)}`)}` : '';
  const title = `  ${style.amber('◆')} ${style.strong('sphinx')} ${style.muted(`v${VERSION}`)}`;
  const right = style.muted(t(language, 'terminal.header.title'));
  const gap = Math.max(2, terminal.width - displayWidth(title) - displayWidth(right));
  terminal.line('');
  terminal.line(`${title}${' '.repeat(gap)}${right}`);
  const facts = [[repo, destination].filter(Boolean).join(' → '), stats, routeText(session.route)].filter(Boolean);
  if (facts.length) terminal.line(`  ${facts.join(style.muted('  ·  '))}`);
  const line = scoreLine(score, style, language);
  if (line) terminal.line(line);
  terminal.line(style.muted(`  ${'─'.repeat(Math.max(10, terminal.width - 4))}`));
}

// key is terminal.question.number, or the same line marked as a follow-up or as still open.
function printQuestion(terminal, state, key) {
  const { style, language } = terminal;
  terminal.line('');
  terminal.line(`  ${style.strong(t(language, key, { number: state.progress.completed + 1, total: state.progress.total }))}`);
  block(terminal, state.question.prompt, s => s.amber('┃'));
  if (state.question.choices?.length) state.question.choices.forEach((choice, index) => terminal.line(`    ${style.muted(`${index + 1}.`)} ${plain(choice)}`));
  terminal.line('');
}

function commandsLine(terminal, { waitingGit }) {
  const { style, language } = terminal;
  terminal.line(style.muted(`  ${t(language, waitingGit ? 'terminal.commands.lineWaiting' : 'terminal.commands.lineManual')}`));
}

/**
 * Run the check in this terminal. Resolves 0 when passed, 1 when paused,
 * quit, or stopped before a pass, 3 when the human skipped a waiting Git
 * operation, and 4 when they passed and then stopped that waiting operation.
 * With more checks to follow in the same push, a pass does not ask yet.
 */
export async function runTerminalCheck({ store, session, config, ask, terminal: base, stream = process.stdout, signal, waitingGit = false, more = false, planProviders = [], validate, choose, skip, env = process.env }) {
  // Notes, warnings, progress and errors may carry message refs from the shared modules; they are drawn in the
  // questionnaire language as they are printed.
  const language = config.language;
  // Lines keep their own indentation; the shared helpers would rewrap it away. Notes and warnings wrap only a row that
  // does not fit.
  const terminal = { ...base, language, line: text => stream.write(`${text}\n`),
    note: text => stream.write(`${base.style.muted(fit(localize(text, language), base.width, '  '))}\n`),
    warning: text => stream.write(`${fit(localize(text, language), base.width, `  ${base.style.amber('!')} `)}\n`) };
  const { style } = terminal;
  const spinner = createSpinner(stream, style, language);
  const repoRoot = session.snapshot.repoRoot, isCommit = session.snapshot.event === 'pre-commit';
  // While Git waits, quitting stops it; /quit stays as an alias of /stop.
  const stop = waitingGit ? '/stop' : '/quit';
  const score = async () => scoreSummary(await readStats(repoRoot, env));
  printHeader(terminal, { session, score: await score().catch(() => null) });
  // A held pass has nothing left to answer.
  if (!session.held) terminal.line(style.muted(wrapText(t(language, 'terminal.intro.openBook'), terminal.width, '  ')));

  const withSpinner = async (label, operation) => {
    spinner.start(label);
    try { return await operation(); } finally { spinner.stop(); }
  };
  let state;
  try {
    state = await prepareInteractiveCheck({
      config, signal, waitingGit, planProviders, ui: terminal, choose,
      // A pass made while Git waits is saved held: only the Git gate releases it, after
      // continue, so a window that outlives the gate cannot let a retry through.
      start: () => withSpinner(session.held ? t(language, 'terminal.spinner.loadingEarlierPass') : session.questions?.length ? t(language, 'terminal.spinner.loadingPrepared') : t(language, 'terminal.spinner.reviewingWith', { route: routeText(session.route) }), () => store.start(session.id, config, {
        signal, hold: waitingGit, onProgress: text => spinner.update(msg('terminal.spinner.reviewingProgress', { activity: text })),
      })),
      inspect: async () => store.public(await store.read(session.id)),
      authorizeMore: () => store.retryReview(session.id, config, { signal }),
      validate, switchRoute: provider => store.switchRoute(session.id, config, provider, { signal }),
    });
  } finally { spinner.stop(); }
  signal?.throwIfAborted();
  if (!state) return 1;
  // Held when this check opened, the pass was made for a push or commit that did not go through:
  // only the choice to continue remains. (A pass made here is held too, until Git sees continue.)
  if (state.status === 'passed' && session.held) {
    const key = state.noQuestionReason ? (isCommit ? 'terminal.held.noQuestionsCommit' : 'terminal.held.noQuestionsPush') : (isCommit ? 'terminal.held.passedCommit' : 'terminal.held.passedPush');
    terminal.line(''); mark(terminal, style.green('✓'), t(language, key));
    return finish(terminal, { waitingGit, more, ask, isCommit });
  }
  if (state.status === 'passed' && state.noQuestionReason) {
    terminal.line(''); mark(terminal, style.green('✓'), t(language, 'terminal.verdict.noQuestionsNeeded', { reason: plain(localize(fallbackText(state.noQuestionCode, state.noQuestionReason), language)) }));
    return finish(terminal, { waitingGit, more, ask, isCommit });
  }

  let shownId = null, shownNumber = 0, shownDraft = null;
  while (state.status !== 'passed') {
    if (state.question && state.question.id !== shownId) {
      const number = state.progress.completed + 1;
      printQuestion(terminal, state, number === shownNumber ? 'terminal.question.numberFollowUp' : 'terminal.question.number');
      commandsLine(terminal, { waitingGit });
      shownId = state.question.id; shownNumber = number;
    }
    // An answer that was never graded (a provider failure, or a check that
    // stopped) is saved; Enter sends it again instead of retyping it.
    const draft = savedDraft(await store.read(session.id));
    const draftLine = draft && (draft.kind === 'dispute' ? `/dispute ${draft.text}` : draft.text);
    if (draftLine && draftLine !== shownDraft) {
      terminal.note(`${t(language, draft.kind === 'dispute' ? 'terminal.draft.savedDispute' : 'terminal.draft.savedAnswer', { text: plain(draft.text) })}\n${t(language, 'terminal.draft.resend')}`);
      shownDraft = draftLine;
    }
    const answer = plain(await ask(`  ${style.amber('›')} `)).trim() || draftLine || '';
    signal?.throwIfAborted();
    if (!answer) continue;
    if (answer === '/quit' || answer === stop) {
      terminal.line('');
      if (!waitingGit) { terminal.note(t(language, 'terminal.quit.progressSaved')); return 1; }
      mark(terminal, style.amber('‖'), t(language, isCommit ? 'terminal.quit.stoppedCommit' : 'terminal.quit.stoppedPush'));
      terminal.line(style.muted(wrapText(t(language, isCommit ? 'terminal.quit.retryCommit' : 'terminal.quit.retryPush'), terminal.width, '    ')));
      return 1;
    }
    if (answer === '/hint') { await printHint(terminal, store, session.id, state.question.id); continue; }
    if (answer === '/skip') {
      if (!waitingGit || !skip) { terminal.warning(t(language, 'terminal.skip.unavailable')); continue; }
      const reason = plain(await ask(`  ${style.muted(t(language, 'terminal.skip.prompt'))} `)).trim();
      if (BACK.includes(reason.toLowerCase())) continue;
      await skip(reason || undefined);
      terminal.line(''); terminal.line(`  ${style.amber('↷')} ${t(language, 'terminal.skip.done')}`);
      return 3;
    }
    const dispute = answer.startsWith('/dispute '), learn = answer === '/learn';
    if (answer === '/dispute') { terminal.warning(t(language, 'terminal.commands.disputeNeedsReason')); continue; }
    if (answer.startsWith('/') && !dispute && !learn) { terminal.warning(t(language, waitingGit ? 'terminal.commands.unknownWaiting' : 'terminal.commands.unknownManual')); continue; }
    const previous = state;
    try {
      state = await withSpinner(t(language, learn ? 'terminal.spinner.explaining' : dispute ? 'terminal.spinner.reviewingQuestion' : 'terminal.spinner.checking'), () => store.answer(session.id, learn ? LEARN : dispute ? answer.slice(9) : answer, config, { dispute, learn, expectedQuestionId: previous.question.id, signal, hold: waitingGit }));
    } catch (error) {
      // Like the browser: a failed grade leaves the same question open. Only cancelling ends the check.
      if (signal?.aborted || ['SPHINX_CANCELLED', 'EVALUATOR_CANCELLED'].includes(error?.code) || error?.name === 'AbortError') throw error;
      terminal.line('');
      terminal.warning(t(language, 'terminal.error.notThrough', { message: plain(localize(error.ref ?? error.message, language)) }));
      terminal.note(t(language, waitingGit ? 'terminal.error.keptWaiting' : 'terminal.error.keptManual'));
      state = previous;
      continue;
    }
    signal?.throwIfAborted();
    printVerdict(terminal, state, { learn, dispute });
    // Without a usable new question the same one stays open; show it again below the explanation.
    if (state.status !== 'passed' && state.question?.id === previous.question.id) printQuestion(terminal, state, 'terminal.question.numberStillOpen');
  }
  terminal.line('');
  terminal.line(`  ${style.green('✓')} ${style.strong(t(language, 'terminal.done.complete'))}`);
  const final = await score().catch(() => null);
  const line = scoreLine(final, style, language);
  if (line) terminal.line(line);
  return finish(terminal, { waitingGit, more, ask, isCommit });
}

// After a pass, a waiting Git operation goes through only when the human says so.
async function finish(terminal, { waitingGit, more, ask, isCommit }) {
  const { style, language } = terminal;
  if (waitingGit && !more) {
    terminal.line('');
    terminal.line(`  ${style.strong(t(language, isCommit ? 'terminal.consent.continueCommit' : 'terminal.consent.continuePush'))}`);
    terminal.line(style.muted(wrapText(t(language, isCommit ? 'terminal.consent.explainCommit' : 'terminal.consent.explainPush'), terminal.width, '  ')));
    for (;;) {
      const choice = plain(await ask(`  ${style.amber('›')} ${t(language, 'terminal.consent.prompt')} `)).trim().toLowerCase();
      if (CONTINUE.includes(choice)) break;
      if (STOP.includes(choice)) {
        terminal.line('');
        mark(terminal, style.amber('‖'), t(language, isCommit ? 'terminal.consent.stoppedCommit' : 'terminal.consent.stoppedPush'));
        terminal.line('');
        return 4;
      }
      terminal.warning(t(language, 'terminal.consent.retry'));
    }
  }
  const done = !waitingGit ? 'terminal.done.approvalSaved' : !more ? 'terminal.done.gitContinuing' : isCommit ? 'terminal.done.moreCommit' : 'terminal.done.morePush';
  terminal.line(style.muted(wrapText(t(language, done), terminal.width, '  ')));
  terminal.line('');
  return 0;
}

function printVerdict(terminal, state, { learn, dispute }) {
  const { style, language } = terminal;
  // Sphinx's own fallback feedback arrives in English beside a code; model feedback is shown as it is.
  const feedback = localize(fallbackText(state.feedbackCode, state.feedback), language);
  terminal.line('');
  if (state.verdict === 'correct') { terminal.line(`  ${style.green('✓')} ${t(language, 'terminal.verdict.correct')}`); if (feedback) block(terminal, feedback, s => s.muted('│')); return; }
  const heading = learn ? `${style.amber('◇')} ${t(language, 'terminal.verdict.learn')}` : dispute ? `${style.amber('◇')} ${t(language, 'terminal.verdict.dispute')}`
    : state.verdict === 'ambiguous' ? `${style.amber('?')} ${t(language, 'terminal.verdict.ambiguous')}` : `${style.amber('✗')} ${t(language, 'terminal.verdict.incorrect')}`;
  terminal.line(`  ${heading}`);
  if (feedback) block(terminal, feedback, s => s.muted('│'));
}

async function printHint(terminal, store, id, questionId) {
  const { style, language } = terminal;
  // Only the cited file paths: evidence reasons can give the answer away.
  const session = await store.read(id).catch(() => null);
  const question = session?.questions?.find(item => item.id === questionId);
  const paths = [...new Set((question?.evidence || []).map(item => item.path).filter(Boolean))];
  terminal.line('');
  if (!paths.length) { terminal.note(t(language, 'terminal.hint.noFiles')); return; }
  terminal.line(`  ${style.muted(t(language, 'terminal.hint.lookAt'))}`);
  for (const file of paths) terminal.line(`    ${style.amber(plain(file))}`);
  terminal.line('');
}

