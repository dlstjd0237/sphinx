#!/usr/bin/env node
import { main } from '../src/cli.js';
import { formatError } from '../src/terminal.js';
import { withUsageLedger } from '../src/usage.js';
import { blockCwdExeSearch } from '../src/windows.js';

// Windows would run a git.exe committed to the repository root before the real Git.
blockCwdExeSearch();

// Only the real CLI process records model usage to the on-disk ledger.
try { process.exitCode = await withUsageLedger(process.env, () => main(process.argv.slice(2))); }
catch (error) {
  formatError(error, { plain: process.argv.includes('--json') || ['hook', 'mcp'].includes(process.argv[2]) });
  process.exitCode = error.exitCode || 1;
}
