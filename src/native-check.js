import { loadConfig, policyHash } from './config.js';
import { revalidateSnapshot } from './git.js';
import { createSessionStore, fallbackText, savedDraft } from './sessions.js';
import { listPresentations, claimPresentation } from './presentations.js';
import { claimCheckpointDialog, finishCheckpointDialog } from './terminal-launch.js';
import { modelUsageRef } from './usage.js';
import { localize, msg, t } from './i18n.js';

const LEARN_REQUEST = 'I do not know. Explain this concept and give me a different scenario to apply it to.';
const ACTIONS = ['answer', 'learn', 'dispute', 'pause'];
// Failures that sending the same response again cannot change.
const SETUP_FAILURES = ['CONTEXT_LIMIT', 'INVALID_CONFIG', 'INVALID_SNAPSHOT', 'INVALID_REVIEW'];

// Draws Sphinx's words, the notice ref and Sphinx's own feedback sentences in the questionnaire language; the action
// values stay English. The form carries language for Pi's labels; MCP sends only message and requestedSchema.
function formFor(state, notice, repoRoot, draft, action, language = 'en') {
  const question = state.question;
  const lines = [
    t(language, 'form.header.progress', { n: state.progress.completed + 1, total: state.progress.total }),
    t(language, 'form.header.repository', { path: repoRoot }),
    t(language, 'form.header.destination', { target: state.target }),
    ...(state.usage ? [localize(modelUsageRef(state.usage, state.tokens), language)] : []),
    ...(notice ? [`\n${localize(notice, language)}`] : []),
    ...(state.feedback ? [`\n${t(language, 'form.body.previousFeedback')}\n${localize(fallbackText(state.feedbackCode, state.feedback), language)}`] : []),
    `\n${question.prompt}`,
    ...(question.choices?.length ? [`\n${t(language, 'form.body.options')}\n${question.choices.map(choice => `- ${choice}`).join('\n')}`] : []),
    `\n${t(language, 'form.body.instructions')}`,
  ];
  return {
    message: lines.join('\n'),
    requestedSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', title: t(language, 'form.schema.actionTitle'), enum: ACTIONS, default: action ?? draft?.kind ?? 'answer' },
        response: { type: 'string', title: t(language, 'form.schema.responseTitle'), description: t(language, 'form.schema.responseDescription'), maxLength: 8000, ...(draft ? { default: draft.text } : {}) },
      },
      required: ['action'],
    },
    language,
  };
}

function formResponse(result) {
  if (!result || !['accept', 'decline', 'cancel'].includes(result.action)) return { invalid: true };
  if (result.action !== 'accept') return { action: 'pause' };
  const content = result.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)
    || Object.keys(content).some(key => !['action', 'response'].includes(key))
    || !ACTIONS.includes(content.action)) return { invalid: true };
  if (content.response !== undefined && typeof content.response !== 'string') return { invalid: true };
  if ((content.response?.length || 0) > 8000) return { invalid: true };
  if (['answer', 'dispute'].includes(content.action) && !content.response?.trim()) return { invalid: true };
  return { action: content.action, response: content.response?.trim() };
}

const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
function checkpointSummary(id, state, status) {
  return {
    id, status,
    progress: { completed: number(state?.progress?.completed), total: number(state?.progress?.total) },
    usage: { calls: number(state?.usage?.calls), limit: state?.usage?.limit === null ? null : number(state?.usage?.limit) },
  };
}
function summary(status, checkpoints = []) {
  return {
    status, checkpoints,
    completed: checkpoints.reduce((sum, checkpoint) => sum + checkpoint.progress.completed, 0),
    total: checkpoints.reduce((sum, checkpoint) => sum + checkpoint.progress.total, 0),
    calls: checkpoints.reduce((sum, checkpoint) => sum + checkpoint.usage.calls, 0),
  };
}

/** Runs only Git-created presentation requests. Human answers arrive solely through elicitation. */
export async function runNativeCheckpoint({
  cwd, host, hookEvent, hostSession, env = process.env, elicit, supportsForm = false, signal,
  store: providedStore, listRequests = listPresentations, claimRequest = claimPresentation,
  readConfig = loadConfig, revalidate = revalidateSnapshot,
  reserveDialog = claimCheckpointDialog, releaseDialog = finishCheckpointDialog,
} = {}) {
  if (env.SPHINX_EVALUATOR === '1') return summary('not-required');
  const checkpoints = [];
  let requests;
  try {
    signal?.throwIfAborted();
    requests = await listRequests({ cwd, host, hookEvent, hostSession, env });
  } catch { return summary(signal?.aborted ? 'pending' : 'error'); }
  if (!requests.length) return summary('not-required');
  if (!supportsForm || typeof elicit !== 'function') return summary('unsupported');

  // Consume this Git attempt as one batch. Pausing should not reopen its remaining
  // destinations on the next shell command; another Git attempt queues fresh tokens.
  const claimed = [];
  try {
    for (const request of requests) {
      signal?.throwIfAborted();
      if (!/^[a-f0-9]{64}$/.test(request.id) || typeof request.repoRoot !== 'string') throw new Error('Invalid presentation request.');
      if (await claimRequest(request, { env })) claimed.push(request);
    }
  } catch { return summary(signal?.aborted ? 'pending' : 'error'); }

  async function validate(snapshot, config) {
    signal?.throwIfAborted();
    const current = await readConfig(snapshot.repoRoot, env);
    if (policyHash(current) !== policyHash(config) || !(await revalidate(snapshot, current, { env }))) {
      throw new Error('The code or policy changed. Retry the Git operation.');
    }
    signal?.throwIfAborted();
  }
  const store = providedStore || createSessionStore({ env, validate });

  for (const request of claimed) {
    let state, reservation;
    let reservationStatus = 'pending';
    try {
      signal?.throwIfAborted();
      const session = await store.read(request.id);
      if (session.id !== request.id || session.snapshot.repoRoot !== request.repoRoot) throw new Error('The request does not match its assessment.');
      const config = await readConfig(session.snapshot.repoRoot, env);
      await validate(session.snapshot, config);
      reservation = await reserveDialog({ request, env });
      signal?.throwIfAborted();
      if (reservation?.status !== 'claimed') return summary('busy', checkpoints);
      state = await store.start(request.id, config, { signal });
      signal?.throwIfAborted();
      let notice, retryAction;
      let invalidResponses = 0, gradingFailures = 0;
      while (state.status !== 'passed') {
        if (!state.question?.id) throw new Error('The assessment has no current question.');
        const expectedQuestionId = state.question.id;
        const response = formResponse(await elicit(formFor(state, notice, session.snapshot.repoRoot, savedDraft(await store.read(request.id)), retryAction, config.language)));
        signal?.throwIfAborted();
        if (response.invalid) {
          if (++invalidResponses >= 3) throw new Error('The form did not contain a valid response.');
          notice = msg('form.notice.invalidResponse');
          continue;
        }
        notice = retryAction = undefined;
        invalidResponses = 0;
        if (response.action === 'pause') {
          checkpoints.push(checkpointSummary(request.id, state, 'pending'));
          return summary('pending', checkpoints);
        }
        // Re-read state and policy after the dialog; the store checks the question ID again under its lock.
        const current = await store.read(request.id);
        if (current.questions[current.index]?.id !== expectedQuestionId && current.status !== 'passed') throw new Error('The question changed.');
        await validate(current.snapshot, config);
        try {
          state = await store.answer(request.id, response.action === 'learn' ? LEARN_REQUEST : response.response, config, {
            expectedQuestionId, signal, learn: response.action === 'learn', dispute: response.action === 'dispute',
          });
        } catch (error) {
          // Like the browser and terminal, an ungraded response keeps the question open. Cancellation, a stale question,
          // a failure a resend cannot change, a code or policy change, a spent call allowance, or a third failure in a row
          // still ends the dialog.
          if (signal?.aborted || ['SPHINX_STALE_QUESTION', ...SETUP_FAILURES].includes(error?.code) || ++gradingFailures >= 3) throw error;
          await validate(current.snapshot, config);
          // Reload, so the next form and a pause count the calls the failed attempt used.
          const saved = await store.read(request.id);
          state = store.public(saved);
          if (state.usage.limit !== null && state.usage.calls >= state.usage.limit) throw error;
          // Promise a kept draft only when the store saved this response; an explanation request saves none.
          const draft = savedDraft(saved);
          if (response.action === 'learn') { notice = msg('form.notice.explanationFailed'); retryAction = 'learn'; }
          else notice = msg(draft?.kind === response.action && draft.text === response.response ? 'form.notice.draftKept' : 'form.notice.notSaved');
          continue;
        }
        gradingFailures = 0;
        signal?.throwIfAborted();
      }
      // A receipt is reported only while its exact source and current policy still match.
      await validate((await store.read(request.id)).snapshot, config);
      reservationStatus = 'passed';
      checkpoints.push(checkpointSummary(request.id, state, 'passed'));
    } catch {
      // Reading usage is safe, but no evaluator error, question, answer, or feedback crosses the tool boundary.
      if (/^[a-f0-9]{64}$/.test(request.id)) {
        try { state = store.public(await store.read(request.id)); } catch { /* Retain the last known counters. */ }
        checkpoints.push(checkpointSummary(request.id, state, signal?.aborted ? 'pending' : 'error'));
      }
      return summary(signal?.aborted ? 'pending' : 'error', checkpoints);
    } finally {
      if (reservation?.status === 'claimed') {
        // Release even when cancelled. The waiting Git hook independently checks
        // its receipt and snapshot; this record only tells it the dialog ended.
        await releaseDialog({ id: request.id, token: reservation.token, status: reservationStatus, env });
      }
    }
  }
  return summary(checkpoints.length ? 'passed' : 'not-required', checkpoints);
}
