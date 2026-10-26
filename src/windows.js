// Windows process and environment helpers. The ones that differ by OS take `platform` so tests can inject it.

const NO_CWD_SEARCH = 'NoDefaultCurrentDirectoryInExePath';
export const CWD_SEARCH_MARKER = 'SPHINX_ADDED_NO_CWD_SEARCH';

// Windows ignores case in variable names, but a copy such as `{ ...process.env }` is a plain object.
// Only ASCII letters are folded: Windows never equates a non-ASCII letter with an ASCII one, unlike toUpperCase() (dotless 'ı' becomes 'I').
const fold = text => text.replace(/[a-z]+/g, letters => letters.toUpperCase());
const sameName = (a, b) => fold(a) === fold(b);

export function envValue(env, name, platform = process.platform) {
  if (platform !== 'win32') return env[name];
  return Object.entries(env).find(([key]) => sameName(key, name))?.[1];
}

// libuv's argument quoting, except that every argument is wrapped: MSYS2 (Git's sh) strips quotes from
// and globs unquoted arguments, which would change `O'Neil` or `{a,b}` in a path.
export function msvcrtQuote(arg) {
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

// Windows searches the current directory before PATH for a bare command name. Sphinx runs `git` with the
// repository as cwd, so a repository that commits a git.exe would get it run. The switch is read from the
// spawning process's own environment, so it has to be set in `process.env`; a child's env option is too late.
export function blockCwdExeSearch(env = process.env, platform = process.platform) {
  if (platform !== 'win32' || Object.keys(env).some(key => sameName(key, NO_CWD_SEARCH))) return false;
  env[NO_CWD_SEARCH] = '1';
  env[CWD_SEARCH_MARKER] = '1'; // tells withoutAddedCwdBlock the switch is ours, not the user's
  return true;
}

// The environment for a chained user hook, which should search for commands as it would under Git alone.
export function withoutAddedCwdBlock(env) {
  const copy = { ...env };
  if (!Object.keys(copy).some(key => sameName(key, CWD_SEARCH_MARKER))) return copy;
  for (const key of Object.keys(copy)) if (sameName(key, NO_CWD_SEARCH) || sameName(key, CWD_SEARCH_MARKER)) delete copy[key];
  return copy;
}
