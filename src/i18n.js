import { KO } from './i18n-ko.js';

export const LANGUAGES = Object.freeze(['en', 'ko']);

/** The English message catalog: flat keys, {name} placeholders, and plurals as { one, other } chosen by a raw count. */
export const EN = {
  'common.language.en': 'English',
  'common.language.ko': '한국어',
  // Sphinx's own fallback sentences. Sessions store them in English beside a code; screens draw the code.
  'common.fallback.flagged': 'The question or answer key does not match the code. Your answer has not been marked wrong and no concept was completed. Review the replacement question if one is available.',
  'common.fallback.empty': 'The grader returned no explanation this time.',
  'common.fallback.documentation': 'Documentation-only change.',
  // The review recovery menu (check-recovery.js), shown by the page and the terminal.
  'common.recovery.routeEndpoint': 'your API endpoint',
  'common.recovery.switchLabel': 'Switch this check to {plan}',
  'common.recovery.switchDescription': 'Continue on your signed-in {plan} plan instead of {route}. Only this check changes; your saved model settings stay the same.',
  'common.recovery.usedSoFar': 'Used so far: {usage}. No questions or approval were recorded.',
  'common.recovery.continueSaved': 'Continue the saved review',
  'common.recovery.retry': 'Retry the review',
  'common.recovery.retryWithin': 'Retry within the remaining allowance',
  'common.recovery.usageKept': 'All usage so far is kept.',
  'common.recovery.callsRemain': '{remaining} calls remain, including {reserve} reserved for grading.',
  'common.recovery.reuseSaved': 'Reuse the evidence and investigation already saved.',
  'common.recovery.keepRoute': 'Keep the same evaluator route and spending settings.',
  'common.recovery.extendLabel': 'Allow up to {calls} more calls and retry',
  'common.recovery.extendDescription': '{remaining} calls remain; review needs at least {minimum} plus {reserve} reserved for grading. Keep all {used} used calls counted and record this new allowance.',
  'common.recovery.noRetry': 'Resolve the reported setup or evidence problem before resuming. Repeating this attempt is not offered here.',
  'common.recovery.pauseLabel': 'Pause this check',
  'common.recovery.pauseDescription': 'Save progress without making another model request. The Git operation remains unapproved.',
  'common.recovery.rateLimitedEndpoint': 'Your API endpoint is rate limiting this review',
  'common.recovery.rateLimitedOpenRouter': 'OpenRouter is rate limiting this review',
  'common.recovery.cliFailedTitle': '{cli} could not run this review',
  'common.recovery.reviewFailedTitle': 'Review did not finish',
  'common.recovery.rateLimitedSwitch': 'It returned too many requests (HTTP 429). Switch this check to your coding plan, or wait and continue.',
  'common.recovery.rateLimitedWait': 'It returned too many requests (HTTP 429). Wait a moment, then continue.',
  'common.recovery.cliFailedSwitch': 'Switch this check to {plan}, or pause and check that {cli} is installed, signed in, and up to date. The details are below.',
  'common.recovery.cliFailedPause': 'Pause and check that {cli} is installed, signed in, and up to date. The details are below.',
  'common.recovery.waitingGit': 'The original Git operation is waiting while this terminal stays open, subject to its time limit. Choose how to continue.',
  'common.recovery.chooseHow': 'Choose how to continue. Nothing is retried automatically.',
  'common.recovery.pausedNote': 'Progress saved. No approval was recorded.',
  'common.recovery.switchedNote': 'Switched this check to {plan}. Your saved model settings are unchanged.',
  'common.recovery.authorizedNote': 'Authorized up to {calls} additional model calls, including grading. Earlier usage remains counted.',
  // The reviewer's progress lines (reviewer.js). Counts are raw numbers.
  'common.progress.readingFile': 'Reading {path}',
  'common.progress.readingSomeFile': 'Reading a file',
  'common.progress.readingDiff': 'Reading the diff of {path}',
  'common.progress.readingSomeDiff': 'Reading the diff of a file',
  'common.progress.searching': 'Searching for “{query}”',
  'common.progress.listingFiles': 'Listing files',
  'common.progress.listingFilesIn': 'Listing files in {prefix}',
  'common.progress.investigating': 'Investigating',
  'common.progress.resuming': 'Resuming the saved investigation',
  'common.progress.readDiffs': { one: 'Read the diff for {n} changed file', other: 'Read the diff for {n} changed files' },
  'common.progress.workingBrief': { one: 'Starting from the working brief ({n} note)', other: 'Starting from the working brief ({n} notes)' },
  'common.progress.drafting': 'Drafting questions',
  'common.progress.auditing': 'Checking the questions against the source',
  'common.progress.condensing': 'Condensing review notes',
  // A check's model usage (usage.js modelUsageRef); English command output draws it in English.
  'common.usage.tokens': '{n} tokens',
  'common.usage.calls': '{calls}/{limit} calls',
  // Errors the session store attaches as error.ref; their English message stays for code that reads it.
  'common.grading.unusableExplanation': 'The grader\'s reply couldn\'t be used, so no explanation is shown. Asking again makes another model call.',
  'common.grading.unusableAnswer': 'The grader\'s reply couldn\'t be used, so this wasn\'t graded. Your text is saved; sending it again makes another model call.',
  'common.grading.answerSaved': 'Your answer was saved and is offered again when you resume this question.',
  'common.grading.disputeSaved': 'Your dispute reason was saved and is offered again when you resume this question.',
  'common.answer.tooLong': 'Please keep your answer below 8,000 characters.',
  'common.session.settingsChanged': 'Sphinx settings changed. Start a fresh check.',
  // The questionnaire page's model menu (model-choices.js). Model and product names stay as they are.
  'model.billing.plan': 'your plan',
  'model.billing.apiKey': 'API key',
  'model.group.endpoint': 'Your endpoint',
  'model.option.freeRouter': 'Free router',
  'model.note.fastest': 'fastest',
  'model.note.stronger': 'stronger',
  'model.note.free': 'free',
  'model.note.paid': 'paid',
  'model.choice.paidOff': 'Paid models are off. Run sphinx config --allow-paid to allow them.',
  'model.choice.notListed': 'Choose a model from the list.',
  // The questionnaire server (browser-interview.js): status lines, transcript lines, choices and HTTP errors.
  'server.state.waiting': 'Waiting for the checkpoint.',
  'server.working.preparing': 'Preparing your understanding check…',
  'server.working.reviewing': 'Reviewing the change…',
  'server.working.checkingAnswer': 'Checking your reasoning…',
  'server.working.preparingExplanation': 'Preparing an explanation…',
  'server.working.reviewingQuestion': 'Reviewing the question…',
  'server.working.continuing': 'Continuing the review…',
  'server.transcript.learn': 'Explain this concept.',
  'server.transcript.dispute': 'Dispute: {text}',
  'server.transcript.switchedTo': 'Switched this check to {name}.',
  'server.transcript.switchedToDefault': 'Switched this check to {name}. It becomes your default when this check ends.',
  'server.transcript.switchedToResend': 'Switched this check to {name}. Send your answer again.',
  'server.transcript.yourEndpoint': 'your endpoint',
  'server.transcript.restarting': 'Restarting the review on the new model',
  'server.transcript.newScenario': 'Writing a new scenario to try…',
  'server.transcript.finishing': 'Finishing up…',
  'server.transcript.sameQuestion': 'The same question is still open.',
  'server.question.notAccepted': 'Your response was not accepted. Review the error before submitting again.',
  'server.gradingRecovery.rateLimited': 'Grading was rate limited',
  'server.gradingRecovery.cliFailed': '{name} could not grade this answer',
  'server.gradingRecovery.backLabel': 'Back to the question',
  'server.gradingRecovery.backDescription': 'Keep the current model and try again later. Your draft answer is kept.',
  'server.modelSwitch.afterGrading': 'Switch after this answer is checked.',
  'server.modelSwitch.afterStep': 'Switch once the current step finishes.',
  'server.change.loadFailed': 'The changed files could not be loaded for display.',
  'server.notify.answersNeeded': 'Sphinx needs your answers',
  'server.notify.continuePush': 'Sphinx: continue the push?',
  'server.notify.continueCommit': 'Sphinx: continue the commit?',
  'server.result.passed': 'You passed.',
  'server.result.noQuestions': 'No questions needed: {reason}',
  'server.result.recordsNote': 'This records your answers, not a review of every changed line.',
  'server.earlier.passedPush': 'You passed this change earlier, but that push did not go through.',
  'server.earlier.passedCommit': 'You passed this change earlier, but that commit did not go through.',
  'server.earlier.noQuestionsPush': 'This change needed no questions earlier, but that push did not go through.',
  'server.earlier.noQuestionsCommit': 'This change needed no questions earlier, but that commit did not go through.',
  'server.consent.questionPush': '{lead} Continue the push?',
  'server.consent.questionCommit': '{lead} Continue the commit?',
  'server.consent.continuePush': 'Continue push',
  'server.consent.continueCommit': 'Continue commit',
  'server.consent.continueDescriptionPush': 'Continue: the push goes through.',
  'server.consent.continueDescriptionCommit': 'Continue: the commit goes through.',
  'server.consent.stopPush': 'Stop push',
  'server.consent.stopCommit': 'Stop commit',
  'server.consent.stopDescription': 'Stop: it does not go through. {keptPass}',
  'server.keptPass.push': 'Your pass is saved, so the next push of this change asks only whether to continue.',
  'server.keptPass.commit': 'Your pass is saved, so the next commit of this change asks only whether to continue.',
  'server.stopped.push': 'Push stopped. It did not go through. {keptPass} You can close this tab.',
  'server.stopped.commit': 'Commit stopped. It did not go through. {keptPass} You can close this tab.',
  'server.passed.closeTab': '{result} You can close this tab.',
  'server.passed.nextDestinationPush': '{result} This push has another destination to check next.',
  'server.passed.nextDestinationCommit': '{result} This commit has another destination to check next.',
  'server.passed.gitFinishingPush': '{result} You can close this tab; Git is finishing the push on its own.',
  'server.passed.gitFinishingCommit': '{result} You can close this tab; Git is finishing the commit on its own.',
  'server.skipped.gitContinuing': 'Skipped. Git is continuing; you can close this tab.',
  'server.skipped.closeTab': 'Skipped. You can close this tab.',
  'server.paused.manual': 'Paused. Your progress is saved. To continue, run the command below; Sphinx reopens at this question.',
  'server.paused.cutShortPush': 'Git stopped waiting before you chose, so the push did not go through. {keptPass}',
  'server.paused.cutShortCommit': 'Git stopped waiting before you chose, so the commit did not go through. {keptPass}',
  'server.paused.gitStoppedPush': 'Push stopped. It did not go through, and your progress is saved. To continue, run the same push again; Sphinx reopens at this question.',
  'server.paused.gitStoppedCommit': 'Commit stopped. It did not go through, and your progress is saved. To continue, run the same commit again; Sphinx reopens at this question.',
  'server.error.noLongerApplies': 'This check no longer applies.',
  'server.error.couldNotFinish': 'The check could not finish. Saved progress and completed checkpoints are retained.',
  'server.language.invalid': 'Invalid language.',
  'server.language.closing': 'This questionnaire is closing.',
  'server.language.saveFailed': 'Could not save the language setting: {reason}',
  'server.http.forbidden': 'Forbidden request.',
  'server.http.notFound': 'Not found.',
  'server.http.changeStale': 'This checkpoint changed. Reload the current change.',
  'server.http.viewStale': 'The code or settings changed. This view no longer describes the checkpoint.',
  'server.http.diffUnavailable': 'This file diff is unavailable.',
  'server.http.tooManyPages': 'Too many open questionnaire pages.',
  'server.http.unsupportedMethod': 'Unsupported method.',
  'server.http.invalidChoice': 'Invalid choice.',
  'server.http.noStamp': 'There is no pull request stamp to set for this check.',
  'server.http.invalidDistance': 'Invalid distance.',
  'server.http.waitForStart': 'Wait for the check to start.',
  'server.http.chooseDistance': 'Choose high, mixed, or low.',
  'server.http.invalidModelChoice': 'Invalid model choice.',
  'server.http.noUpdate': 'No update to install.',
  'server.http.tooLong': 'Keep your response below 8,000 characters.',
  'server.http.invalidResponse': 'Invalid response.',
  'server.http.checkpointChanged': 'This checkpoint changed. Use the current question.',
  'server.http.chooseConsentPush': 'Choose continue or stop for this push.',
  'server.http.chooseConsentCommit': 'Choose continue or stop for this commit.',
  'server.http.waitForStep': 'Wait for the current step to finish.',
  'server.http.questionChanged': 'The question changed. Use the current question.',
  'server.http.responseRequired': 'Enter an answer or a dispute reason first.',
  'server.http.processFailed': 'Could not process this response.',
  // Why the page cannot show the changed files (change-view.js ChangeViewError).
  'server.changeView.objectsUnavailable': 'The checkpoint’s Git objects are unavailable.',
  'server.changeView.inventoryMalformed': 'The checkpoint inventory is malformed.',
  'server.changeView.comparisonMalformed': 'The checkpoint comparison is malformed.',
  'server.changeView.lineCountsMalformed': 'The checkpoint line counts are malformed.',
  'server.changeView.noInventory': 'This checkpoint has no recorded file inventory.',
  'server.changeView.baseNotImmutable': 'The checkpoint base is not an immutable Git object.',
  'server.changeView.noStagedInventory': 'This older commit checkpoint did not record its staged file inventory.',
  'server.changeView.headNotImmutable': 'The checkpoint head is not an immutable Git object.',
  'server.changeView.exclusionsChanged': 'The exclusion rules changed after this checkpoint was created.',
  'server.changeView.tooLarge': 'The checkpoint comparison is too large to display.',
  'server.changeView.stagedMoved': 'The staged changes moved while loading the checkpoint.',
  'server.changeView.objectsMismatch': 'The checkpoint comparison no longer matches its recorded Git objects.',
  'server.changeView.filesMismatch': 'The displayed comparison does not match the reviewed file list.',
  'server.changeView.fileNotInCheckpoint': 'That file is not part of this checkpoint.',
  'server.update.linkedCopy': 'This is a linked development copy. Update it with git pull.',
  // Model switches the session store refuses (sessions.js switchRoute).
  'server.switchRoute.unknownProvider': 'Unknown reviewer provider.',
  'server.switchRoute.planOnly': 'Only Claude Code or Codex can take over a check on your plan.',
  'server.switchRoute.unfinishedOnly': 'Only an unfinished check can switch models.',
};

/** The language a new install pre-selects: SPHINX_SYSTEM_LANGUAGE when it is en or ko, otherwise Korean only for a Korean locale. */
export function systemLanguage({ env = process.env, locale = Intl.DateTimeFormat().resolvedOptions().locale } = {}) {
  if (LANGUAGES.includes(env.SPHINX_SYSTEM_LANGUAGE)) return env.SPHINX_SYSTEM_LANGUAGE;
  try { return new Intl.Locale(locale).language === 'ko' ? 'ko' : 'en'; } catch { return 'en'; }
}

/** Fills each {name} once with String(params[name]); filled values are never rescanned, and names params lacks stay as written. */
export function format(text, params) {
  return text.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match));
}

/** A plural entry { one, other } gives one only when the raw count is exactly 1. */
export function pick(entry, params) {
  return entry !== null && typeof entry === 'object' ? (params.count === 1 ? entry.one : entry.other) : entry;
}

export function lookup(language, key, catalogs = { en: EN, ko: KO }) {
  return catalogs[language]?.[key] ?? catalogs.en[key];
}

/** Never throws: a key Korean lacks falls back to English, and a key English lacks comes back as itself. */
export function t(language, key, params = {}) {
  const values = params ?? {}; // a hand-made or stored ref can carry $p: null
  const text = pick(lookup(language, key), values);
  return typeof text === 'string' ? format(text, values) : key;
}

export function msg(key, params) {
  return params === undefined ? { $t: key } : { $t: key, $p: params };
}

export function join(parts, separator) {
  return { $join: parts, $sep: separator };
}

export function isRef(value) {
  return value !== null && typeof value === 'object' && (typeof value.$t === 'string' || Array.isArray(value.$join));
}

const isPlain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/**
 * Draws every ref as text, depth first, into new copies of the arrays and plain objects around it; everything else passes through.
 * Takes acyclic, JSON-shaped values only: every caller serializes the result next, and a cycle would recurse without end.
 */
export function localize(value, language) {
  // ponytail: no visited-set, by the contract above; track visited objects if a caller ever passes a cyclic value.
  if (isRef(value)) {
    return typeof value.$t === 'string'
      ? t(language, value.$t, localize(value.$p, language))
      : value.$join.map(part => localize(part, language)).join(value.$sep);
  }
  if (Array.isArray(value)) return value.map(item => localize(item, language));
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localize(item, language)]));
  return value;
}

const pageOnly = catalog => Object.fromEntries(Object.entries(catalog).filter(([key]) => key.startsWith('page.')));

/** The part of both catalogs the questionnaire page's own script needs. */
export function pageCatalog() {
  return { en: pageOnly(EN), ko: pageOnly(KO) };
}
