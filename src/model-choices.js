import { openRouterKey, openAIEndpoint } from './config.js';
import { REVIEWER_PRESETS } from './model-presets.js';
import { msg } from './i18n.js';

// The models the questionnaire's picker offers: only providers this machine is
// set up for, a short curated list for each, and a free-form model ID where the
// provider accepts any. Paid OpenRouter models stay unselectable unless paid
// models are allowed, matching the check at request time.
export const isFreeOpenRouter = model => model === 'openrouter/free' || String(model).endsWith(':free');
const presetModels = provider => [...new Set(REVIEWER_PRESETS.flatMap(preset => Object.values(preset.models)).filter(route => route.provider === provider).map(route => route.model))];

// Sphinx's words in the menu are message refs, drawn as the state leaves the server; model and product names stay as they are.
export async function modelChoices({ config, env = process.env, plans = [], current }) {
  const groups = [];
  const option = (model, label, note, extra = {}) => ({ model, label: label || model, ...(note ? { note } : {}), ...extra });
  if (plans.includes('claude')) groups.push({ provider: 'claude', label: 'Claude Code', billing: msg('model.billing.plan'), models: [option('haiku', 'Haiku', msg('model.note.fastest')), option('sonnet', 'Sonnet', msg('model.note.stronger'))] });
  if (plans.includes('codex')) groups.push({ provider: 'codex', label: 'Codex', billing: msg('model.billing.plan'), models: presetModels('codex').map(model => option(model)) });
  if (await openRouterKey(env).catch(() => null)) {
    const models = [...new Set(['openrouter/free', ...presetModels('openrouter'), ...(current?.provider === 'openrouter' && current.model ? [current.model] : [])])];
    groups.push({ provider: 'openrouter', label: 'OpenRouter', billing: msg('model.billing.apiKey'), custom: true, models: models.map(model => {
      const free = isFreeOpenRouter(model);
      return option(model, model === 'openrouter/free' ? msg('model.option.freeRouter') : model, msg(free ? 'model.note.free' : 'model.note.paid'), free || config.allowPaid ? {} : { disabled: msg('model.choice.paidOff') });
    }) });
  }
  if (await openAIEndpoint(env).catch(() => null)) {
    const saved = [...new Set(Object.values(config.models || {}).filter(route => route.provider === 'openai').map(route => route.model).concat(current?.provider === 'openai' ? [current.model] : []).filter(Boolean))];
    groups.push({ provider: 'openai', label: msg('model.group.endpoint'), billing: msg('model.billing.apiKey'), custom: true, models: saved.map(model => option(model)) });
  }
  return groups;
}

/** Whether a picked provider and model is one of the offered, selectable choices (or a custom ID where allowed): null, or why not as one message ref. */
export function validChoice(groups, provider, model, config) {
  const group = groups.find(item => item.provider === provider);
  if (!group || typeof model !== 'string' || !model.trim() || model.length > 200 || !/^[\w./:@+-]+$/.test(model)) return msg('model.choice.notListed');
  const listed = group.models.find(item => item.model === model);
  if (listed?.disabled) return listed.disabled;
  if (!listed && !group.custom) return msg('model.choice.notListed');
  if (provider === 'openrouter' && !isFreeOpenRouter(model) && !config.allowPaid) return msg('model.choice.paidOff');
  return null;
}
