// The pane's table, worked out without drawing: the columns one level's rows
// share (hotkey mark, name, length bar, figures) and the length bar's cells.
// One layout serves every row of a level, so the columns line up.

import type { ContextBreakdownDeferred, ContextBreakdownSegment, ContextBreakdownServer, ContextBreakdownSnapshot } from '../types'
import { FILLED, TEXTURE, TEXTURED } from './bar'
import { formatCount, formatShare, formatTokens } from './format'
import { segmentDef } from './segments'
import { cellWidth, shortenPath } from './text'
import { fit, isLowFree } from './view'

/** Cells a hotkey's mark ("1: ") takes before a plain Button's label. */
export const HOTKEY_CELLS = 3
/**
 * Below this many columns rows get no hotkeys: the mark would push a row
 * past the pane or cut its name.
 */
export const HOTKEY_MIN_COLUMNS = 32
/** The widest a row grows, mark included: in a wide pane the columns stay close. */
export const TABLE_MAX_COLUMNS = 68
/** The length bar's widest and narrowest; narrower than that it is dropped. */
export const BAR_MAX_CELLS = 12
export const BAR_MIN_CELLS = 4
/** The narrowest name column: the short names ("Skills/agents") read whole. */
export const NAME_MIN_CELLS = 13
/** The bar gives way, down to its minimum, until names get this many cells. */
export const NAME_WANT_CELLS = 20
/** Cells of the token figure ("9.5k") and of the share ("4.6%", "<0.1%"). */
const AMOUNT_CELLS = 5
const SHARE_CELLS = 5
/** The colour key that leads a row when there is no length bar. */
export const SWATCH = '██'
const SWATCH_CELLS = SWATCH.length + 1

export function showsHotkeys(columns: number): boolean {
  return columns >= HOTKEY_MIN_COLUMNS
}

/** The columns of one level's rows, in cells. */
export type Table = {
  /** The hotkey mark, or the room it would take: 3, or 0 in a narrow pane. */
  mark: number
  /** The swatch before the name: 3 without a length bar, else 0. */
  lead: number
  name: number
  /** The length bar after the name and its space; 0 when it is dropped. */
  bar: number
  share: boolean
}

function figureCells(share: boolean): number {
  return 1 + AMOUNT_CELLS + (share ? 1 + SHARE_CELLS : 0)
}

/**
 * The table for a pane `columns` wide whose widest name is `widestName`
 * cells. The row leaves one spare cell and stops at TABLE_MAX_COLUMNS. The
 * bar shrinks before names do, and goes before the share does. Without a
 * bar a swatch leads each row when `swatch` is set (level 1, where each row
 * has its own colour); level 2 gives those cells to the names, as its rows
 * all share one colour.
 */
export function tableLayout(columns: number, widestName: number, swatch = true): Table {
  const cols = Math.floor(columns)
  const mark = showsHotkeys(cols) ? HOTKEY_CELLS : 0
  const room = Math.max(0, Math.min(cols - 1, TABLE_MAX_COLUMNS) - mark)
  const widest = Math.max(1, Math.ceil(widestName))
  // Cells for the name and the bar, after the figures and the bar's space.
  const spare = room - figureCells(true) - 1
  if (spare - NAME_MIN_CELLS >= BAR_MIN_CELLS) {
    const bar = Math.min(
      BAR_MAX_CELLS,
      spare - NAME_MIN_CELLS,
      Math.max(BAR_MIN_CELLS, spare - Math.min(widest, NAME_WANT_CELLS)),
    )

    return { mark, lead: 0, name: Math.min(widest, spare - bar), bar, share: true }
  }
  const lead = swatch ? SWATCH_CELLS : 0
  const share = room - lead - figureCells(true) >= NAME_MIN_CELLS
  const name = Math.max(0, room - lead - figureCells(share))

  return { mark, lead, name: Math.min(widest, name), bar: 0, share }
}

/** Cells of a whole row, mark included. */
export function rowCells(table: Table): number {
  return table.mark + table.lead + table.name + (table.bar > 0 ? 1 + table.bar : 0) + figureCells(table.share)
}

/** The cells between the mark and the figures: swatch, name and bar. */
export function nameAndBarCells(table: Table): number {
  return table.lead + table.name + (table.bar > 0 ? 1 + table.bar : 0)
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const

/** A length bar in three runs: whole cells, the eighth block, the padding. */
export type LengthBarParts = { full: string; rest: string; pad: string }

/**
 * A row's length bar, `cells` wide and padded to it: `tokens` against the
 * largest row's, which fills it. Eighth blocks carry the rest, and any row
 * above zero gets at least one eighth. A textured segment draws its whole
 * cells in its texture, as the band does, and its rest as a plain eighth
 * block: there is no textured eighth, and rounding to whole cells would draw
 * it longer than a larger row.
 *
 * In runs, because the row is a Button that the engine draws inverted under
 * the focus ring or the pointer: the pane colours each run its own way.
 */
export function lengthBarParts(tokens: number, largest: number, cells: number, id = ''): LengthBarParts {
  if (cells <= 0) {
    return { full: '', rest: '', pad: '' }
  }
  if (!(tokens > 0) || !(largest > 0)) {
    return { full: '', rest: '', pad: ' '.repeat(cells) }
  }
  const ratio = Math.min(1, tokens / largest)
  const eighths = Math.max(1, Math.round(ratio * cells * 8))
  const whole = Math.floor(eighths / 8)
  const rest = EIGHTHS[eighths % 8] ?? ''
  const fill = TEXTURED.has(id) ? TEXTURE : FILLED

  return { full: fill.repeat(whole), rest, pad: ' '.repeat(cells - whole - (rest === '' ? 0 : 1)) }
}

/** A row's length bar as one text: `lengthBarParts` joined. */
export function lengthBar(tokens: number, largest: number, cells: number, id = ''): string {
  const { full, rest, pad } = lengthBarParts(tokens, largest, cells, id)

  return full + rest + pad
}

/**
 * A row's figures: " 9.5k  4.6%", the share of `of`; a blank share column
 * when `of` is null (Free space, Reserve, Not loaded), so the tokens line up.
 */
export function figuresText(table: Table, tokens: number, of: number | null): string {
  const amount = ` ${formatTokens(tokens).padStart(AMOUNT_CELLS)}`
  if (!table.share) {
    return amount
  }

  return `${amount} ${(of === null ? '' : formatShare(tokens, of)).padStart(SHARE_CELLS)}`
}

/** "1 server", "1,230 tools": a count, grouped, and its word. */
export function countOf(n: number, word: string): string {
  return `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`
}

/** One row of Not loaded: a category, and on the MCP tools one all its servers. */
export type NotLoadedRow = {
  name: string
  /** Null: no figure to show, the token cell stays empty. */
  tokens: number | null
  servers: ContextBreakdownServer[]
}

/**
 * The rows of Not loaded: each category above zero, and the MCP tools one
 * with every server. The servers keep MCP tools in the block even with no
 * figure of its own; with no such category at all they get a row named so.
 */
export function notLoadedRows(
  deferred: readonly ContextBreakdownDeferred[],
  servers: readonly ContextBreakdownServer[],
  isMcp: (name: string) => boolean,
): NotLoadedRow[] {
  let placed = servers.length === 0
  const rows: NotLoadedRow[] = []
  for (const category of deferred) {
    const takes = !placed && isMcp(category.name)
    if (category.tokens > 0 || takes) {
      rows.push({ name: category.name, tokens: category.tokens > 0 ? category.tokens : null, servers: takes ? [...servers] : [] })
      placed ||= takes
    }
  }
  if (!placed) {
    rows.push({ name: 'MCP tools', tokens: null, servers: [...servers] })
  }

  return rows
}

/** The cells a row's text may take where it has no length bar: the name and the bar columns. */
export function textCells(table: Table): number {
  return nameAndBarCells(table) - table.lead
}

/** The longest of `forms` that fits `cells`; the last one, cut, when none does. */
function longestFit(forms: readonly string[], cells: number): string {
  return fit(forms.find(form => cellWidth(form) <= cells) ?? forms[forms.length - 1] ?? '', cells)
}

/**
 * A group heading's text in the name and bar columns: "Baseline · before
 * your first prompt" when it fits there, else the name alone. A heading has
 * no bar, so it may use the bar's cells.
 */
export function headingText(table: Table, name: string, long: string): string {
  return longestFit([long, name], textCells(table))
}

/**
 * The MCP tools row of Not loaded, in the name and bar columns: "MCP tools ·
 * 30 servers, 696 tools", then without the tools, then the name alone.
 */
export function serversRowText(table: Table, name: string, servers: readonly ContextBreakdownServer[]): string {
  const tools = servers.reduce((sum, server) => sum + server.tools, 0)
  const counted = `${name} · ${countOf(servers.length, 'server')}`

  return longestFit([`${counted}, ${countOf(tools, 'tool')}`, counted, name], textCells(table))
}

/**
 * The heading of the Not loaded block, as wide as a row past the mark and the
 * lead: "Not loaded · outside the window", or "Not loaded" when that does not fit.
 */
export function notLoadedHeading(table: Table, name: string, long: string): string {
  return longestFit([long, name], rowCells(table) - table.mark - table.lead).trimEnd()
}

/**
 * Level 2's facts and the column name on one row: the facts on the left, the
 * name ending where the share column ends, at least two cells apart. Null
 * when they do not fit in the row's cells, or there is no share column: the
 * column name then gets a row of its own.
 */
export function factsRow(table: Table, facts: string, column: string): string | null {
  const cells = rowCells(table)
  if (!table.share || cellWidth(facts) + 2 + cellWidth(column) > cells) {
    return null
  }

  return `${facts}${' '.repeat(cells - cellWidth(facts) - cellWidth(column))}${column}`
}

/** The fewest cells a server's name keeps before the count drops its word "tools". */
const SERVER_NAME_MIN_CELLS = 8

/**
 * The rows of the servers that are not loaded, in the name column: the name
 * on the left, cut where it must, and the tool count (`detail`, "265 tools")
 * ending at the column's end, so the counts line up. The count says "tools"
 * while the names keep SERVER_NAME_MIN_CELLS, or all of the widest name
 * when it is shorter; a narrower pane shows the number alone, the same form
 * on every row.
 */
export function serverNames(table: Table, rows: readonly { title: string; detail: string }[]): { title: string; detail: string }[] {
  const room = table.name
  const number = (detail: string) => detail.split(' ')[0] ?? detail
  const widest = (form: (detail: string) => string) => Math.max(0, ...rows.map(row => cellWidth(form(row.detail))))
  const long = (detail: string) => detail
  const names = Math.max(0, ...rows.map(row => cellWidth(row.title)))
  const form = room - 2 - widest(long) >= Math.min(SERVER_NAME_MIN_CELLS, names) ? long : number
  const countCells = widest(form)
  const nameCells = Math.max(0, room - 2 - countCells)

  return rows.map(row => {
    const line = fit(`${fit(row.title, nameCells)}  ${form(row.detail).padStart(countCells)}`, room)

    return { title: line.slice(0, line.length - countCells - 2), detail: line.slice(line.length - countCells - 2) }
  })
}

/** A name in the name column: `short` stands in when the full one does not fit. */
export function nameText(table: Table, name: string, short?: string): string {
  const chosen = cellWidth(name) <= table.name || short === undefined ? name : short

  return fit(chosen, table.name)
}

/**
 * The dim line over the figures that says once what the share column is:
 * `left` in the name's place, `right` ending at the share column's end.
 */
export function columnHeader(table: Table, left: string, right: string): string {
  const head = fit(left, nameAndBarCells(table))
  if (!table.share) {
    return head.trimEnd()
  }

  return `${head}${right.padStart(figureCells(true))}`.trimEnd()
}

/**
 * Level 1's column header on the left: "1M window". While free space is low
 * it also names the largest segment and its share of what is used, "1M
 * window · largest: Tool results 61%", with the short name where the full one
 * does not fit the name and bar columns. Where neither fits, the window alone.
 * The share has the share column's format, so it matches the bold row.
 */
export function windowText(
  table: Table,
  snapshot: ContextBreakdownSnapshot,
  largest: ContextBreakdownSegment | null,
  used: number,
): string {
  const window = `${formatTokens(snapshot.window)} window`
  if (largest === null || !isLowFree(snapshot)) {
    return window
  }
  const def = segmentDef(largest.id)
  // Marked as the heading is: the share comes from the same estimate.
  const share = `${snapshot.isEstimate ? '~' : ''}${formatShare(largest.tokens, used)}`
  const forms = [def.label, def.short].map(name => `${window} · largest: ${name} ${share}`)

  return forms.find(form => cellWidth(form) <= nameAndBarCells(table)) ?? window
}

/**
 * An item's title and dim detail in the name column. The part `pathIn`
 * names is a path: when it does not fit, its head is cut, so the file name
 * stays.
 */
export function itemNames(
  table: Table,
  title: string,
  detail: string,
  pathIn: 'title' | 'detail' | null = null,
): { title: string; detail: string } {
  const room = table.name
  const joined = detail === '' ? title : `${title}  ${detail}`
  const name = fit(joined, room)
  if (cellWidth(joined) > room) {
    if (pathIn === 'title' && detail === '' && room >= 2) {
      return { title: fit(shortenPath(title, room), room), detail: '' }
    }
    const left = room - cellWidth(title) - 2
    if (pathIn === 'detail' && left >= 2) {
      return { title, detail: fit(`  ${shortenPath(detail, left)}`, left + 2) }
    }
  }
  const cut = Math.min(title.length, name.length)

  return { title: name.slice(0, cut), detail: name.slice(cut) }
}

/** The largest of `rows` above zero, the first on a tie; null when all are zero. */
export function largestOf<T extends { tokens: number }>(rows: readonly T[]): T | null {
  return rows.reduce<T | null>((best, row) => (row.tokens > 0 && (best === null || row.tokens > best.tokens) ? row : best), null)
}

/** Level 2's first line: where the list sits, and the segment's size. */
export type Crumb = {
  /** "Context › ", or empty when the pane is narrow. */
  trail: string
  /** The segment's name; the swatch goes before it. */
  name: string
  /** "101k · 40% of used", or the tokens alone with no measurement. */
  figures: string
}

/**
 * The breadcrumb for a pane `columns` wide, longest form that fits: the
 * full name, then the short one, then without the trail; the last form cut.
 */
export function crumbFor(
  root: string,
  label: string,
  short: string,
  tokens: number,
  used: number | null,
  isEstimate: boolean,
  columns: number,
): Crumb {
  const mark = isEstimate ? '~' : ''
  const amount = `${mark}${formatTokens(tokens)}`
  const figures = used === null || !(used > 0) ? amount : `${amount} · ${mark}${formatShare(tokens, used)} of used`
  const trail = `${root} › `
  const room = Math.floor(columns) - 1
  const forms: Crumb[] = [
    { trail, name: label, figures },
    { trail, name: short, figures },
    { trail: '', name: short, figures },
    { trail: '', name: short, figures: amount },
  ]
  const width = (c: Crumb) => cellWidth(c.trail) + SWATCH_CELLS + cellWidth(c.name) + 2 + cellWidth(c.figures)
  const found = forms.find(c => width(c) <= room)
  if (found !== undefined) {
    return found
  }

  return { trail: '', name: fit(short, Math.max(1, room - SWATCH_CELLS)).trimEnd(), figures: '' }
}

/**
 * The first line of the list of servers that are not loaded, longest form
 * that fits, as `crumbFor` shortens: "Context › Not loaded › MCP tools  414k
 * once loaded", then without the root, then without the block, then the
 * figure alone; the last form cut. No swatch: the list is in no segment, so
 * it has no colour. `tokens` null: no figure.
 */
export function serversCrumb(root: string, block: string, name: string, tokens: number | null, columns: number): Crumb {
  const amount = tokens === null ? '' : formatTokens(tokens)
  const figures = tokens === null ? '' : `${amount} once loaded`
  const room = Math.floor(columns) - 1
  const forms: Crumb[] = [
    { trail: `${root} › ${block} › `, name, figures },
    { trail: `${block} › `, name, figures },
    { trail: '', name, figures },
    { trail: '', name, figures: amount },
  ]
  const width = (c: Crumb) => cellWidth(c.trail) + cellWidth(c.name) + (c.figures === '' ? 0 : 2 + cellWidth(c.figures))

  return forms.find(c => width(c) <= room) ?? { trail: '', name: fit(name, Math.max(1, room)).trimEnd(), figures: '' }
}

/**
 * Level 2's facts line for a pane `columns` wide, longest form that fits:
 * "72 items · largest first · page 1 of 4", then without the order (the
 * sort control still names it), then "72 items · 1/4", then the count.
 */
export function listFacts(count: string, order: string | null, page: number, pages: number, columns: number): string {
  const paged = pages > 1 ? `page ${page + 1} of ${pages}` : null
  const short = pages > 1 ? `${page + 1}/${pages}` : null
  const forms = [
    [count, order, paged],
    [count, paged],
    [count, short],
  ].map(parts => parts.filter(part => part !== null).join(' · '))

  return forms.find(form => cellWidth(form) < columns) ?? count
}

/**
 * Level 3's place in the whole item while it has several pages: "lines
 * 1-400 of 1,230". A page inside one long line adds its page number, as the
 * line range alone would not change from page to page. Empty for one page.
 */
export function lineFacts(position: { firstLine: number; lastLine: number; lines: number; page: number; pages: number }): string {
  const { firstLine, lastLine, lines, page, pages } = position
  if (pages <= 1) {
    return ''
  }
  const of = `of ${formatCount(lines)}`
  if (lastLine <= firstLine) {
    return `line ${formatCount(firstLine)} ${of}, page ${page + 1} of ${pages}`
  }

  return `lines ${formatCount(firstLine)}-${formatCount(lastLine)} ${of}`
}
