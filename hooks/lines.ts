// j and k at level 3 off the terminal: the text starts one line later or
// earlier, under a head that stays. The engine there clamps a plugin's
// scroll to a height it recorded when the pane opened, so a step through
// `$.ui.scroll` is cut back to row 0 after a long item opens. This file
// holds the arithmetic only: what a step is, where it stops, and what the
// page shows from that place.
//
// A step is one display line in the raw view: a line, or one piece of a
// line too long for one `Code` element (text.ts, `codeRuns`). In the
// formatted view it is one line of the Markdown: blank lines are skipped, so
// a step never shows a blank line first. A step inside a fenced code block
// shows the fence's opening line in front, so the rest still draws as code;
// a step inside a table shows the header row and the separator row in
// front, so the rest still draws as a table.

import type { ContextBreakdownContent } from '../types'
import { formatCount } from './format'
import { lineFacts } from './table'
import { CODE_LINE_CHARS, codeRuns, pieces } from './text'
import type { CodeRun } from './text'

/** One display line of the raw view: its text, and the line of the page (0-based) it belongs to. */
export type RawUnit = { line: number; text: string }

/** The display lines of a raw page: a line, or each piece of a line longer than `max`. */
export function rawUnits(text: string, max = CODE_LINE_CHARS): RawUnit[] {
  return text.split('\n').flatMap((line, index) => pieces(line, max).map(piece => ({ line: index, text: piece })))
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
/** A table's separator row: cells of dashes, with or without colons, between pipes. */
const TABLE_SEPARATOR = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/**
 * One unit of a formatted page: the line (0-based) it starts in, and the
 * lines put back in front of it so the rest still draws as it did: the
 * opening line of the fence it starts inside, or the header row and the
 * separator row of the table it starts inside. Empty elsewhere.
 */
export type MarkdownUnit = { start: number; head: readonly string[] }

/**
 * The units of a Markdown page. Each line with text starts a unit; a blank
 * line never does, so it is never the first line shown. The first unit
 * starts at the first line with text (line 0 when there is none). Inside a
 * fenced code block each line is a unit, blank lines too, under the fence's
 * opening line; the first line inside is none, as the opening line shows
 * the same, and the closing line is none. In a table the separator row is
 * no unit, and a unit that starts at a body row draws the header row and
 * the separator row in front. In a list, a block quote or a paragraph the
 * rest of the lines draw as they are.
 */
export function markdownUnits(text: string): MarkdownUnit[] {
  const lines = text.split('\n')
  const units: MarkdownUnit[] = []
  let fence: { char: string; length: number; opener: string; at: number } | null = null
  let table: readonly string[] | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const match = FENCE.exec(line)
    if (fence !== null) {
      if (match !== null && match[1]![0] === fence.char && match[1]!.length >= fence.length && match[2]!.trim() === '') {
        fence = null
      } else if (index !== fence.at + 1) {
        units.push({ start: index, head: [fence.opener] })
      }
      continue
    }
    if (line.trim() === '') {
      table = null
      continue
    }
    if (table !== null) {
      units.push({ start: index, head: table })
      continue
    }
    units.push({ start: index, head: [] })
    const next = lines[index + 1]
    if (line.includes('|') && next !== undefined && next.includes('|') && TABLE_SEPARATOR.test(next)) {
      table = [line, next]
      index += 1
      continue
    }
    if (match === null) {
      continue
    }
    const marker = match[1]!
    // A backtick fence's info may not hold a backtick: that is a code span.
    if (!(marker.startsWith('`') && match[2]!.includes('`'))) {
      fence = { char: marker[0]!, length: marker.length, opener: line, at: index }
    }
  }

  return units.length > 0 ? units : [{ start: 0, head: [] }]
}

/** The line (0-based) each unit of a Markdown page starts in (`markdownUnits`). */
export function blockStarts(text: string): number[] {
  return markdownUnits(text).map(unit => unit.start)
}

/** What j and k count on a page: display lines in the raw view, `markdownUnits` in the formatted one. */
export function unitsOf(item: Pick<ContextBreakdownContent, 'format' | 'text'>): number {
  return item.format === 'raw' ? rawUnits(item.text).length : blockStarts(item.text).length
}

/** The units skipped at the top: the stored `top` (absent is 0), within the page. */
export function topOf(item: Pick<ContextBreakdownContent, 'format' | 'text' | 'top'>): number {
  const top = Math.floor(item.top ?? 0)

  return Math.min(Math.max(0, unitsOf(item) - 1), Math.max(0, Number.isFinite(top) ? top : 0))
}

/** What one press of j (1) or k (-1) does: a new `top`, a page move, or nothing. */
export type LineMove = { top: number } | { page: 1 | -1 } | null

/**
 * j: one unit on, until the page's last unit is the first shown; there it
 * opens the next page. k: one unit back; at the first unit it opens the
 * previous page. At the item's ends it does nothing.
 */
export function lineMove(
  item: Pick<ContextBreakdownContent, 'format' | 'text' | 'top' | 'page' | 'pages'>,
  step: number,
): LineMove {
  const top = topOf(item)
  if (step > 0) {
    if (top < unitsOf(item) - 1) {
      return { top: top + 1 }
    }

    return item.page + 1 < item.pages ? { page: 1 } : null
  }
  if (step < 0) {
    if (top > 0) {
      return { top: top - 1 }
    }

    return item.page > 0 ? { page: -1 } : null
  }

  return null
}

/**
 * The `top` that shows about `rows` lines at the end of a page, for k into
 * the previous page: in the raw view the last `rows` display lines; in the
 * formatted view the last unit that starts at least `rows` lines before the
 * end. Never below 0; `rows` 0 or less shows the last unit alone.
 */
export function endTop(item: Pick<ContextBreakdownContent, 'format' | 'text'>, rows: number): number {
  const units = unitsOf(item)
  if (item.format === 'raw') {
    return Math.min(units - 1, Math.max(0, units - Math.max(0, rows)))
  }
  const total = item.text.split('\n').length
  const starts = blockStarts(item.text)
  let top = 0
  starts.forEach((start, index) => {
    if (total - start >= rows) {
      top = index
    }
  })

  return top
}

/**
 * The raw page's `Code` runs from display line `top` on. The gutter's
 * numbers stay right: a piece of a long line repeats its line's number, as
 * `codeRuns` draws it. `isSplit` is the whole page's, so the facts line does
 * not change while j and k step.
 */
export function shownRuns(
  text: string,
  startLine: number | null,
  top: number,
  max = CODE_LINE_CHARS,
): { runs: CodeRun[]; isSplit: boolean } {
  const whole = codeRuns(text, startLine, max)
  if (top <= 0) {
    return whole
  }
  const units = rawUnits(text, max).slice(top)
  if (startLine === null) {
    return { runs: [{ source: units.map(unit => unit.text).join('\n'), startLine: null }], isSplit: whole.isSplit }
  }
  const isLong = text.split('\n').map(line => line.length > max)
  const runs: CodeRun[] = []
  let held: string[] = []
  let heldStart = startLine
  const flush = () => {
    if (held.length > 0) {
      runs.push({ source: held.join('\n'), startLine: heldStart })
    }
    held = []
  }
  for (const unit of units) {
    if (isLong[unit.line] === true) {
      flush()
      runs.push({ source: unit.text, startLine: startLine + unit.line })
    } else {
      if (held.length === 0) {
        heldStart = startLine + unit.line
      }
      held.push(unit.text)
    }
  }
  flush()

  return { runs, isSplit: whole.isSplit }
}

/**
 * The formatted page's Markdown from unit `top` on, under the unit's head: a
 * unit inside a fence starts with the fence's opening line, so the rest
 * still draws as code and its own closing line still closes it; a unit
 * inside a table starts with its header row and separator row.
 */
export function shownMarkdown(text: string, top: number): string {
  if (top <= 0) {
    return text
  }
  const units = markdownUnits(text)
  const unit = units[Math.min(top, units.length - 1)]!

  return [...unit.head, ...text.split('\n').slice(unit.start)].join('\n')
}

type Place = Pick<
  ContextBreakdownContent,
  'format' | 'text' | 'top' | 'page' | 'pages' | 'firstLine' | 'lastLine' | 'lines'
>

/**
 * The first line each unit of the page shows, in the raw view's lines, as
 * the facts line counts them. The formatted view maps its unit's place in
 * the page onto the page's lines, as it maps its pages.
 */
export function unitFirstLines(item: Place): number[] {
  if (item.format === 'raw') {
    return rawUnits(item.text).map(unit => Math.min(item.lastLine, item.firstLine + unit.line))
  }
  const total = item.text.split('\n').length
  const span = item.lastLine - item.firstLine

  return blockStarts(item.text).map((start, index) =>
    index === 0 ? item.firstLine : Math.min(item.lastLine, item.firstLine + Math.round((start * span) / Math.max(1, total - 1))),
  )
}

/** The first line shown, in the raw view's lines (`unitFirstLines`). */
export function shownFirstLine(item: Place): number {
  const top = topOf(item)

  return top === 0 ? item.firstLine : (unitFirstLines(item)[top] ?? item.firstLine)
}

/**
 * The `top` that shows line `line` (in the raw view's lines) first: the
 * first unit that starts in it, else the nearest unit before it; 0 when the
 * page starts after it. A switch of view or source keeps the place by it.
 */
export function topAtLine(item: Place, line: number): number {
  const firsts = unitFirstLines(item)
  let best = 0
  firsts.forEach((first, index) => {
    if (first <= line && first > firsts[best]!) {
      best = index
    }
  })

  return best
}

/**
 * The place part of the facts line: as `lineFacts` says it at the top of a
 * page; once j moved the text, from the first line shown, also on an item
 * of one page.
 */
export function shownFacts(item: Place): string {
  if (topOf(item) === 0) {
    return lineFacts(item)
  }
  const first = shownFirstLine(item)
  if (item.pages > 1) {
    return lineFacts({ ...item, firstLine: first })
  }
  const of = `of ${formatCount(item.lines)}`

  return first >= item.lastLine
    ? `line ${formatCount(first)} ${of}`
    : `lines ${formatCount(first)}-${formatCount(item.lastLine)} ${of}`
}
