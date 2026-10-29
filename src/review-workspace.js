import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from './config.js';
import { loadIgnorePolicy } from './ignore.js';
import { revalidateSnapshot } from './git.js';

const exec = promisify(execFile);
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const REGULAR = new Set(['100644', '100755']);
const MAX_SCAN_BYTES = 128 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 256 * 1024;
const MAX_SEARCH_BYTES = 1024 * 1024;
class ReviewError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new ReviewError(code, message); };
const fields = properties => ({ type: 'object', additionalProperties: false, properties });
const integer = (description, maximum, minimum = 0) => ({ type: 'integer', minimum, maximum, description });
const revision = { type: 'string', enum: ['head', 'base'], description: 'Immutable staged/committed head, or the destination base before this change.' };
const pathField = { type: 'string', description: 'Exact repository-relative path returned by list_files. No traversal or glob expansion.' };
const prefixField = { type: 'string', description: 'Literal repository-relative path prefix. Omit, use an empty string, ".", or "./" for the repository root. Use "src/" for one directory. No traversal, glob, or regex expansion.' };
const DESCRIPTORS = [
  { name: 'list_files', description: 'List allowed files from the immutable source and base trees, including unchanged dependencies. No file contents are read.', inputSchema: fields({ prefix: prefixField, revision: { type: 'string', enum: ['head', 'base', 'both'] }, changedOnly: { type: 'boolean' }, offset: integer('Zero-based file offset.', 10000000), limit: integer('Files per page; default 100.', 200, 1) }) },
  { name: 'read_file', description: 'Read a bounded page from one allowed immutable Git blob. Use nextOffset to continue a partial long line, or nextLine for a line boundary. Symlinks and submodules are not followed.', inputSchema: { ...fields({ path: pathField, revision, startLine: integer('One-based starting line; default 1. Cannot be combined with offset.', 100000000, 1), offset: integer('Zero-based UTF-8 byte offset returned by an earlier page.', MAX_SCAN_BYTES), limit: integer('Maximum lines; default 100.', 200, 1) }), required: ['path'] } },
  { name: 'read_diff', description: 'Read a paginated textual diff for one path between the exact base and head/index blobs. Includes additions, deletions, and mode changes. Binary content is not returned.', inputSchema: { ...fields({ path: pathField, offset: integer('Zero-based UTF-8 byte offset; default 0.', MAX_SCAN_BYTES), limit: integer('Maximum diff lines; default 100.', 200, 1) }), required: ['path'] } },
  { name: 'search', description: 'Search literal single-line text in allowed immutable source files. offset/limit paginate candidate files, not matches. Large or binary files are reported as skipped; inspect large text with read_file. Truncated matching lines include their column range.', inputSchema: { ...fields({ query: { type: 'string', minLength: 1, maxLength: 256, description: 'Exact case-sensitive text to find, not a regular expression or glob.' }, paths: { type: 'array', items: pathField, maxItems: 100 }, prefix: prefixField, revision, offset: integer('Zero-based candidate-file offset; default 0.', 10000000), limit: integer('Files to scan; default 20.', 25, 1) }), required: ['query'] } },
];

function gitOptions(env) {
  return { ...process.env, ...env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' };
}
const gitArgs = args => ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args];
async function metadata(root, args, env) {
  try {
    return (await exec('git', gitArgs(args), { cwd: root, env: gitOptions(env), encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024, windowsHide: true })).stdout;
  } catch { fail('GIT_UNAVAILABLE', 'The immutable Git metadata is unavailable. Retry the Git operation.'); }
}
async function* gitChunks(root, args, env) {
  const child = spawn('git', gitArgs(args), { cwd: root, env: gitOptions(env), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stderr.resume(); // Never expose Git diagnostics, paths, or external configuration to the reviewer.
  let ended = false, stopped = false;
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => { ended = true; code === 0 || stopped ? resolve() : reject(new Error('Git read failed')); });
  });
  done.catch(() => {});
  const timer = setTimeout(() => { stopped = true; child.kill('SIGKILL'); }, 30000);
  try {
    for await (const chunk of child.stdout) yield chunk;
    await done;
    if (stopped) fail('READ_TIMEOUT', 'The Git read timed out. Narrow the requested page.');
  } catch (error) {
    if (error instanceof ReviewError) throw error;
    fail('GIT_UNAVAILABLE', 'The requested immutable Git content is unavailable.');
  } finally {
    clearTimeout(timer);
    if (!ended) { stopped = true; child.kill(); }
    await done.catch(() => {});
  }
}
function validPath(value, { prefix = false } = {}) {
  if (typeof value !== 'string' || (!prefix && !value) || value.length > 8192 || value.includes('\0')
    || value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value)
    || value.split('/').some((part, i, parts) => part === '.' || part === '..' || (!part && !(prefix && i === parts.length - 1)))) {
    fail('INVALID_PATH', 'Use an exact repository-relative path without traversal.');
  }
  return value;
}
function validateArgs(name, args) {
  const descriptor = DESCRIPTORS.find(tool => tool.name === name);
  if (!descriptor) fail('UNKNOWN_TOOL', 'This review tool is unavailable.');
  if (!args || typeof args !== 'object' || Array.isArray(args)
    || Object.keys(args).some(key => !Object.hasOwn(descriptor.inputSchema.properties, key))) fail('INVALID_ARGUMENTS', 'The tool arguments do not match its schema.');
  for (const key of descriptor.inputSchema.required || []) if (!Object.hasOwn(args, key)) fail('INVALID_ARGUMENTS', 'A required tool argument is missing.');
  for (const [key, value] of Object.entries(args)) {
    const schema = descriptor.inputSchema.properties[key];
    if (schema.type === 'integer' && (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum)) fail('INVALID_ARGUMENTS', 'A pagination argument is outside its allowed range.');
    if (schema.type === 'boolean' && typeof value !== 'boolean') fail('INVALID_ARGUMENTS', 'The tool arguments do not match its schema.');
    if (schema.type === 'string' && (typeof value !== 'string' || (schema.enum && !schema.enum.includes(value)))) fail('INVALID_ARGUMENTS', 'The tool arguments do not match its schema.');
    if (key === 'path') validPath(value);
    if (key === 'prefix') validPath(value, { prefix: true });
    if (key === 'paths' && (!Array.isArray(value) || value.length > 100)) fail('INVALID_ARGUMENTS', 'Search paths must be an array of at most 100 exact paths.');
    if (key === 'paths') value.forEach(path => validPath(path));
  }
  if (name === 'read_file' && args.startLine !== undefined && args.offset !== undefined) fail('INVALID_ARGUMENTS', 'Choose startLine or offset, not both.');
  if (name === 'search' && (!args.query || args.query.length > 256 || /[\0\r\n]/u.test(args.query))) fail('INVALID_ARGUMENTS', 'Use nonempty literal single-line search text, at most 256 characters.');
}
function treeEntries(raw, index = false) {
  const entries = new Map();
  for (const row of raw.split('\0').filter(Boolean)) {
    const match = index ? /^(\d{6}) ([a-f0-9]+) 0\t([\s\S]*)$/.exec(row) : /^(\d{6}) (blob|tree|commit) ([a-f0-9]+)\t([\s\S]*)$/.exec(row);
    if (!match) fail('INVALID_SNAPSHOT', 'The immutable source inventory is malformed.');
    const entry = index ? { mode: match[1], oid: match[2], path: match[3] } : { mode: match[1], oid: match[3], path: match[4] };
    if (!OID.test(entry.oid)) fail('INVALID_SNAPSHOT', 'The immutable source inventory is malformed.');
    entries.set(entry.path, entry);
  }
  return entries;
}
const lineCount = buffer => { let count = 0; for (const byte of buffer) if (byte === 10) count++; return count; };
function utf8Length(buffer, length) {
  try {
    // Streaming decoding permits only an incomplete final code point. Invalid
    // bytes anywhere in the prefix must fail, rather than disappear as a trim.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length), { stream: true });
    return Buffer.byteLength(text);
  } catch { fail('NON_TEXT_FILE', 'The requested content is not valid UTF-8 text.'); }
}

/** Collect only a bounded output page; stop the child as soon as its next page is known. */
async function readPage(source, { offset, startLine = 1, limit = 100, bytes = 12000, rejectBinary = false } = {}) {
  let consumed = 0, currentLine = 1, startOffset = null, firstLine = null, chunks = [], length = 0, newlines = 0, hasMore = false;
  for await (const raw of source) {
    if (rejectBinary && raw.includes(0)) fail('BINARY_FILE', 'Binary contents are unavailable to the text reviewer.');
    if (consumed + raw.length > MAX_SCAN_BYTES) fail('SCAN_LIMIT', 'The requested offset exceeds the bounded read range. Narrow the file or review a smaller source artifact.');
    let at = 0;
    if (startOffset === null) {
      if (offset !== undefined) at = Math.min(raw.length, Math.max(0, offset - consumed));
      else while (at < raw.length && currentLine < startLine) { if (raw[at++] === 10) currentLine++; }
      if (offset !== undefined) currentLine += lineCount(raw.subarray(0, at));
      if (at < raw.length || (offset !== undefined && consumed + at === offset)) { startOffset = consumed + at; firstLine = currentLine; }
    }
    if (startOffset !== null) {
      const begin = at;
      while (at < raw.length && length + at - begin < bytes && newlines < limit) { if (raw[at++] === 10) newlines++; }
      if (at > begin) { const part = raw.subarray(begin, at); chunks.push(part); length += part.length; }
      if (at < raw.length) { hasMore = true; break; }
    }
    consumed += raw.length;
  }
  const combined = Buffer.concat(chunks, length);
  const safeLength = utf8Length(combined, combined.length);
  if (!hasMore && safeLength < combined.length) fail('NON_TEXT_FILE', 'The requested content ends with incomplete UTF-8 text.');
  if (safeLength < combined.length) hasMore = true;
  const content = combined.subarray(0, safeLength);
  const count = lineCount(content);
  const endedLine = content.length > 0 && content.at(-1) === 10;
  const actualStart = startOffset ?? consumed;
  const actualLine = firstLine ?? currentLine;
  return {
    text: content.toString('utf8'), startLine: actualLine,
    endLine: content.length ? actualLine + count - (endedLine ? 1 : 0) : actualLine,
    offset: actualStart, nextOffset: hasMore ? actualStart + content.length : null,
    nextLine: hasMore ? actualLine + count : null, truncated: hasMore,
    partialLine: hasMore && !endedLine,
  };
}
async function* addLines(source, prefix) {
  let lineStart = true;
  for await (const chunk of source) {
    if (chunk.includes(0)) fail('BINARY_FILE', 'Binary contents are unavailable to the text reviewer.');
    const pieces = []; let at = 0;
    while (at < chunk.length) {
      if (lineStart) pieces.push(Buffer.from(prefix));
      const newline = chunk.indexOf(10, at), end = newline < 0 ? chunk.length : newline + 1;
      pieces.push(chunk.subarray(at, end)); at = end; lineStart = newline >= 0;
    }
    yield Buffer.concat(pieces);
  }
  if (!lineStart) yield Buffer.from('\n\\ No newline at end of file\n');
}

/** The exact text that read_diff paginates for one path. The questionnaire
 * regenerates it to verify retained observations before showing line ranges. */
export async function* workspaceDiffText(root, file, before, after, env) {
  if (before?.mode !== after?.mode) yield Buffer.from(`File modes: ${before?.mode || '(absent)'} -> ${after?.mode || '(absent)'}\n`);
  if (before && after) {
    if (before.oid !== after.oid) yield* gitChunks(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--full-index', '--unified=3', before.oid, after.oid, '--'], env);
  } else {
    yield Buffer.from(`--- ${before ? JSON.stringify(`a/${file}`) : '/dev/null'}\n+++ ${after ? JSON.stringify(`b/${file}`) : '/dev/null'}\n`);
    yield* addLines(gitChunks(root, ['cat-file', 'blob', (after || before).oid], env), after ? '+' : '-');
  }
}

// JSON escaping and long path names count against the page budget too. Trimming
// only the returned page preserves a byte offset into the immutable source.
function fitPage(result, budget) {
  if (Buffer.byteLength(JSON.stringify(result)) <= budget) return result;
  const content = Buffer.from(result.text);
  let low = 0, high = content.length, best;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const length = utf8Length(content, middle), body = content.subarray(0, length);
    const count = lineCount(body), endedLine = body.length > 0 && body.at(-1) === 10;
    const candidate = {
      ...result, text: body.toString('utf8'), truncated: true,
      endLine: body.length ? result.startLine + count - (endedLine ? 1 : 0) : result.startLine,
      nextOffset: result.offset + length, nextLine: result.startLine + count,
      partialLine: !endedLine,
    };
    if (Buffer.byteLength(JSON.stringify(candidate)) <= budget) { best = candidate; low = middle + 1; }
    else high = middle - 1;
  }
  if (!best?.text.length) fail('RESULT_LIMIT', 'The path and provenance exceed this tool page budget. Increase the tool result budget.');
  return best;
}

/** The reviewer receives only these bounded tools, never a shell or the working tree. */
export async function createReviewWorkspace(snapshot, config, { env = process.env } = {}) {
  const root = snapshot?.repoRoot;
  if (typeof root !== 'string' || !Array.isArray(snapshot.files)) fail('INVALID_SNAPSHOT', 'The checkpoint has no immutable repository inventory.');
  const toolBytes = Math.max(256, Math.min(config.toolResultBytes || 16000, 64000));
  const logLimit = Math.min(4 * (config.maxContextBytes || 100000), 1024 * 1024);
  const log = [], evidence = new Set(); let logBytes = 2; // JSON array brackets.
  let ignore;
  async function validate() {
    try {
      const current = await loadConfig(root, env);
      if (!(await revalidateSnapshot(snapshot, current, { env }))) fail('STALE_SNAPSHOT', 'The code or project policy changed. Retry the Git operation.');
      ignore = await loadIgnorePolicy(root, { env, exclude: current.exclude });
    } catch (error) {
      if (error instanceof ReviewError) throw error;
      fail('STALE_SNAPSHOT', 'The checkpoint or its policy is unavailable. Retry the Git operation.');
    }
  }
  await validate();
  if (snapshot.base && !OID.test(snapshot.base)) fail('INVALID_SNAPSHOT', 'The checkpoint base is not an immutable Git object.');
  const base = snapshot.base ? treeEntries(await metadata(root, ['ls-tree', '-r', '-z', '--full-tree', snapshot.base], env)) : new Map();
  let head;
  if (snapshot.event === 'pre-commit') {
    if (snapshot.indexEntries) {
      if (!Array.isArray(snapshot.indexEntries)) fail('INVALID_SNAPSHOT', 'The pinned index inventory is malformed.');
      head = new Map(snapshot.indexEntries.map(entry => {
        validPath(entry.path);
        if (!OID.test(entry.oid) || !/^\d{6}$/.test(entry.mode)) fail('INVALID_SNAPSHOT', 'The pinned index inventory is malformed.');
        return [entry.path, { ...entry }];
      }));
    } else head = treeEntries(await metadata(root, ['ls-files', '--stage', '-z'], env), true);
  } else {
    if (!OID.test(snapshot.head || '')) fail('INVALID_SNAPSHOT', 'The checkpoint head is not an immutable Git object.');
    head = treeEntries(await metadata(root, ['ls-tree', '-r', '-z', '--full-tree', snapshot.head], env));
  }
  for (const tree of [head, base]) for (const file of tree.keys()) if (ignore.matches(file)) tree.delete(file);
  const changed = new Set(snapshot.files.filter(file => !ignore.matches(file)));
  const trees = { head, base };
  const all = [...new Set([...head.keys(), ...base.keys()])].sort();
  const type = entry => !entry ? null : REGULAR.has(entry.mode) ? 'file' : entry.mode === '120000' ? 'symlink' : entry.mode === '160000' ? 'submodule' : 'unsupported';
  function entryFor(file, rev) {
    validPath(file);
    if (ignore.matches(file)) fail('PATH_UNAVAILABLE', 'The path is not available under the review policy.');
    const entry = trees[rev].get(file);
    if (!entry) fail('PATH_UNAVAILABLE', 'The path does not exist in this allowed immutable revision.');
    if (!REGULAR.has(entry.mode)) fail('UNSUPPORTED_FILE_TYPE', 'Only regular source files can be read; links and submodules are not followed.');
    return entry;
  }
  function pathsFor(args, rev = 'both') {
    const names = rev === 'both' ? all : [...trees[rev].keys()].sort();
    return names.filter(file => (!args.prefix || file.startsWith(args.prefix)) && (!args.changedOnly || changed.has(file)));
  }
  async function list(args) {
    const names = pathsFor(args, args.revision || 'both'), offset = args.offset || 0, limit = args.limit || 100;
    const files = [];
    for (const file of names.slice(offset, offset + limit)) {
      const item = { path: file, changed: changed.has(file), head: type(head.get(file)), base: type(base.get(file)) };
      if (Buffer.byteLength(JSON.stringify([...files, item])) > toolBytes - 500) break;
      files.push(item);
    }
    if (!files.length && offset < names.length) fail('RESULT_LIMIT', 'The path metadata exceeds this tool page budget.');
    const next = offset + files.length;
    return { files, total: names.length, offset, nextOffset: next < names.length ? next : null, truncated: next < names.length, evidencePaths: [] };
  }
  async function read(args) {
    const rev = args.revision || 'head', entry = entryFor(args.path, rev);
    const page = await readPage(gitChunks(root, ['cat-file', 'blob', entry.oid], env), { ...args, bytes: toolBytes, rejectBinary: true });
    return fitPage({ path: args.path, revision: rev, oid: entry.oid, ...page, evidencePaths: [args.path] }, toolBytes);
  }
  async function diff(args) {
    const file = args.path;
    if (ignore.matches(file) || (!head.has(file) && !base.has(file))) fail('PATH_UNAVAILABLE', 'The path is not available under the review policy.');
    const before = base.get(file), after = head.get(file);
    if ((before && !REGULAR.has(before.mode)) || (after && !REGULAR.has(after.mode))) fail('UNSUPPORTED_FILE_TYPE', 'Links and submodules are not read by the text reviewer.');
    const provenance = { path: file, revision: 'base..head', baseOid: before?.oid || null, headOid: after?.oid || null, baseMode: before?.mode || null, headMode: after?.mode || null };
    if (snapshot.binaryFiles?.includes(file)) return { ...provenance, binary: true, text: 'Binary content changed; the text reviewer cannot inspect its contents.', truncated: false, nextOffset: null, evidencePaths: [file] };
    return fitPage({ ...provenance, ...(await readPage(workspaceDiffText(root, file, before, after, env), { offset: args.offset || 0, limit: args.limit || 100, bytes: toolBytes, rejectBinary: true })), evidencePaths: [file] }, toolBytes);
  }
  async function search(args) {
    const rev = args.revision || 'head';
    if (args.paths) for (const file of args.paths) entryFor(file, rev);
    const names = (args.paths ? [...new Set(args.paths)].sort() : pathsFor(args, rev))
      .filter(file => (!args.prefix || file.startsWith(args.prefix)) && REGULAR.has(trees[rev].get(file)?.mode));
    const offset = args.offset || 0, matches = [], skipped = [], incompletePaths = [];
    let index = offset, scannedBytes = 0, resultBytes = 500;
    for (; index < Math.min(names.length, offset + (args.limit || 20)); index++) {
      const file = names[index], entry = entryFor(file, rev);
      const size = Number((await metadata(root, ['cat-file', '-s', entry.oid], env)).trim());
      if (!Number.isSafeInteger(size) || size < 0) fail('GIT_UNAVAILABLE', 'The immutable file size is unavailable.');
      if (size > MAX_SEARCH_FILE_BYTES) { skipped.push({ path: file, reason: 'large-file-use-read_file' }); continue; }
      if (scannedBytes + size > MAX_SEARCH_BYTES) break;
      const chunks = []; let count = 0;
      for await (const chunk of gitChunks(root, ['cat-file', 'blob', entry.oid], env)) { count += chunk.length; if (count > MAX_SEARCH_FILE_BYTES) fail('SCAN_LIMIT', 'The bounded search file limit was exceeded.'); chunks.push(chunk); }
      scannedBytes += count;
      const body = Buffer.concat(chunks, count);
      if (body.includes(0)) { skipped.push({ path: file, reason: 'binary' }); continue; }
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body); } catch { skipped.push({ path: file, reason: 'non-utf8' }); continue; }
      const lines = text.split('\n');
      for (let line = 0; line < lines.length; line++) {
        const hit = lines[line].indexOf(args.query);
        if (hit < 0) continue;
        const start = Math.max(0, hit - 80), end = Math.min(lines[line].length, start + 600);
        const match = { path: file, revision: rev, oid: entry.oid, line: line + 1, startColumn: start + 1, endColumn: end + 1, text: lines[line].slice(start, end), truncated: start > 0 || end < lines[line].length };
        const bytes = Buffer.byteLength(JSON.stringify(match));
        if (matches.length >= 100 || resultBytes + bytes > toolBytes - 800) { incompletePaths.push(file); break; }
        matches.push(match); resultBytes += bytes;
      }
      if (incompletePaths.length) { index++; break; }
    }
    return { matches, skipped, incompletePaths, offset, scannedFiles: index - offset, totalFiles: names.length, nextOffset: index < names.length ? index : null, truncated: index < names.length || incompletePaths.length > 0, evidencePaths: [...new Set(matches.map(match => match.path))] };
  }
  const handlers = { list_files: list, read_file: read, read_diff: diff, search };
  return {
    tools: structuredClone(DESCRIPTORS),
    get evidencePaths() { return new Set(evidence); },
    get evidenceLog() { return structuredClone(log); },
    async execute(name, args = {}) {
      try {
        // Root aliases are directory selectors only; exact file paths remain strict.
        if ((name === 'list_files' || name === 'search') && args && typeof args === 'object' && !Array.isArray(args)
          && (args.prefix === '.' || args.prefix === './')) args = { ...args, prefix: '' };
        validateArgs(name, args);
        await validate();
        const result = await handlers[name](args);
        if (Buffer.byteLength(JSON.stringify(result)) > toolBytes) fail('RESULT_LIMIT', 'The result exceeds the bounded tool page budget. Narrow the request.');
        const record = { id: `read-${log.length + 1}`, tool: name, args: structuredClone(args), result };
        const bytes = Buffer.byteLength(JSON.stringify(record)) + (log.length ? 1 : 0);
        if (logBytes + bytes > logLimit) fail('EVIDENCE_LIMIT', 'The bounded evidence log is full. Use the observations already collected.');
        log.push(record); logBytes += bytes;
        for (const file of result.evidencePaths) evidence.add(file);
        return structuredClone(result);
      } catch (error) {
        return { error: { code: error instanceof ReviewError ? error.code : 'REVIEW_TOOL_FAILED', message: error instanceof ReviewError ? error.message : 'The review tool failed without returning source content.' }, evidencePaths: [] };
      }
    },
  };
}
