import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const SRC = new URL('src/', ROOT);

// The text of the call whose '(' is at `open`, found by counting parentheses. An unterminated call comes back empty, so it reads as missing.
// ponytail: parentheses inside string literals are counted too, which is fine while no git or gh call has an unpaired one; skip string literals here if one ever does.
function callText(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '(') depth++;
    else if (source[index] === ')' && --depth === 0) return source.slice(open, index + 1);
  }
  return '';
}

// A detached background worker has no console on Windows, so every console program it starts, git and gh included, opens a
// console window of its own: a burst of flashing windows after each commit in a GUI client. The helpers are shared with the hook
// process, which has a console, so every call gets the option; there it changes nothing.
test('every git and gh child process is started with windowsHide', () => {
  let found = 0;
  const missing = [];
  for (const name of readdirSync(SRC).filter(file => file.endsWith('.js'))) {
    const source = readFileSync(new URL(name, SRC), 'utf8');
    for (const { index } of source.matchAll(/\(\s*'(?:git|gh)'\s*,/g)) {
      found++;
      if (!/windowsHide:\s*true/.test(callText(source, index))) missing.push(`src/${name}:${source.slice(0, index).split('\n').length}`);
    }
  }
  // The scan must not pass by finding nothing. It finds 12 calls today.
  assert.ok(found >= 12, `the scan found only ${found} git and gh calls in src/*.js`);
  assert.deepEqual(missing, [], `windowsHide: true is missing from the options of:\n  ${missing.join('\n  ')}`);
});

// Windows would run a git.exe or gh.exe from the repository folder before the real one. The two production entry points, the CLI
// and the GitHub stamp worker that a pre-push hook starts detached, have to set the switch before they run anything else.
test('both production entry points block cwd-first executable search before they run anything', () => {
  for (const file of ['bin/sphinx.js', 'src/github-worker.js']) {
    // Without the shebang and the comments, so a commented-out import or call does not count.
    const code = readFileSync(new URL(file, ROOT), 'utf8').replace(/^#!.*/, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    assert.match(code, /import\s*\{[^}]*\bblockCwdExeSearch\b[^}]*\}\s*from\s*'(?:\.\.\/src|\.)\/windows\.js'/, `${file} must import blockCwdExeSearch from windows.js`);
    // Only import statements (each runs to its first semicolon) may come before the call.
    assert.match(code, /^\s*(?:import\s[^;]*;\s*)*blockCwdExeSearch\(\);/,`${file} must call blockCwdExeSearch() as the first statement after its imports`);
  }
});
