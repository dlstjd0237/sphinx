import { questionLimit } from './routing.js';
import { modelUsageRef } from './usage.js';
import { join, msg } from './i18n.js';

const setupCodes = new Set(['INVALID_CONFIG', 'INVALID_SNAPSHOT', 'STALE_SNAPSHOT', 'CONTEXT_LIMIT', 'TOOL_RESULT_LIMIT', 'OUTPUT_LIMIT', 'PROVIDER_NOT_FOUND', 'PROVIDER_START_FAILED', 'PROVIDER_FAILED']);
const setupTypes = new Set(['authentication', 'permission_denied', 'payment_required', 'context_length_exceeded', 'max_tokens_exceeded', 'token_limit_exceeded', 'string_too_long', 'invalid_request', 'invalid_prompt', 'not_found', 'precondition_failed', 'payload_too_large', 'unprocessable', 'content_policy_violation', 'refusal']);

/** A rate limit from an API route that a signed-in coding-agent plan could take over. */
export const isRateLimit = (error, route) => ['openrouter', 'openai'].includes(route?.provider)
  && (error?.status === 429 || error?.errorType === 'rate_limit_exceeded');

export const PLAN_NAMES = { claude: ['Claude Code', 'Claude'], codex: ['Codex', 'ChatGPT'] };
// Product names stay as they are; an API endpoint is described in the questionnaire's language.
const ROUTE_NAMES = { openrouter: 'OpenRouter', claude: 'Claude Code', codex: 'Codex' };
// The menu's text is message refs: the page and the terminal each draw them in the questionnaire language.
export const switchChoices = (providers, from) => providers.filter(provider => provider !== from).map(provider => ({
  value: `switch-${provider}`, label: msg('common.recovery.switchLabel', { plan: PLAN_NAMES[provider][0] }),
  description: msg('common.recovery.switchDescription', { plan: PLAN_NAMES[provider][1], route: from === 'openai' ? msg('common.recovery.routeEndpoint') : ROUTE_NAMES[from] ?? from }),
}));
/** A coding-agent CLI that failed to run; another plan can take over. */
export const isCliFailure = (error, route) => ['claude', 'codex'].includes(route?.provider)
  && ['PROVIDER_START_FAILED', 'PROVIDER_FAILED', 'PROVIDER_NO_OUTPUT', 'PROVIDER_AUTH', 'EVALUATOR_TIMEOUT'].includes(error?.code);

function retryable(error, before, state, minimum) {
  if (setupCodes.has(error.code) || setupTypes.has(error.errorType)) return false;
  if (error.code === 'OPENROUTER_PROVIDER_ERROR' && [400, 401, 402, 403, 404, 413, 422].includes(error.status)) return false;
  // A failed preflight cannot improve by spending more. Budget exhaustion is
  // different: an explicit human choice can authorize a new allowance.
  if (state.usage.calls === before.usage.calls) {
    return state.usage.limit !== null && state.usage.limit - state.usage.calls < minimum
      && (error.code === 'REVIEWER_BUDGET' || /^Assessment call limit \(/u.test(error.message));
  }
  return !/API key|sign.in|model access|output (?:token )?limit|finish_reason: length|refused or filtered/iu.test(error.message);
}

function diagnostic(error, state) {
  // The interactive menu replaces only Sphinx's own appended command advice;
  // the underlying failure and its sanitized provider diagnostics stay visible.
  const hints = [
    ` Run sphinx check --id ${state.id} --retry-review to explicitly authorize a fresh review allowance; prior usage will be retained.`,
    ` ${state.usage.limit - state.usage.calls} model calls remain in the existing assessment allowance (${state.usage.calls}/${state.usage.limit} used). When ready, retry within that allowance: sphinx check --id ${state.id}.`,
    ` When ready, continue the check: sphinx check --id ${state.id}.`,
  ];
  let message = error.message || String(error);
  for (const hint of hints) if (message.endsWith(hint)) message = message.slice(0, -hint.length);
  return message;
}

/** Keep a human-owned terminal open after review failure. This function never
 * chooses to retry, expands a budget, changes a route, or awards completion on
 * its own. inspect() exposes public state only; validate() checks current Git
 * content and policy before a recovery choice is shown. */
export async function prepareInteractiveCheck({ start, inspect, authorizeMore, validate, config, choose, ui, waitingGit = false, signal, planProviders = [], switchRoute }) {
  for (;;) {
    signal?.throwIfAborted();
    const before = await inspect();
    signal?.throwIfAborted();
    try { const result = await start(); signal?.throwIfAborted(); return result; }
    catch (error) {
      signal?.throwIfAborted();
      if (error.name === 'AbortError' || ['SPHINX_CANCELLED', 'EVALUATOR_CANCELLED'].includes(error.code)) throw error;
      const state = await inspect();
      signal?.throwIfAborted();
      if (state.status !== 'pending' || state.preparation?.status !== 'failed' || state.progress.total !== 0) throw error;
      await validate();
      signal?.throwIfAborted();
      const reserve = questionLimit(config.level, state.route.tier);
      const reviewMinimum = state.preparation.minimumReviewerCalls === 1 ? 1 : 2, minimum = reserve + reviewMinimum;
      const unlimited = state.usage.limit === null;
      const remaining = unlimited ? Infinity : state.usage.limit - state.usage.calls;
      const choices = [];
      // The provider's own diagnostic stays a plain string; Sphinx's sentences are refs.
      ui.warning(diagnostic(error, state));
      ui.note(msg('common.recovery.usedSoFar', { usage: modelUsageRef(state.usage, state.tokens) }));
      if (retryable(error, before, state, minimum)) {
        if (remaining >= minimum) choices.push({
          value: 'retry', label: msg(state.preparation.resumable ? 'common.recovery.continueSaved' : unlimited ? 'common.recovery.retry' : 'common.recovery.retryWithin'),
          description: join([unlimited ? msg('common.recovery.usageKept') : msg('common.recovery.callsRemain', { remaining, reserve }), msg(state.preparation.resumable ? 'common.recovery.reuseSaved' : 'common.recovery.keepRoute')], ' '),
        });
        else if (config.maxModelCalls >= minimum) choices.push({
          value: 'extend', label: msg('common.recovery.extendLabel', { calls: config.maxModelCalls }),
          description: msg('common.recovery.extendDescription', { remaining, minimum: reviewMinimum, reserve, used: state.usage.calls }),
        });
      }
      // Offer the user's own coding-agent plan first when an API route is rate limited.
      const switches = switchRoute && (isRateLimit(error, state.route) || isCliFailure(error, state.route)) ? switchChoices(planProviders, state.route.provider) : [];
      choices.unshift(...switches);
      if (!choices.length) ui.note(msg('common.recovery.noRetry'));
      const failedCli = isCliFailure(error, state.route) ? PLAN_NAMES[state.route.provider][0] : null;
      choices.push({ value: 'pause', label: msg('common.recovery.pauseLabel'), description: msg('common.recovery.pauseDescription') });
      const action = await choose({
        // Lead with the cause when it is a rate limit, so the choices make sense.
        title: isRateLimit(error, state.route) ? msg(state.route.provider === 'openai' ? 'common.recovery.rateLimitedEndpoint' : 'common.recovery.rateLimitedOpenRouter')
          : failedCli ? msg('common.recovery.cliFailedTitle', { cli: failedCli }) : msg('common.recovery.reviewFailedTitle'),
        description: isRateLimit(error, state.route)
          ? msg(switches.length ? 'common.recovery.rateLimitedSwitch' : 'common.recovery.rateLimitedWait')
          : failedCli ? (switches.length ? msg('common.recovery.cliFailedSwitch', { plan: PLAN_NAMES[switches[0].value.slice(7)][0], cli: failedCli }) : msg('common.recovery.cliFailedPause', { cli: failedCli }))
          : msg(waitingGit ? 'common.recovery.waitingGit' : 'common.recovery.chooseHow'),
        choices, current: 'pause',
      });
      signal?.throwIfAborted();
      if (action === 'pause') {
        ui.note(msg('common.recovery.pausedNote'));
        ui.command(`sphinx check --id ${state.id}`);
        return null;
      }
      // The questionnaire's model picker already moved the check to another model; try again on it.
      if (action === 'switched') continue;
      if (!choices.some(choice => choice.value === action)) throw new Error('Invalid review recovery choice. No additional model request was made.');
      if (action.startsWith('switch-')) {
        const provider = action.slice('switch-'.length);
        await switchRoute(provider);
        signal?.throwIfAborted();
        ui.note(msg('common.recovery.switchedNote', { plan: PLAN_NAMES[provider][0] }));
        continue;
      }
      if (action === 'extend') {
        await authorizeMore();
        signal?.throwIfAborted();
        ui.note(msg('common.recovery.authorizedNote', { calls: config.maxModelCalls }));
      }
      // The next start still performs the store's locked policy/snapshot and
      // budget checks. A new failure always returns to the human, never a retry loop.
    }
  }
}
