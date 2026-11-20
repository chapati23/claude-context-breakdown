// The formatted view of level 3: an item's text made into Markdown that the
// Markdown element can draw, cut into pages that each draw correctly alone.
// Pure: no engine calls.

import type { ContextBreakdownFormat, ContextBreakdownSource } from '../types'
import { readLines } from './reminder'
import { PAGE_CHARS, PAGE_LINES, safeCut } from './text'

/**
 * What an item's text is, for the formatted view:
 * - `prose`: Markdown by its kind (a skill body, a prompt, Claude's reply,
 *   the compaction summary). It opens formatted.
 * - `file`: a file's own text (a memory file, a Read result): Markdown when
 *   the path ends in `.md`, else code fenced in the file's language. A
 *   Markdown file opens formatted; another file opens raw.
 * - `output`: terminal output (Bash, Grep, Glob), fenced as plain text.
 * - `text`: anything else (other tool results, task reports, injected
 *   text): Markdown with tags escaped. It opens raw.
 */
export type Markup = 'prose' | 'file' | 'output' | 'text'

/** What decides an item's views. */
export type MarkupOf = { markup: Markup; path: string | null; isNumbered: boolean }

export function isMarkdownPath(path: string | null): boolean {
  return path !== null && /\.md$/i.test(path)
}

/**
 * The view an item opens in: formatted for Markdown by kind and for a file
 * in Markdown (a memory file, a Read result); raw for the rest. The formatted
 * view of a Read result leaves out its line numbers; the raw view has the
 * text as the model read it.
 */
export function defaultFormat(item: MarkupOf): ContextBreakdownFormat {
  if (item.markup === 'prose') {
    return 'formatted'
  }

  return item.markup === 'file' && isMarkdownPath(item.path) ? 'formatted' : 'raw'
}

/** A Read result without its line-number prefixes; lines after them stay. */
export function stripLineNumbers(text: string): string {
  const read = readLines(text)
  if (read === null) {
    return text
  }
  const rest = text.replace(/\r\n?/g, '\n').split('\n').slice(read.lines.length)

  return [...read.lines, ...rest].join('\n')
}

/** The info string a fence gets for a file: its extension, or none. */
export function languageOf(path: string | null): string {
  const name = path?.split(/[/\\]/).pop() ?? ''
  const ext = /\.([A-Za-z0-9+#-]{1,16})$/.exec(name)?.[1]

  return ext === undefined ? '' : ext.toLowerCase()
}

/** A code block around `text`, its fence longer than any backtick run inside. */
export function fenced(text: string, info: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 2)
  const marker = '`'.repeat(longest + 1)

  return `${marker}${info}\n${text}\n${marker}`
}

// Fences, as CommonMark opens and closes them (any indent: a fence inside a
// list item is indented too).

type Fence = { indent: string; marker: string; info: string }

const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/

function fenceOpen(line: string): Fence | null {
  const match = FENCE.exec(line)
  if (match === null) {
    return null
  }
  const [, indent, marker, info] = match as unknown as [string, string, string, string]
  // A backtick fence's info string holds no backtick (it would be code).
  if (marker.startsWith('`') && info.includes('`')) {
    return null
  }

  return { indent, marker, info: info.trimEnd() }
}

function closes(line: string, fence: Fence): boolean {
  const match = FENCE_CLOSE.exec(line)

  return match !== null && match[1]![0] === fence.marker[0] && match[1]!.length >= fence.marker.length
}

/** Per line: the fence open where it starts, and whether it is code (fence lines too). */
function fenceRoles(lines: readonly string[]): { before: (Fence | null)[]; inCode: boolean[]; isClose: boolean[] } {
  const before: (Fence | null)[] = []
  const inCode: boolean[] = []
  const isClose: boolean[] = []
  let open: Fence | null = null
  for (const line of lines) {
    before.push(open)
    if (open === null) {
      open = fenceOpen(line)
      inCode.push(open !== null)
      isClose.push(false)
    } else {
      inCode.push(true)
      const isEnd = closes(line, open)
      isClose.push(isEnd)
      if (isEnd) {
        open = null
      }
    }
  }

  return { before, inCode, isClose }
}

const isBlank = (line: string) => line.trim() === ''

// Escaping: what the Markdown element would hide or drop is written so it
// draws as the characters it is.

/** `<` that starts a tag, a comment or a declaration. */
const TAG_START = /(\\*)<(?=[A-Za-z/!?])/g
/** An autolink, which draws as a link and must keep its `<`. */
const AUTOLINK = /^<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>/
/** A link reference definition: the renderer draws nothing for one. */
const DEFINITION = /^( {0,3})\[(?=[^\]\n]+\]:)/gm
/** A code span: a run of backticks to the next run of the same length. */
const CODE_SPAN = /(?<!`)(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g

function escapeTags(text: string): string {
  return text.replace(TAG_START, (match, slashes: string, offset: number) => {
    // An odd count of backslashes already escapes the `<`.
    if (slashes.length % 2 === 1 || AUTOLINK.test(text.slice(offset + slashes.length))) {
      return match
    }

    return `${slashes}\\<`
  })
}

/** One paragraph with tags (and definitions, if asked) escaped, code spans left alone. */
function escapeParagraph(text: string, escapesDefinitions: boolean): string {
  let out = ''
  let last = 0
  for (const span of text.matchAll(CODE_SPAN)) {
    out += escapeTags(text.slice(last, span.index))
    out += span[0]
    last = span.index + span[0].length
  }
  out += escapeTags(text.slice(last))

  return escapesDefinitions ? out.replace(DEFINITION, '$1\\[') : out
}

/**
 * Markdown with raw tags escaped, so the element draws them as written: the
 * terminal draws a tag as written, but a tag that opens a line swallows the
 * Markdown after it, and another surface may hide it. Link definitions are
 * escaped only in text that is not Markdown (`escapesDefinitions`): the
 * element draws nothing for one, which is right in Markdown, where a
 * reference link uses it. Code (fences, indented blocks, spans) is left alone.
 */
export function escapeMarkdown(text: string, escapesDefinitions: boolean): string {
  const lines = text.split('\n')
  const { inCode } = fenceRoles(lines)
  const out: string[] = []
  let block: string[] = []
  const flush = () => {
    if (block.length === 0) {
      return
    }
    // An indented code block: four spaces or a tab after a blank line.
    const isIndented = block.every(line => /^(?: {4}|\t)/.test(line))
    out.push(isIndented ? block.join('\n') : escapeParagraph(block.join('\n'), escapesDefinitions))
    block = []
  }
  lines.forEach((line, i) => {
    if (inCode[i] || isBlank(line)) {
      flush()
      out.push(line)
    } else {
      block.push(line)
    }
  })
  flush()

  return out.join('\n')
}

/** YAML frontmatter at the head of a Markdown file, fenced so it draws as written. */
function withFencedFrontmatter(text: string): string {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text)
  if (match === null) {
    return text
  }

  return `${fenced(match[1]!, 'yaml')}\n${text.slice(match[0].length)}`
}

function asMarkdown(text: string, escapesDefinitions: boolean): string {
  return escapeMarkdown(withFencedFrontmatter(text), escapesDefinitions)
}

/**
 * The Markdown the formatted view draws for an item's whole text. `text` is
 * already display text (line ends folded, control characters out).
 */
export function formattedSource(item: MarkupOf, source: ContextBreakdownSource, whole: string): string {
  // A last newline would put a blank line inside a fence.
  const text = whole.replace(/\n+$/, '')
  if (source === 'disk' || item.markup === 'file') {
    // A file's own text; a Read result's numbers are for the raw view only.
    const body = source === 'loaded' && item.isNumbered ? stripLineNumbers(text) : text

    return isMarkdownPath(item.path) ? asMarkdown(body, false) : fenced(body, languageOf(item.path))
  }
  if (item.markup === 'output') {
    return fenced(text, '')
  }

  // Only `text` is not Markdown by kind: its definitions draw as written.
  return asMarkdown(text, item.markup === 'text')
}

// Pages: cut at blank lines outside code where they can be; a fence cut by
// a page is closed and opened again; a table cut by a page repeats its head.

/** The longest piece of one line: a page always holds one whole piece. */
const PIECE_CHARS = PAGE_CHARS / 2
/**
 * A table row is not cut below this length, though its page grows: at most
 * by a head and one row, so the largest page stays inside a tree.
 */
const ROW_CHARS = PAGE_CHARS
/** A table head longer than this is not repeated on the next page. */
const HEAD_CHARS = PAGE_CHARS / 4
/** Room kept on a page for the line that closes a fence. */
const CLOSE_CHARS = 64
/** A cut at a blank line must fill this share of a page, else a page is cut fuller. */
const MIN_FILL = 0.25

const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/
/** Links, images, autolinks, bare addresses and code spans: a cut stays out of them. */
const UNCUTTABLE = /!?\[[^\]\n]*\]\([^)\n]*\)|<[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]*>|https?:\/\/[^\s<>]+|(`+)[^`]+?\1/g
/** What starts a block at the head of a line: a piece that starts a page must not. */
const BLOCK_START = /^(\d{1,9})([.)])|^(?:[#>+\-*=|]|`{3,}|~{3,})/

type Piece = { text: string; line: number; joins: boolean }

/** Per line: the head row of the table it is a body row of, or -1; and rows a cut must not precede. */
function tableRoles(lines: readonly string[], inCode: readonly boolean[]): { head: number[]; isDelimiter: boolean[] } {
  const head: number[] = []
  const isDelimiter: boolean[] = lines.map(() => false)
  let current = -1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    if (inCode[i] || isBlank(line)) {
      current = -1
      head.push(-1)
      continue
    }
    if (current >= 0) {
      head.push(current)
      continue
    }
    head.push(-1)
    const next = lines[i + 1]
    if (line.includes('|') && next !== undefined && !inCode[i + 1] && next.includes('|') && DELIMITER.test(next)) {
      isDelimiter[i + 1] = true
      head.push(-1)
      current = i
      i += 1
    }
  }

  return { head, isDelimiter }
}

/** Per line: whether a link or a code span is still open where it starts. */
function openSpans(lines: readonly string[], inCode: readonly boolean[]): boolean[] {
  const out: boolean[] = []
  let depth = 0
  let inTarget = false
  let code = 0
  lines.forEach((line, i) => {
    out.push(depth > 0 || inTarget || code > 0)
    if (inCode[i] || isBlank(line)) {
      depth = 0
      inTarget = false
      code = 0

      return
    }
    for (let c = 0; c < line.length; c += 1) {
      const char = line[c]
      if (char === '\\') {
        c += 1
        continue
      }
      if (char === '`') {
        let run = 1
        while (line[c + run] === '`') {
          run += 1
        }
        c += run - 1
        code = code === 0 ? run : code === run ? 0 : code
        continue
      }
      if (code > 0) {
        continue
      }
      if (inTarget) {
        inTarget = char !== ')'
        continue
      }
      if (char === '[') {
        depth += 1
      } else if (char === ']' && depth > 0) {
        depth -= 1
        if (depth === 0 && line[c + 1] === '(') {
          inTarget = true
          c += 1
        }
      }
    }
  })

  return out
}

/** Where to cut a line longer than a piece: at a space outside links and code spans. */
function cutAt(text: string, max: number, isCode: boolean): number {
  if (isCode) {
    return Math.max(1, safeCut(text, max))
  }
  const spans: [number, number][] = []
  for (const match of text.matchAll(UNCUTTABLE)) {
    if (match.index >= max) {
      break
    }
    spans.push([match.index, match.index + match[0].length])
  }
  const isInside = (at: number) => spans.some(([from, to]) => at > from && at < to)
  // After the last space of a run, so the next piece starts with a word.
  for (let at = max; at > 0; at -= 1) {
    if (/\s/.test(text[at - 1]!) && !/\s/.test(text[at] ?? '') && !isInside(at)) {
      return at
    }
  }
  // No space: cut before the span the limit falls in, or at the limit.
  const span = spans.find(([from, to]) => from > 0 && max > from && max < to)

  return span !== undefined ? span[0] : Math.max(1, safeCut(text, max))
}

function piecesOf(
  lines: readonly string[],
  inCode: readonly boolean[],
  head: readonly number[],
  isDelimiter: readonly boolean[],
): Piece[] {
  const pieces: Piece[] = []
  lines.forEach((line, i) => {
    const isRow = head[i]! >= 0 || isDelimiter[i] === true || isDelimiter[i + 1] === true
    if (line.length <= PIECE_CHARS || (isRow && line.length <= ROW_CHARS)) {
      pieces.push({ text: line, line: i, joins: false })

      return
    }
    let rest = line
    let joins = false
    while (rest.length > PIECE_CHARS) {
      const at = cutAt(rest, PIECE_CHARS, inCode[i]!)
      pieces.push({ text: rest.slice(0, at), line: i, joins })
      rest = rest.slice(at)
      joins = true
    }
    pieces.push({ text: rest, line: i, joins })
  })

  return pieces
}

/** The most characters of link definitions a page takes from other pages. */
const DEFINITION_CHARS = 4000
/** A link definition on one line: `[label]: target`. */
const LINK_DEFINITION = /^ {0,3}\[([^\]\n]+)\]:\s*\S/
/** Any bracket group: a reference's label, or the text of a shortcut reference. */
const BRACKETS = /\[([^\]\n]+)\]/g

function labelOf(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Each page is drawn on its own, so a reference link (`[text][label]`) whose
 * definition is on another page would draw as plain text. Every page gets
 * the definitions it uses and does not hold, after its text; a definition
 * draws nothing itself.
 */
function withDefinitions(pages: MarkdownPageText[], lines: readonly string[], inCode: readonly boolean[]): MarkdownPageText[] {
  const definitions = new Map<string, string>()
  lines.forEach((line, i) => {
    const label = inCode[i] || line.length > 1000 ? undefined : LINK_DEFINITION.exec(line)?.[1]
    // The first definition of a label is the one Markdown uses.
    if (label !== undefined && !definitions.has(labelOf(label))) {
      definitions.set(labelOf(label), line.trim())
    }
  })
  if (definitions.size === 0) {
    return pages
  }

  return pages.map(page => {
    const own = new Set(page.text.split('\n').map(line => line.trim()))
    const added: string[] = []
    let chars = 0
    for (const match of page.text.matchAll(BRACKETS)) {
      const definition = definitions.get(labelOf(match[1]!))
      if (definition === undefined || own.has(definition) || chars + definition.length > DEFINITION_CHARS) {
        continue
      }
      own.add(definition)
      added.push(definition)
      chars += definition.length + 1
    }

    return added.length === 0 ? page : { ...page, text: `${page.text}\n\n${added.join('\n')}` }
  })
}

/** One page of the formatted view: its Markdown and the source lines it starts and ends in (1-based). */
export type MarkdownPageText = { text: string; startLine: number; endLine: number }

/** The pages of a Markdown text, each one drawable on its own. */
export function markdownPages(markdown: string): MarkdownPageText[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const { before, inCode, isClose } = fenceRoles(lines)
  const { head, isDelimiter } = tableRoles(lines, inCode)
  const isOpen = openSpans(lines, inCode)
  const pieces = piecesOf(lines, inCode, head, isDelimiter)
  // The fence open where piece k starts; a piece of a split line shares its line's.
  const fenceAt = (k: number) => (k < pieces.length ? before[pieces[k]!.line]! : null)
  const pages: MarkdownPageText[] = []

  let i = 0
  while (i < pieces.length) {
    const first = pieces[i]!
    const prefix: string[] = []
    const fence = fenceAt(i)
    if (fence !== null) {
      prefix.push(`${fence.indent}${fence.marker}${fence.info}`)
    }
    const row = head[first.line]!
    if (row >= 0 && !first.joins && lines[row]!.length + lines[row + 1]!.length < HEAD_CHARS) {
      prefix.push(lines[row]!, lines[row + 1]!)
    }
    const room = PAGE_CHARS - CLOSE_CHARS - prefix.reduce((sum, line) => sum + line.length + 1, 0)

    // Fill: at least one piece, then while the characters and lines fit.
    let j = i
    let chars = 0
    let count = prefix.length
    const filled: { chars: number; lines: number }[] = []
    while (j < pieces.length) {
      const piece = pieces[j]!
      const startsLine = j === i || !piece.joins
      const add = piece.text.length + (j > i && !piece.joins ? 1 : 0)
      if (j > i && (chars + add > room || (startsLine && count + 1 > PAGE_LINES))) {
        break
      }
      chars += add
      count += startsLine ? 1 : 0
      j += 1
      filled.push({ chars, lines: count })
    }

    // Where to cut, before piece k: the last blank line outside code that
    // fills enough; else the last line end outside links, code spans and a
    // table's head, an indented line last; else where the room ended.
    let end = j
    if (j < pieces.length) {
      const canCut = (k: number) => !pieces[k]!.joins && !isOpen[pieces[k]!.line] && !isDelimiter[pieces[k]!.line]
      // Not right after a fence's opening line: the page would end with an empty block.
      const isAfterOpen = (k: number) => {
        const prev = pieces[k - 1]!.line

        return inCode[prev]! && before[prev] === null
      }
      // A line indented four spaces that starts a page draws as an indented
      // code block (a nested list line, say): such a cut comes last.
      const isIndented = (k: number) => !inCode[pieces[k]!.line] && /^(?: {4}|\t)/.test(lines[pieces[k]!.line]!)
      // Not before a fence's closing line: the next page would hold an empty block.
      const atLineEnd = (k: number) => canCut(k) && !isClose[pieces[k]!.line] && !isAfterOpen(k)
      const fill = (k: number) => {
        const at = filled[k - i - 1]!

        return Math.max(at.chars / room, at.lines / PAGE_LINES)
      }
      // A blank line right after a heading is no cut: the heading stays with its text.
      const atBlank = (k: number) => {
        const prev = pieces[k - 1]!.line

        return (
          canCut(k) &&
          !isIndented(k) &&
          !pieces[k - 1]!.joins &&
          isBlank(lines[prev]!) &&
          !inCode[prev] &&
          !HEADING.test(lines[prev - 1] ?? '')
        )
      }
      let found = -1
      for (let k = j; k > i && found === -1; k -= 1) {
        if (atBlank(k) && fill(k) >= MIN_FILL) {
          found = k
        }
      }
      for (let k = j; k > i && found === -1; k -= 1) {
        if (atLineEnd(k) && !isIndented(k)) {
          found = k
        }
      }
      for (let k = j; k > i && found === -1; k -= 1) {
        if (atLineEnd(k)) {
          found = k
        }
      }
      end = found === -1 ? j : found
    }

    const body: string[] = []
    for (let k = i; k < end; k += 1) {
      const piece = pieces[k]!
      let text = piece.text
      // A piece that goes on from the page before must not start a block.
      if (k === i && piece.joins && !inCode[piece.line]) {
        text = text.replace(BLOCK_START, (match, digits?: string, mark?: string) =>
          digits === undefined ? `\\${match}` : `${digits}\\${mark}`,
        )
      }
      if (k > i && piece.joins) {
        body[body.length - 1] += text
      } else {
        body.push(text)
      }
    }
    // A fence still open where the page ends is closed on it.
    const open = fenceAt(end)
    let text = [...prefix, ...body].join('\n')
    text = open === null ? text.replace(/\s+$/, '') : `${text}\n${open.indent}${open.marker}`
    pages.push({ text, startLine: first.line + 1, endLine: pieces[end - 1]!.line + 1 })
    i = end
  }

  if (pages.length === 0) {
    return [{ text: '', startLine: 1, endLine: 1 }]
  }

  return pages.length > 1 ? withDefinitions(pages, lines, inCode) : pages
}

/** The line at the same share of a text of `to` lines as `line` is of `from` lines. */
export function mappedLine(line: number, from: number, to: number): number {
  if (from <= 1 || to <= 1) {
    return 1
  }

  return 1 + Math.round(((line - 1) * (to - 1)) / (from - 1))
}

/**
 * The index of the last page that starts at or before `line`; when several
 * pages start in that very line (one long line cut into pages), the first
 * of them, where the line begins.
 */
export function pageAtLine(starts: readonly number[], line: number): number {
  let index = 0
  starts.forEach((start, k) => {
    if (start <= line) {
      index = k
    }
  })
  while (index > 0 && starts[index] === line && starts[index - 1] === line) {
    index -= 1
  }

  return index
}
