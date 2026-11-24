// The bar's cells as text, and the chip that names a segment beside it:
// worked out without drawing.

import type { ContextBreakdownSegmentId } from '../types'
import { formatTokens } from './format'
import type { LayoutPart, SegmentPart } from './layout'
import { segmentDef } from './segments'
import { cellWidth, headCells } from './text'

export const FILLED = '█'
/**
 * Seven eighths of a cell: the last cell of a segment, so one eighth of the
 * terminal's own background separates it from the next. It costs no cell.
 */
export const EDGE = '▉'
/** The compaction summary's texture: condensed history, beside the reserve's ▒. */
export const TEXTURE = '▓'
export const FREE = '·'
export const RESERVE = '▒'
/**
 * The scale break: two U+2571 slashes, the only diagonal on the row. It
 * stands where the bar leaves out free space in a large window while use is
 * low (see `isCompressed` in layout.ts). Drawn in the host's dim ink, as the
 * total is, so it adds no colour of the mod's own.
 */
export const SCALE_BREAK = '╱╱'
/**
 * Cells the scale break takes: its two slashes and one free dot after them.
 * The dot says that free space goes on past the scale break, and keeps the slashes
 * off the reserve's ▒.
 */
export const SCALE_BREAK_CELLS = 3

/** Segments drawn in a texture: the texture itself sets them apart, so no edge. */
export const TEXTURED: ReadonlySet<string> = new Set(['compaction-summary'])
/**
 * About how much of a cell the texture covers; the background shows through
 * the rest. An estimate: the pattern depends on the font.
 */
export const TEXTURE_COVERAGE = 0.75

/**
 * One segment's cells, in two runs. `fill` is full blocks (or the texture);
 * `edge` is the seven-eighths block at the end, the last segment before the
 * free dots too (one rule; with no free space the reserve follows, and the
 * edge keeps them apart). A one-cell segment is the edge alone; a textured
 * one has no edge.
 *
 * Two runs because the engine draws a Button under the focus ring or the
 * pointer inverted: the band gives the fill its colour as background too,
 * so it reads the same inverted, and the edge its own background (see
 * `edgeColor`).
 */
export function segmentRuns(id: string, cells: number): { fill: string; edge: string } {
  if (cells <= 0) {
    return { fill: '', edge: '' }
  }
  if (TEXTURED.has(id)) {
    return { fill: TEXTURE.repeat(cells), edge: '' }
  }

  return { fill: FILLED.repeat(cells - 1), edge: EDGE }
}

/** One segment's cells as one text: `segmentRuns` joined. */
export function segmentCells(id: string, cells: number): string {
  const { fill, edge } = segmentRuns(id, cells)

  return fill + edge
}

/** The key of a segment's Button, which `ui.focus` reports. */
export function segmentKey(id: string): string {
  return `seg-${id}`
}

/** The chip's text for one bar cell, longest first. */
export function chipForms(part: SegmentPart, tokensOf: (id: string) => number): string[] {
  // The drawn segment first: a whole tiny group takes its largest member's
  // place, which need not be the first member.
  const ids = [part.id, ...part.members.filter(id => id !== part.id)]
  const named = ids.map(id => {
    const def = segmentDef(id as ContextBreakdownSegmentId)

    return { label: def.label, short: def.short, amount: formatTokens(tokensOf(id)) }
  })
  const [first] = named
  if (first === undefined) {
    return []
  }
  const more = named.length - 1
  if (more === 0) {
    return [` ${first.label} ${first.amount} `, ` ${first.short} ${first.amount} `]
  }

  // The short forms show the cell's total after the count: a figure beside
  // the first name alone would read as the whole cell's.
  const total = formatTokens(part.tokens)

  return [
    ` ${named.map(n => `${n.label} ${n.amount}`).join(' + ')} `,
    ` ${first.label} +${more} more ${total} `,
    ` ${first.short} +${more} more ${total} `,
  ]
}

/** A chip narrower than this says nothing; none is drawn. */
export const MIN_CHIP_CELLS = 4

/**
 * Cells left uncovered between a segment and its chip. A shown chip holds
 * its segment's hover group while the pointer is on it, and it takes the
 * pointer from the cells under it. The uncovered neighbour cell is where the
 * pointer, moving along the bar, reaches the next segment's Button first.
 */
export const CHIP_GAP = 1

export type ChipPlace = {
  text: string
  /** Its first column, from the row's left edge. */
  left: number
  side: 'right' | 'left'
}

/**
 * Where a segment's chip goes. It stays inside the bar's own `barWidth`
 * cells when one of its forms fits there: right of the segment, else left of
 * it, `CHIP_GAP` cells away on either side. It never covers the segment, so
 * the pointer stays on its Button, never covers the cell beside it, so the
 * pointer can walk on to the next segment, and never passes either end of
 * the row.
 *
 * Only when no form fits inside the bar does it reach right, over the total
 * and the legend: then it covers them to the end of the row (`rowWidth`), so
 * no part of a figure is left beside it to read as its own ("39k 1M 10%").
 * When no form fits even so, the last is cut to the wider side.
 */
export function placeChip(
  start: number,
  cells: number,
  barWidth: number,
  rowWidth: number,
  forms: readonly string[],
): ChipPlace | null {
  const end = start + cells
  const inBar = Math.max(0, barWidth - end - CHIP_GAP)
  const left = Math.max(0, start - CHIP_GAP)
  for (const text of forms) {
    const width = cellWidth(text)
    if (width <= inBar) {
      return { text, left: end + CHIP_GAP, side: 'right' }
    }
    if (width <= left) {
      return { text, left: left - width, side: 'left' }
    }
  }
  const toEnd = Math.max(0, rowWidth - end - CHIP_GAP)
  for (const text of forms) {
    if (cellWidth(text) <= toEnd) {
      return { text: padCells(text, toEnd), left: end + CHIP_GAP, side: 'right' }
    }
  }
  const last = forms[forms.length - 1]
  const room = Math.max(toEnd, left)
  if (last === undefined || room < MIN_CHIP_CELLS) {
    return null
  }
  // Cut with an ellipsis, then close with the chip's own space.
  const text = `${cut(last.trimEnd(), room - 1)} `
  if (toEnd >= left) {
    return { text: padCells(text, toEnd), left: end + CHIP_GAP, side: 'right' }
  }

  return { text, left: left - cellWidth(text), side: 'left' }
}

function padCells(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - cellWidth(text)))
}

function cut(text: string, width: number): string {
  return cellWidth(text) <= width ? text : `${headCells(text, width - 1)}…`
}

export type Chip = ChipPlace & {
  /** The segment the chip names: its Button is keyed `seg-<id>`. */
  id: string
}

/** One chip per segment part, in bar order, for a row `rowWidth` wide. */
export function barChips(
  parts: readonly LayoutPart[],
  rowWidth: number,
  tokensOf: (id: string) => number,
): Chip[] {
  const barWidth = parts.reduce((sum, part) => sum + part.cells, 0)
  const chips: Chip[] = []
  let start = 0
  for (const part of parts) {
    // Free space, the scale break and the reserve get no chip; their cells
    // still count towards the next segment's start.
    if (part.kind === 'segment') {
      const place = placeChip(start, part.cells, barWidth, rowWidth, chipForms(part, tokensOf))
      if (place !== null) {
        chips.push({ id: part.id, ...place })
      }
    }
    start += part.cells
  }

  return chips
}

/** A chip as the band draws it: shown from state, or only by its hover group. */
export type DrawnChip = { chip: Chip; isForced: boolean }

/**
 * The chips the band draws. With the keyboard on a segment (`focusedKey`,
 * its Button's key) that segment's chip alone, shown; else every chip, each
 * shown only while the pointer is on its segment. So at most one chip is on
 * the bar: the pointer lights one hover group at a time, and no hover chip
 * is drawn beside a keyboard chip.
 */
export function chipsToDraw(chips: readonly Chip[], focusedKey: string | null): DrawnChip[] {
  const focused = focusedKey === null ? undefined : chips.find(chip => segmentKey(chip.id) === focusedKey)
  if (focused !== undefined) {
    return [{ chip: focused, isForced: true }]
  }

  return chips.map(chip => ({ chip, isForced: false }))
}
