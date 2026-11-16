// Text helpers for items: safe display text, short titles, stable ids,
// shortened paths, and the pages of a long text.

/** Lines on one page of level 3. */
export const PAGE_LINES = 50
/** Characters on one page of level 3, so one long line cannot fill a tree. */
export const PAGE_CHARS = 8000

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]/g
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/**
 * Text the pane may draw: terminal escapes out, carriage returns folded,
 * other control characters shown as "?". Tab and newline stay.
 */
export function displayText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(ANSI, '').replace(CONTROL, '?')
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

/** Cells one character takes in a terminal: 2 when wide, 0 for a combining mark. */
function charCells(char: string): number {
  if (/\p{Mn}|\p{Me}|‍|️/u.test(char)) {
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
  // Start after a surrogate pair's first half, never inside the pair.
  const start = from > 0 && safeCut(tail, from) !== from ? from + 1 : Math.max(0, from)

  return `…${tail.slice(start)}`
}

/** Moves an offset off the second half of a surrogate pair. */
function safeCut(text: string, at: number): number {
  const code = text.charCodeAt(at)

  return at > 0 && at < text.length && code >= 0xdc00 && code <= 0xdfff ? at - 1 : at
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
        end = lines === 0 ? safeCut(text, start + PAGE_CHARS) : end
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

export type TextPage = {
  /** 0-based, clamped to the pages there are. */
  page: number
  pages: number
  text: string
  /** The 1-based number of the line the page starts in. */
  startLine: number
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

  return {
    page: index,
    pages: starts.length,
    text: text.slice(from, to).replace(/\n$/, ''),
    startLine,
  }
}
