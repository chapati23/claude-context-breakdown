// Text helpers for items: safe display text, short titles, stable ids,
// shortened paths, and the pages of a long text.

/**
 * The characters one tree draws: the engine cuts the texts after them
 * (children, Code sources, Markdown texts and labels together).
 */
export const TREE_CHARS = 100_000

// One page of level 3 is one text that the engine scrolls (the wheel, the
// arrows, j and k), so a page is as large as is safe: most instruction
// files, skill bodies and replies fit on one. A formatted page can grow past
// PAGE_CHARS by a table head and one table row (see markdown.ts), and still
// leaves the rest of the tree well inside TREE_CHARS.

/** Lines on one page of level 3. */
export const PAGE_LINES = 500
/** Characters on one page of level 3, so one long text cannot fill a tree. */
export const PAGE_CHARS = 40_000

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]/g
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/**
 * Text the pane may draw: terminal escapes out, carriage returns folded,
 * other control characters shown as "?". Tab and newline stay.
 */
export function displayText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(ANSI, '').replace(CONTROL, '?')
}

/** The longest name the snapshot keeps: a row shows far less, and state stays small. */
export const NAME_MAX_CHARS = 200

// An 8-bit CSI sequence: its parameters go with it, or "31m" would stay.
const C1_CSI = /\x9b[0-?]*[ -/]*[@-~]/g
// Invisible format characters (zero-width, bidi, joiners) and variation
// selectors: a terminal draws them in no cell or joins or reorders the
// characters around them, so a row would measure wider than it draws.
const INVISIBLE = /[\p{Cf}\u{fe00}-\u{fe0f}\u{e0100}-\u{e01ef}]/gu

/**
 * A name from outside (an MCP server's) for one table row: terminal escapes,
 * control and invisible format characters out, and tabs and newlines turned
 * to one space, so it stays one line. "?" for a name that leaves nothing.
 */
export function plainName(text: string): string {
  const flat = text
    .replace(ANSI, '')
    .replace(C1_CSI, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim()
  const kept = flat.length > NAME_MAX_CHARS ? flat.slice(0, safeCut(flat, NAME_MAX_CHARS)) : flat

  return kept === '' ? '?' : kept
}

/** One line of at most `max` characters: tags out, white space collapsed. */
export function firstWords(text: string, max = 60): string {
  const flat = displayText(text)
    .replace(/<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat.length <= max) {
    return flat
  }

  return `${flat.slice(0, safeCut(flat, Math.max(0, max - 1))).trimEnd()}…`
}

// Wide East Asian ranges (Unicode East_Asian_Width W and F), in code points.
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
]

/** Cells one character takes in a terminal: 2 when wide, 0 for a combining mark or a format character. */
function charCells(char: string): number {
  if (/\p{Mn}|\p{Me}|\p{Cf}|️/u.test(char)) {
    return 0
  }
  const code = char.codePointAt(0) ?? 0

  return WIDE.some(([from, to]) => code >= from && code <= to) ? 2 : 1
}

/** Cells a text takes in a terminal. */
export function cellWidth(text: string): number {
  let cells = 0
  for (const char of text) {
    cells += charCells(char)
  }

  return cells
}

/** The longest head of a text that fits in `cells` cells; never splits a character. */
export function headCells(text: string, cells: number): string {
  let used = 0
  let end = 0
  for (const char of text) {
    const width = charCells(char)
    if (used + width > cells) {
      break
    }
    used += width
    end += char.length
  }

  return text.slice(0, end)
}

/** A short, stable fingerprint of a text (FNV-1a, 32 bits, base 36). */
export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(36)
}

/**
 * A path for a row: the home folder as "~", then the last parts after "…"
 * when it is still longer than `max`.
 */
export function shortenPath(path: string, max = 48): string {
  const home = path.replace(/^\/(?:Users|home)\/[^/]+(?=\/)/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\)/, '~')
  if (home.length <= max) {
    return home
  }
  const parts = home.split(/[/\\]/)
  let tail = parts.pop() ?? home
  while (parts.length > 0 && tail.length + parts[parts.length - 1]!.length + 3 <= max) {
    tail = `${parts.pop()}/${tail}`
  }

  if (tail.length + 2 <= max) {
    return `…/${tail}`
  }
  const from = tail.length - Math.max(1, max - 1)
  // Start after the character the cut falls in, never inside it.
  let start = Math.max(0, from)
  while (start > 0 && start < tail.length && safeCut(tail, start) !== start) {
    start += 1
  }

  return `…${tail.slice(start)}`
}

/** Code points that belong to the character before them: marks, variation selectors, joiners. */
const JOINS_BACK = /^[\p{M}\u200d\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/u

/** Whether a piece starting at `at` would start inside a character. */
function isInside(text: string, at: number): boolean {
  const code = text.charCodeAt(at)
  if (code >= 0xdc00 && code <= 0xdfff) {
    return true
  }
  if (JOINS_BACK.test(text.slice(at, at + 2))) {
    return true
  }
  // The part after a zero-width joiner joins the part before it.
  return text.charCodeAt(at - 1) === 0x200d
}

/**
 * Moves an offset back to the start of its character: off the second half of a
 * surrogate pair, a combining mark, a variation selector, or a part of a
 * zero-width joiner sequence. When no start is found before `from`, the offset
 * stays as it was, so a cut of a non-empty piece never becomes 0.
 */
export function safeCut(text: string, at: number, from = 0): number {
  if (at <= from || at >= text.length) {
    return at
  }
  let cut = at
  while (cut > from && isInside(text, cut)) {
    cut -= 1
  }

  return cut > from ? cut : at
}

/**
 * The start offset of every page: at most PAGE_LINES lines and PAGE_CHARS
 * characters each. A line longer than a page is cut into pieces.
 */
export function pageStarts(text: string): number[] {
  const starts = [0]
  let start = 0
  while (start < text.length) {
    let end = start
    let lines = 0
    while (end < text.length && lines < PAGE_LINES) {
      const newline = text.indexOf('\n', end)
      const lineEnd = newline === -1 ? text.length : newline + 1
      if (lineEnd - start > PAGE_CHARS) {
        end = lines === 0 ? safeCut(text, start + PAGE_CHARS, start) : end
        break
      }
      end = lineEnd
      lines += 1
    }
    if (end <= start) {
      end = Math.min(text.length, start + PAGE_CHARS)
    }
    if (end >= text.length) {
      break
    }
    starts.push(end)
    start = end
  }

  return starts
}

/** The 1-based number of the line each page starts in. */
export function pageLines(text: string): number[] {
  const out: number[] = []
  let line = 1
  let at = 0
  for (const start of pageStarts(text)) {
    for (let i = text.indexOf('\n', at); i !== -1 && i < start; i = text.indexOf('\n', i + 1)) {
      line += 1
      at = i + 1
    }
    out.push(line)
  }

  return out
}

export type TextPage = {
  /** 0-based, clamped to the pages there are. */
  page: number
  pages: number
  text: string
  /** The 1-based number of the line the page starts in. */
  startLine: number
  /** The 1-based number of the line the page ends in. */
  endLine: number
}

/** How many newlines a text holds. */
export function newlines(text: string): number {
  let count = 0
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    count += 1
  }

  return count
}

/** One page of a text, with its position. */
export function textPage(text: string, page: number): TextPage {
  const starts = pageStarts(text)
  const index = Math.min(Math.max(0, Math.floor(page)), starts.length - 1)
  const from = starts[index]!
  const to = starts[index + 1] ?? text.length
  let startLine = 1
  for (let i = text.indexOf('\n'); i !== -1 && i < from; i = text.indexOf('\n', i + 1)) {
    startLine += 1
  }
  const shown = text.slice(from, to).replace(/\n$/, '')

  return {
    page: index,
    pages: starts.length,
    text: shown,
    startLine,
    endLine: startLine + newlines(shown),
  }
}

/**
 * The longest line one piece of the raw view holds. Claude Code's `Code`
 * element cuts a line after about 2,000 characters and adds "… [+N chars]"
 * (seen live; the declarations do not say), so a longer line would lose its
 * end in the view that promises the exact text. Half that leaves room.
 */
export const CODE_LINE_CHARS = 1000

/** One `Code` element of the raw view: its text and the number of its first line, or null for no gutter. */
export type CodeRun = { source: string; startLine: number | null }

/** Cuts a line into pieces of at most `max` characters; never splits a character. */
export function pieces(line: string, max: number): string[] {
  const out: string[] = []
  let at = 0
  while (line.length - at > max) {
    const end = Math.max(at + 1, safeCut(line, at + max, at))
    out.push(line.slice(at, end))
    at = end
  }
  out.push(line.slice(at))

  return out
}

/**
 * The raw view's text as `Code` elements, so no line is longer than `max`:
 * a longer line is split into pieces. Without a gutter the pieces are lines
 * of one element, which looks as the line would look wrapped. With a gutter
 * each piece is an element of its own that repeats the line's number, so the
 * lines after it keep their numbers. `isSplit` says whether any line was.
 */
export function codeRuns(
  text: string,
  startLine: number | null,
  max = CODE_LINE_CHARS,
): { runs: CodeRun[]; isSplit: boolean } {
  const lines = text.split('\n')
  if (lines.every(line => line.length <= max)) {
    return { runs: [{ source: text, startLine }], isSplit: false }
  }
  if (startLine === null) {
    return { runs: [{ source: lines.flatMap(line => pieces(line, max)).join('\n'), startLine }], isSplit: true }
  }
  const runs: CodeRun[] = []
  let held: string[] = []
  let heldStart = startLine
  lines.forEach((line, index) => {
    const number = startLine + index
    if (line.length <= max) {
      held.push(line)

      return
    }
    if (held.length > 0) {
      runs.push({ source: held.join('\n'), startLine: heldStart })
    }
    for (const piece of pieces(line, max)) {
      runs.push({ source: piece, startLine: number })
    }
    held = []
    heldStart = number + 1
  })
  if (held.length > 0) {
    runs.push({ source: held.join('\n'), startLine: heldStart })
  }

  return { runs, isSplit: true }
}
