// What the band and the pane show, worked out without drawing.

import type { ContextBreakdownSegmentId, ContextBreakdownSnapshot } from '../types'
import { barChips } from './bar'
import type { Chip } from './bar'
import { formatPercent, formatTokens } from './format'
import { layoutBar } from './layout'
import type { LayoutPart } from './layout'
import { segmentDef } from './segments'
import { freeTokens, usedTokens } from './snapshot'
import { cellWidth, headCells } from './text'

/** Below this many cells the bar says too little; the band shows the label only. */
export const MIN_BAR_CELLS = 4

/**
 * The total in its long and shorter forms: "95k/1M 9%", "95k/1M", "95k",
 * each led by "~" while the conversation is estimated.
 */
function labelForms(snapshot: ContextBreakdownSnapshot): string[] {
  const used = usedTokens(snapshot)
  const mark = snapshot.isEstimate ? '~' : ''
  const amount = `${mark}${formatTokens(used)}`
  const ofWindow = `${amount}/${formatTokens(snapshot.window)}`

  return [`${ofWindow} ${formatPercent(used, snapshot.window)}`, ofWindow, amount]
}

/** "95k/1M 9%", led by "~" while the conversation is estimated. */
export function totalLabel(snapshot: ContextBreakdownSnapshot): string {
  return labelForms(snapshot)[0]!
}

/** Free space below this share of the window is low: the pane's heading warns. */
export const LOW_FREE_SHARE = 0.1

/** Whether free space is below LOW_FREE_SHARE of the window. Exactly at it is not low. */
export function isLowFree(snapshot: ContextBreakdownSnapshot): boolean {
  return freeTokens(snapshot) < LOW_FREE_SHARE * snapshot.window
}

/**
 * Level 1's heading in two parts, so the pane can draw the free part in its
 * own colour. A part is empty when the form leaves it out.
 */
export type PaneHeading = { used: string; free: string }

/** The heading as one text: the parts that are set, joined by " · ". */
export function headingLine(heading: PaneHeading): string {
  return [heading.used, heading.free].filter(part => part !== '').join(' · ')
}

/**
 * Level 1's heading, the longest form that fits `columns` less one:
 * "283k used · 684k free before compaction", then without "before
 * compaction", then one figure alone. That figure is the used one, or the
 * free one while free space is low, so a narrow pane still warns in words.
 * Both figures carry "~" while the conversation is estimated: free space is
 * computed from what is used.
 */
export function paneHeading(snapshot: ContextBreakdownSnapshot, columns: number): PaneHeading {
  const mark = snapshot.isEstimate ? '~' : ''
  const used = `${mark}${formatTokens(usedTokens(snapshot))} used`
  const free = `${mark}${formatTokens(freeTokens(snapshot))} free`
  const alone = isLowFree(snapshot) ? { used: '', free } : { used, free: '' }
  const forms = [{ used, free: `${free} before compaction` }, { used, free }, alone]

  return forms.find(form => cellWidth(headingLine(form)) < columns) ?? alone
}

/** The words right of the total: the largest conversation segment, after a swatch of its colour. */
export type Legend = {
  /** The segment it names. */
  id: ContextBreakdownSegmentId
  /**
   * The bar cell that holds it, whose colour the swatch takes: the segment
   * itself, or the neighbour it was merged into, so the colour always points
   * at a cell the bar draws.
   */
  cell: string
  /**
   * "Tool results 40k": its tokens. Not a percent, which beside the total's
   * percent of the window would read as a share of the window too.
   */
  text: string
}

/**
 * What stands in the legend's place until the person first opens the pane
 * in this session: the way from the bar to the pane, longest form first.
 */
export const HINT_FORMS: readonly string[] = ['/ctx for details', '/ctx']

export type BandModel = {
  /** Empty when not even the shortest label fits: the band draws nothing. */
  label: string
  legend: Legend | null
  /** A form of HINT_FORMS in the legend's place, or null. Never set beside a legend. */
  hint: string | null
  parts: LayoutPart[]
  /** One chip per segment part that has room for one, in bar order. */
  chips: Chip[]
}

/** What joins the total and the legend. */
export const LEGEND_JOIN = ' · '
/**
 * The legend's swatch and the space after it. The words are drawn in the
 * text colour: a segment colour holds 3:1 as a block, not 4.5:1 as text.
 */
export const LEGEND_SWATCH_CELLS = 2
/** The legend shows only while the bar keeps at least this many cells. */
export const MIN_BAR_WITH_LEGEND = 20

/** Cells the legend takes right of the total, its join included. */
export function legendCells(legend: Legend): number {
  return LEGEND_JOIN.length + LEGEND_SWATCH_CELLS + legend.text.length
}

/** Cells the hint takes right of the total, its join included. It has no swatch. */
export function hintCells(hint: string): number {
  return LEGEND_JOIN.length + hint.length
}

/** Cells the legend's place takes right of the total: the legend's, the hint's, or none. */
export function sideCells(model: Pick<BandModel, 'legend' | 'hint'>): number {
  return model.legend !== null ? legendCells(model.legend) : model.hint !== null ? hintCells(model.hint) : 0
}

/**
 * The legend in its long and short forms; none while no conversation is used.
 * Its `cell` is the segment's own until the bar is laid out.
 */
export function legendForms(snapshot: ContextBreakdownSnapshot): Legend[] {
  const used = usedTokens(snapshot)
  const largest = snapshot.conversation.reduce<ContextBreakdownSnapshot['conversation'][number] | null>(
    (best, segment) => (segment.tokens > 0 && (best === null || segment.tokens > best.tokens) ? segment : best),
    null,
  )
  if (largest === null || !(used > 0)) {
    return []
  }
  const def = segmentDef(largest.id)
  // Marked as the total is: the figure comes from the same estimate.
  const amount = `${snapshot.isEstimate ? '~' : ''}${formatTokens(largest.tokens)}`
  const names = def.short === def.label ? [def.label] : [def.label, def.short]

  return names.map(name => ({ id: largest.id, cell: largest.id, text: `${name} ${amount}` }))
}

/** What the band's model depends on besides the snapshot and the width. */
export type BandOptions = {
  /**
   * Whether the hint stands in the legend's place: true until the person
   * first opens the pane in this session.
   */
  hint?: boolean
}

/**
 * The bar and its label for a band `bodyColumns` wide. The row leaves one
 * spare cell, so it never wraps. Right of the total stands the hint while
 * `options.hint` is set, else the legend. When the row is narrow, that goes
 * first; too narrow for a bar, the label stands alone and loses the percent,
 * then the window, until it fits.
 */
export function bandModel(snapshot: ContextBreakdownSnapshot, bodyColumns: number, options: BandOptions = {}): BandModel {
  const columns = Math.floor(bodyColumns)
  const label = totalLabel(snapshot)
  if (options.hint === true) {
    for (const hint of HINT_FORMS) {
      const room = columns - label.length - hintCells(hint) - 2
      if (room >= MIN_BAR_WITH_LEGEND) {
        return withBar(snapshot, room, label, null, hint)
      }
    }
  } else {
    for (const legend of legendForms(snapshot)) {
      const room = columns - label.length - legendCells(legend) - 2
      if (room >= MIN_BAR_WITH_LEGEND) {
        return withBar(snapshot, room, label, legend, null)
      }
    }
  }
  const room = columns - label.length - 2
  if (room < MIN_BAR_CELLS) {
    return {
      label: labelForms(snapshot).find(form => form.length < columns) ?? '',
      legend: null,
      hint: null,
      parts: [],
      chips: [],
    }
  }

  return withBar(snapshot, room, label, null, null)
}

/**
 * The band's model for one surface. A chip's place is counted in text cells,
 * and only the terminal draws the bar as text: a graphical surface draws
 * each segment as a native button, with space between them, so a chip there
 * could land on its own segment. Those surfaces get no chips.
 */
export function bandModelFor(
  snapshot: ContextBreakdownSnapshot,
  bodyColumns: number,
  surface: string,
  options: BandOptions = {},
): BandModel {
  const model = bandModel(snapshot, bodyColumns, options)

  return surface === 'terminal' ? model : { ...model, chips: [] }
}

function withBar(
  snapshot: ContextBreakdownSnapshot,
  room: number,
  label: string,
  legend: Legend | null,
  hint: string | null,
): BandModel {
  const parts = layoutBar({
    width: room,
    window: snapshot.window,
    groups: [snapshot.baseline, snapshot.conversation],
    reserve: snapshot.reserve,
  })
  // The row as drawn in flow: the bar, a space, the total and the legend or the hint.
  const rowWidth = parts.reduce((sum, part) => sum + part.cells, 0) + 1 + label.length + sideCells({ legend, hint })
  const tokens = new Map<string, number>(
    [...snapshot.baseline, ...snapshot.conversation].map(segment => [segment.id, segment.tokens]),
  )
  // A small largest segment can be merged into a neighbour: the swatch takes
  // the colour of the cell that holds it.
  const holder =
    legend === null
      ? undefined
      : parts.find(part => part.kind === 'segment' && part.members.includes(legend.id))
  const placed = legend === null || holder?.kind !== 'segment' ? legend : { ...legend, cell: holder.id }

  return { label, legend: placed, hint, parts, chips: barChips(parts, rowWidth, id => tokens.get(id) ?? 0) }
}

/**
 * Cuts a text to `width` cells (a wide character takes two), marking the cut
 * with an ellipsis, and pads it to `width`.
 */
export function fit(text: string, width: number): string {
  if (width <= 0) {
    return ''
  }
  const cells = cellWidth(text)
  if (cells <= width) {
    return text + ' '.repeat(width - cells)
  }
  if (width === 1) {
    return '…'
  }
  const head = headCells(text, width - 1)

  return `${head}…${' '.repeat(width - 1 - cellWidth(head))}`
}
