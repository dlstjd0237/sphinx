const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
export const stripAnsi = value => String(value).replace(ANSI, '');
const ANSI_PARTS = new RegExp(`(${ANSI.source})`);

// Terminal columns, not UTF-16 units: Hangul, CJK and emoji take two, marks and joiners none. Measured per grapheme,
// so a ZWJ sequence or a decomposed Hangul syllable is one cell. A soft hyphen is the one format character that takes a
// column, because terminals draw it.
// The segmenter is built on first use: loading its break rules takes about 10 ms, which every Sphinx start would pay
// although English text never needs it.
let segmenter;
const graphemes = text => (segmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' })).segment(text);
const NO_COLUMN = /^[[\p{Mn}\p{Me}\p{Cf}\u{1160}-\u{11FF}\u{D7B0}-\u{D7FF}]--\u{AD}]+$/v;
const TWO_COLUMNS = /\u{FE0F}|\p{Emoji_Presentation}|[\u{1100}-\u{115F}\u{2E80}-\u{A4CF}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}\u{FE30}-\u{FE4F}\u{FF00}-\u{FF60}\u{FFE0}-\u{FFE6}\u{20000}-\u{3FFFD}]/u;
const graphemeWidth = grapheme => NO_COLUMN.test(grapheme) ? 0 : TWO_COLUMNS.test(grapheme) ? 2 : 1;
export function displayWidth(text) {
  const visible = stripAnsi(text);
  if (/^[\x20-\x7e]*$/u.test(visible)) return visible.length; // printable ASCII: one column each, no segmenter needed
  let width = 0;
  for (const { segment } of graphemes(visible)) width += graphemeWidth(segment);
  return width;
}

const dropFailedWrite = () => {};
/** One line to stderr. A Git client that cancelled can close a hook's stderr while the hook still has to free the
 * questionnaire for a retry and hold the pass. Node raises every failed write as an 'error' event, which ends the process
 * when nothing listens (console.error covers only the first), so this keeps one listener that drops them. */
export function stderrLine(line) {
  if (!process.stderr.listeners('error').includes(dropFailedWrite)) process.stderr.on('error', dropFailedWrite);
  process.stderr.write(`${line}\n`);
}

export function colorEnabled({ stream = process.stdout, env = process.env } = {}) {
  if (Object.hasOwn(env, 'NO_COLOR')) return false;
  if (Object.hasOwn(env, 'FORCE_COLOR')) return env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== '';
  return !!stream.isTTY && env.TERM !== 'dumb';
}

/** Cuts a word into pieces of at most `length` columns, only between graphemes. Color codes stay where they are and take
 * no room; they are split off first because Intl.Segmenter would break an escape sequence apart. A grapheme wider than
 * the room still goes alone onto a piece of its own, so the cut always moves on. */
export function chunks(word, length) {
  const result = []; let current = '', count = 0;
  for (const [index, part] of word.split(ANSI_PARTS).entries()) {
    if (index % 2) { current += part; continue; }
    for (const { segment } of graphemes(part)) {
      const width = graphemeWidth(segment);
      if (width && count && count + width > length) { result.push(current); current = ''; count = 0; }
      current += segment; count += width;
    }
  }
  if (current) result.push(current);
  return result;
}

export function wrapText(value, width = 80, indent = '') {
  const room = Math.max(1, width - displayWidth(indent));
  return String(value).split('\n').flatMap(paragraph => {
    if (!paragraph.trim()) return [''];
    const lines = []; let line = '';
    for (const word of paragraph.trim().split(/\s+/u)) {
      const size = displayWidth(word);
      if (line && displayWidth(line) + 1 + size > room) { lines.push(indent + line); line = ''; }
      const pieces = size > room ? chunks(word, room) : [word];
      for (let i = 0; i < pieces.length; i++) {
        if (line) line += ' ';
        line += pieces[i];
        if (i < pieces.length - 1) { lines.push(indent + line); line = ''; }
      }
    }
    if (line) lines.push(indent + line);
    return lines;
  }).join('\n');
}

// The Sphinx mark in half-blocks, matching the SVG logo: crowned nemes with a
// forehead band, striped lappets, eyes, mouth, and the false beard.
export const SPHINX = [
  '      ▄██████████▄',
  '    ▄██████████████▄',
  '    ████████████████',
  '   ███▄▄▄▄▄▄▄▄▄▄▄▄███',
  '  ▀▀▀▀▀██      ██▀▀▀▀▀',
  '   ▀▀▀▀██ ▀  ▀ ██▀▀▀▀',
  '   ▀▀▀▀██      ██▀▀▀▀',
  '   ▀▀▀▀██  ▀▀  ██▀▀▀▀',
  '   ▀▀▀▀██▄    ▄██▀▀▀▀',
  '   ▀▀▀▀███ ▄▄ ███▀▀▀▀',
  '   ▀▀▀▀███ ██ ███▀▀▀▀',
  '   ██████████████████',
];

export function createTerminal({ stream = process.stdout, env = process.env, width } = {}) {
  const colored = colorEnabled({ stream, env });
  const columns = Number(width ?? stream.columns ?? env.COLUMNS ?? 80);
  const size = Number.isFinite(columns) && columns > 0 ? Math.max(20, Math.min(100, columns)) : 80;
  const paint = (code, text) => colored ? `\x1b[${code}m${text}\x1b[0m` : String(text);
  const style = {
    strong: text => paint('1', text), amber: text => paint('38;5;179', text),
    green: text => paint('32', text), muted: text => paint('2', text),
  };
  const write = text => stream.write(`${text}\n`);
  const paragraph = (text, indent = '') => write(wrapText(text, size, indent));
  const section = text => { write(''); paragraph(style.strong(text)); };
  const rows = entries => {
    const maxLabel = Math.max(0, ...entries.map(([label]) => displayWidth(label)));
    const inline = size >= 68 && maxLabel <= Math.floor(size * 0.45);
    for (const [label, description] of entries) {
      if (!inline) { paragraph(style.strong(label), '  '); paragraph(description, '    '); continue; }
      const left = `  ${label}${' '.repeat(maxLabel - displayWidth(label) + 3)}`;
      const lines = wrapText(description, size - maxLabel - 5).split('\n');
      write(style.strong(left) + lines[0]);
      for (const line of lines.slice(1)) write(' '.repeat(maxLabel + 5) + line);
    }
  };
  // Columns align when they fit; narrow terminals get wrapped label/value rows.
  const table = (head, body) => {
    const widths = head.map((_, column) => Math.max(...[head, ...body].map(row => displayWidth(row[column]))));
    if (2 + widths.reduce((sum, width) => sum + width + 3, -3) > size) {
      rows(body.map(([label, ...cells]) => [label, cells.map((cell, index) => `${head[index + 1]} ${cell}`).join(' · ')]));
      return;
    }
    const pad = (cell, column) => {
      const room = ' '.repeat(widths[column] - displayWidth(cell));
      return column === 0 ? cell + room : room + cell;
    };
    write(style.muted(`  ${head.map(pad).join('   ')}`));
    for (const [label, ...cells] of body) write(`  ${[style.strong(pad(label, 0)), ...cells.map((cell, index) => pad(cell, index + 1))].join('   ')}`);
  };
  const banner = () => {
    write('');
    if (size >= 65) {
      const side = { 4: style.strong('sphinx'), 6: 'You can outsource your thinking,', 7: 'but not your understanding.' };
      SPHINX.forEach((line, index) => write(style.amber(line.padEnd(28)) + (side[index] || '')));
    } else {
      if (size >= 30) SPHINX.forEach(line => write(style.amber(line)));
      paragraph(style.strong('sphinx'));
      paragraph('You can outsource your thinking, but not your understanding.');
    }
    write('');
  };
  return {
    width: size, style, line: paragraph, paragraph, section, rows, table, banner,
    blank: () => write(''),
    success: text => paragraph(`${style.green('✓')} ${text}`),
    warning: text => paragraph(`${style.amber('!')} ${text}`),
    note: text => paragraph(style.muted(text)),
    command: text => paragraph(style.amber(text), '  '),
  };
}

export async function withProgress(label, operation, { stream = process.stderr, env = process.env, enabled = true } = {}) {
  const show = enabled && stream.isTTY && env.TERM !== 'dumb';
  const ui = createTerminal({ stream, env });
  if (show) ui.note(`${label}…`);
  return operation();
}

export function formatError(error, { stream = process.stderr, env = process.env, plain = false } = {}) {
  const ui = createTerminal({ stream, env: plain ? { ...env, NO_COLOR: '1' } : env });
  const message = error?.message || String(error);
  ui.line(`${ui.style.amber('Sphinx:')} ${message}`);
  if (plain) return;
  let next;
  if (/not a git repository|not inside.*repository/i.test(message)) next = 'Run this command inside a Git repository. For machine-wide setup, use sphinx install.';
  else if (/unknown (?:command|option)|unexpected argument/i.test(message)) next = 'Use sphinx --help for commands, or sphinx <command> --help for its options.';
  else if (/API key|requires a key/i.test(message)) next = 'Run sphinx auth, or choose your signed-in coding agent with sphinx install --provider codex.';
  else if (/already running/i.test(message)) next = 'Let the current assessment finish, then run sphinx check to resume.';
  if (next && !message.includes(next)) { ui.blank(); ui.note(next); }
}
