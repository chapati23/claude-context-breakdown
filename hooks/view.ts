// What the band and the pane show, worked out without drawing.

import type { ContextBreakdownSnapshot } from '../types'
import { formatPercent, formatShare, formatTokens } from './format'
import { layoutBar } from './layout'
import type { LayoutPart } from './layout'
import { usedTokens } from './snapshot'
import { cellWidth, headCells, shortenPath } from './text'

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

export type BandModel = {
  /** Empty when not even the shortest label fits: the band draws nothing. */
  label: string
  parts: LayoutPart[]
}

/**
 * The bar and its label for a band `bodyColumns` wide. The row leaves one
 * spare cell, so it never wraps. Too narrow for a bar, the label stands
 * alone and loses the percent, then the window, until it fits.
 */
export function bandModel(snapshot: ContextBreakdownSnapshot, bodyColumns: number): BandModel {
  const columns = Math.floor(bodyColumns)
  const label = totalLabel(snapshot)
  const room = columns - label.length - 2
  if (room < MIN_BAR_CELLS) {
    return { label: labelForms(snapshot).find(form => form.length < columns) ?? '', parts: [] }
  }

  return {
    label,
    parts: layoutBar({
      width: room,
      window: snapshot.window,
      groups: [snapshot.baseline, snapshot.conversation],
      reserve: snapshot.reserve,
    }),
  }
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

/** Cells the colour swatch takes at the start of a row. */
const SWATCH = 2
/** Cells of the token figure ("9.5k") and of the share ("4.6%", "<0.1%"). */
const AMOUNT_CELLS = 5
const SHARE_CELLS = 5
/** A name gets at least this many cells before the share is shown. */
const MIN_NAME_CELLS = 12

/** Cells a row's name and figures share: the columns less the swatch and one spare. */
function rowRoom(columns: number): number {
  return Math.max(0, Math.floor(columns) - 1 - SWATCH - 1)
}

/**
 * Whether a pane `columns` wide shows each row's share of the window. The
 * choice is the same for every row, so the token figures stay in one column.
 */
export function showsShare(columns: number): boolean {
  return rowRoom(columns) - (AMOUNT_CELLS + 1 + SHARE_CELLS) - 1 >= MIN_NAME_CELLS
}

/**
 * One pane row's name and figures, laid into `columns` cells less one spare:
 * "name  9.5k  4.6%". When the pane is too narrow, the share is dropped
 * before the name is cut further, and `short` stands in for a name that
 * does not fit. A row with no window (a deferred category) leaves the share
 * column blank, so its tokens line up with the rows above.
 */
export function rowText(
  name: string,
  tokens: number,
  window: number | null,
  columns: number,
  short?: string,
): { name: string; figures: string } {
  const room = rowRoom(columns)
  const amount = formatTokens(tokens).padStart(AMOUNT_CELLS)
  let figures = amount
  if (showsShare(columns)) {
    const share = window === null ? '' : formatShare(tokens, window)
    figures = `${amount} ${share.padStart(SHARE_CELLS)}`
  }
  const nameWidth = Math.max(0, room - figures.length - 1)
  const chosen = cellWidth(name) <= nameWidth || short === undefined ? name : short

  return { name: fit(chosen, nameWidth), figures: ` ${figures}` }
}

/** Cells a hotkey's mark ("1: ") takes before a plain Button's label. */
export const HOTKEY_CELLS = 3
/**
 * Below this many columns rows get no hotkeys: the mark would push a row
 * past the pane or cut its name.
 */
export const HOTKEY_MIN_COLUMNS = 32

/** The columns a row's text may take beside its hotkey mark. */
export function rowColumns(columns: number): number {
  return showsHotkeys(columns) ? columns - HOTKEY_CELLS : columns
}

export function showsHotkeys(columns: number): boolean {
  return columns >= HOTKEY_MIN_COLUMNS
}

/**
 * An item row laid out as `rowText` lays a segment row: the title, then the
 * dim detail in what room is left, then the figures. The part `pathIn` names
 * is a path: when it does not fit, its head is cut, so the file name stays.
 */
export function itemRowText(
  title: string,
  detail: string,
  tokens: number,
  window: number | null,
  columns: number,
  pathIn: 'title' | 'detail' | null = null,
): { title: string; detail: string; figures: string } {
  const joined = detail === '' ? title : `${title}  ${detail}`
  const { name, figures } = rowText(joined, tokens, window, columns)
  const room = cellWidth(name)
  if (cellWidth(joined) > room) {
    if (pathIn === 'title' && detail === '' && room >= 2) {
      return { title: fit(shortenPath(title, room), room), detail: '', figures }
    }
    const left = room - cellWidth(title) - 2
    if (pathIn === 'detail' && left >= 2) {
      return { title, detail: fit(`  ${shortenPath(detail, left)}`, left + 2), figures }
    }
  }
  const cut = Math.min(title.length, name.length)

  return { title: name.slice(0, cut), detail: name.slice(cut), figures }
}
