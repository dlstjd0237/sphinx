import { runCheckpointTerminal } from './terminal-launch.js';
import { loadConfig } from './config.js';
import { t } from './i18n.js';

try {
  // The window's own lines use the questionnaire language. It is a global setting, so a broken .sphinxconfig cannot hide
  // it; any failure to read it leaves them English.
  const language = await loadConfig().then(config => config.language, () => 'en');
  const result = await runCheckpointTerminal({ recordFile: process.argv[2], token: process.argv[3], language });
  process.exitCode = result.code;
  if (result.status === 'passed') process.stdout.write(`\n${t(language, 'terminal.window.complete')}\n`);
  else if (result.status !== 'ignored') process.stdout.write(`\n${t(language, 'terminal.window.incomplete')}\n`);
} catch {
  process.stderr.write('Sphinx could not open this checkpoint. Run sphinx doctor, then retry the Git operation.\n');
  process.exitCode = 1;
}
