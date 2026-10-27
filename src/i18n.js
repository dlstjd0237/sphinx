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
