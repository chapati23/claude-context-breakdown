// The pane: the segments (level 1), the items of one segment or the servers
// that are not loaded (level 2), and the text of one item (level 3). It draws
// from state alone; each press hands the move to an action.

import type { RenderElement, RenderSurface } from 'claude-code'

import type {
  ContextBreakdownContent,
  ContextBreakdownList,
  ContextBreakdownListId,
  ContextBreakdownSegment,
  ContextBreakdownSnapshot,
  ContextBreakdownSort,
  ContextBreakdownView,
} from '../types'
import type { Ui } from './band'
import { FILLED, FREE, RESERVE } from './bar'
import { baselineOf } from './categories'
import { formatTokens } from './format'
import { colorOf } from './palette'
import type { Palette } from './palette'
import { levelOneLists, rowKeys } from './ring'
import { LIST_DOWN, LIST_UP, SCROLL_DOWN, SCROLL_UP } from './scroll'
import { NOT_LOADED, NOT_LOADED_DEF, isSegmentList, segmentDef, sentence } from './segments'
import { freeTokens, sumTokens, usedTokens } from './snapshot'
import { PANE_TITLE } from './state'
import {
  SWATCH,
  columnHeader,
  countOf,
  crumbFor,
  factsRow,
  figuresText,
  headingText,
  itemNames,
  largestOf,
  lengthBarParts,
  lineFacts,
  listFacts,
  nameText,
  notLoadedHeading,
  notLoadedRows,
  rowCells,
  serverNames,
  serversCrumb,
  serversRowText,
  showsHotkeys,
  tableLayout,
  windowText,
} from './table'
import type { LengthBarParts, NotLoadedRow, Table } from './table'
import { cellWidth, codeRuns, wrapCells } from './text'
import { headingLine, isLowFree, paneHeading } from './view'

export type PaneActions = {
  close: () => unknown
  refresh: () => unknown
  openSegment: (id: ContextBreakdownListId) => unknown
  openItem: (id: string) => unknown
  back: () => unknown
  toggleSort: () => unknown
  listPage: (delta: number) => unknown
  contentPage: (delta: number) => unknown
  toggleSource: () => unknown
  copy: (path: string, surface: RenderSurface) => unknown
  mention: (path: string) => unknown
}

/** What every row of one level shares while it is drawn. */
type Rows = {
  el: Ui
  table: Table
  /** Whether the pane holds the keyboard: hotkeys work only then. */
  isFocused: boolean
  palette: Palette
  /** The key of the element that takes the focus ring (`ringKey`). */
  ring: string | null
  /** The key of the element that holds the ring now, or null: its row is drawn `lit`. */
  lit: string | null
  /**
   * Whether the surface inverts a Button under the ring or the pointer. The
   * terminal does; a desktop draws its own button, so a cell drawn the other
   * way round for the swap would stay that way there.
   */
  swaps: boolean
  /** Whether a desktop row draws its hotkey as a key cap now (`showsKeys`). */
  caps: boolean
}

/**
 * How a row Button's parts are drawn. The engine draws a Button under the
 * focus ring or the pointer inverted: each cell's colour and background
 * swapped. A part with a colour of its own (dim figures, a part-filled bar
 * cell) then breaks the row's highlight into patches. So the row under the
 * ring (`lit`: `ui.focus` events say where the ring is) draws those parts in the text's own colour,
 * and the others take the same style while the pointer is on the row (the
 * hover group `scope`, which the Button heats): one highlight, bar intact.
 */
type RowLook = { lit: boolean; scope: string }

function lookOf(rows: Rows, key: string): RowLook {
  return { lit: rows.lit === key, scope: key }
}

// Every part of a table row is a Text drawn `mono`: the columns line up only
// cell for cell, and a surface other than the terminal draws text in a face
// that is not monospaced unless asked. The figures are also `tabular`.

/**
 * The digit of the row at `index` among the rows that open: "1" to "9", then
 * "0" for the tenth, the next key on the keyboard's row of digits. None for
 * the eleventh row and later.
 */
export function rowDigit(index: number): string | undefined {
  return index < 9 ? String(index + 1) : index === 9 ? '0' : undefined
}

/**
 * The hotkey of a desktop row: its digit (`rowDigit`) for the row at `index`
 * among the rows that open (null for a row that does not open). None in a
 * narrow pane (`cells` 0). The desktop and VS Code give the row its hotkey in
 * both focus states (`showsKeys`): they draw it as a key cap inside the
 * native button, and a hotkey presses only while the pane holds the keys.
 */
export function desktopHotkeyOf(cells: number, index: number | null): string | undefined {
  return cells > 0 && index !== null ? rowDigit(index) : undefined
}

/**
 * A row on a desktop: only the name is the Button, in a Box as wide as the
 * name's column plus the mark's cells, and the parts with a colour of their
 * own (the swatch, the length bar, the figures) stand outside it. A desktop
 * draws a Button's children as plain text, dropping colour and the code
 * font, so inside it the bar would turn black and the columns would drift.
 * The Button's text is the name. The native button draws the row's hotkey
 * as a key cap before the label, in the mark's cells; a row without a
 * hotkey has blank cells there, so every name starts in the same column.
 * The row keeps its place with and without the keys.
 */
function desktopRow(
  rows: Rows,
  button: { key: string; autoFocus?: true; onPress: () => void },
  parts: { index: number | null; lead: unknown; name: string; rest: unknown[] },
) {
  const { Box, Button, Text } = rows.el
  const label = parts.name.trimEnd()
  const cells = rows.table.mark
  const digit = rows.caps ? desktopHotkeyOf(cells, parts.index) : undefined

  return (
    <Box flexDirection="row">
      {parts.lead as RenderElement}
      <Box width={cells + cellWidth(parts.name)} flexShrink={0}>
        {digit === undefined && cells > 0 ? <Text mono>{' '.repeat(cells)}</Text> : ''}
        <Button
          key={button.key}
          label={label}
          plain
          {...(digit === undefined ? {} : { hotkey: digit })}
          {...(button.autoFocus === undefined ? {} : { autoFocus: true as const })}
          onPress={button.onPress}
        />
      </Box>
      <Text mono>{parts.rest as RenderElement[]}</Text>
    </Box>
  )
}

/** Blank cells that hold a column's place. */
function gap(rows: Rows, cells: number) {
  const { Text } = rows.el

  return cells > 0 ? <Text mono>{' '.repeat(cells)}</Text> : ''
}

/**
 * The mark before a row: "1" to "9" for the first nine rows, "0" for the
 * tenth. With the keyboard the Button draws it from its `hotkey`; without,
 * the row draws it dim, as a hotkey that does not work yet, and gets no
 * `hotkey`. A row with no mark is indented by as much, so the rows line up.
 */
function markOf(rows: Rows, index: number, look?: RowLook): { hotkey?: string; mark: RenderElement | string } {
  if (rows.table.mark === 0) {
    return { mark: '' }
  }
  const digit = rowDigit(index)
  if (digit === undefined) {
    return { mark: gap(rows, rows.table.mark) }
  }
  if (rows.isFocused) {
    return { hotkey: digit, mark: '' }
  }
  const { Text } = rows.el

  return {
    mark: (
      <Text mono dimColor {...(look === undefined ? {} : { hover: { scope: look.scope, dimColor: false } })}>
        {`${digit}: `}
      </Text>
    ),
  }
}

/**
 * The cells between the name and the figures: the length bar, or nothing.
 *
 * A row Button under the focus ring or the pointer is drawn inverted, each
 * cell's colour and background swapped. Whole blocks on their own colour
 * read the same either way, and the padding has no colour, so inverted it
 * takes the row's highlight, not the segment's colour. A part-filled cell
 * and the texture are not stable: inverted, they would show the rest of
 * their cells in the segment's colour. With a `look`, they are drawn the
 * other way round under the ring or the pointer (the segment's colour as
 * background, the text's colour in front), so the swap puts them right.
 */
function barPart(rows: Rows, color: string, bar: LengthBarParts, look?: RowLook) {
  const { Text } = rows.el
  if (rows.table.bar === 0) {
    return ''
  }
  const runs: (RenderElement | string)[] = [gap(rows, 1)]
  // A cell that is not all one colour: the glyph in the segment's colour at
  // rest; swapped under the ring; swapped by the hover group under the pointer.
  const mixed = (text: string) =>
    look?.lit === true && rows.swaps ? (
      <Text mono backgroundColor={color}>
        {text}
      </Text>
    ) : (
      <Text
        mono
        color={color}
        {...(look === undefined || !rows.swaps ? {} : { hover: { scope: look.scope, color: 'text', backgroundColor: color } })}
      >
        {text}
      </Text>
    )
  if (bar.full !== '') {
    // Whole blocks take their colour as background too. The texture keeps
    // the background showing through it.
    runs.push(
      bar.full.startsWith(FILLED) ? (
        <Text mono color={color} backgroundColor={color}>
          {bar.full}
        </Text>
      ) : (
        mixed(bar.full)
      ),
    )
  }
  if (bar.rest !== '') {
    runs.push(mixed(bar.rest))
  }
  if (bar.pad !== '') {
    runs.push(<Text mono>{bar.pad}</Text>)
  }

  return runs
}

/**
 * The swatch before the name while there is no length bar. A full-block
 * swatch takes its colour as background too, so it reads the same in an
 * inverted row (see `barPart`).
 */
function leadPart(rows: Rows, color: string, glyph = SWATCH) {
  const { Text } = rows.el
  if (rows.table.lead === 0) {
    return ''
  }
  const back = glyph === SWATCH ? { backgroundColor: color } : {}

  return [
    <Text mono color={color} {...back}>
      {glyph}
    </Text>,
    gap(rows, 1),
  ]
}

/** A row's figures: dim at rest, at full strength under the ring or the pointer (`look`). */
function figuresPart(rows: Rows, tokens: number, of: number | null, look?: RowLook) {
  const { Text } = rows.el

  return (
    <Text
      mono
      tabular
      dimColor={look?.lit !== true}
      {...(look === undefined ? {} : { hover: { scope: look.scope, dimColor: false } })}
    >
      {figuresText(rows.table, tokens, of)}
    </Text>
  )
}

/** A line that is not a Button, laid in the same columns as the rows. */
function plainRow(
  rows: Rows,
  name: string,
  tokens: number,
  of: number | null,
  glyph: { text: string; color: string } | null,
  hasFigure = true,
) {
  const { Text } = rows.el
  const { table } = rows
  // Free space and Reserve show the bar's own glyph where a row's colour
  // goes: in the swatch's place, or at the start of the length bar's column.
  // On the desktop the mark's cells follow the swatch, as in a row, where the
  // native button draws the key cap after the swatch.
  const lead = glyph === null ? ' '.repeat(table.lead) : leadPart(rows, glyph.color, glyph.text)
  const bar = glyph === null ? null : { full: '', rest: glyph.text, pad: ' '.repeat(Math.max(0, table.bar - cellWidth(glyph.text))) }

  return (
    <Text mono dimColor>
      {rows.swaps ? ' '.repeat(table.mark) : ''}
      {lead}
      {rows.swaps ? '' : ' '.repeat(table.mark)}
      {nameText(table, name)}
      {glyph === null || bar === null ? (table.bar > 0 ? ` ${' '.repeat(table.bar)}` : '') : barPart(rows, glyph.color, bar)}
      <Text mono tabular>
        {!hasFigure ? '' : of === null ? figuresText(table, tokens, of).trimEnd() : figuresText(table, tokens, of)}
      </Text>
    </Text>
  )
}

/**
 * A dim note below a table. On the terminal it is broken into lines no wider
 * than the table (`cells`), so the text keeps to the table's column.
 * Elsewhere (`cells` null) the text is not drawn cell for cell, so the
 * surface wraps it.
 */
function noteBelow(el: Ui, text: string, cells: number | null) {
  const { Text } = el
  if (cells === null) {
    return (
      <Text dimColor wrap="wrap">
        {text}
      </Text>
    )
  }

  return wrapCells(text, cells).map(line => <Text dimColor>{line}</Text>)
}

// Level 1.

function groupRows(
  rows: Rows,
  segments: readonly ContextBreakdownSegment[],
  first: number,
  stats: { used: number; largest: ContextBreakdownSegment | null },
  actions: PaneActions,
) {
  const { Button, Text } = rows.el
  const { table } = rows

  return segments
    .filter(segment => segment.tokens > 0)
    .map((segment, index) => {
      const def = segmentDef(segment.id)
      const color = colorOf(rows.palette, def.id)
      const key = `row-${segment.id}`
      const look = lookOf(rows, key)
      const name = nameText(table, def.label, def.short)
      const isLargest = stats.largest?.id === segment.id
      const bar = lengthBarParts(segment.tokens, stats.largest?.tokens ?? 0, table.bar, segment.id)

      if (!rows.swaps) {
        return desktopRow(
          rows,
          {
            key,
            ...(rows.ring === key ? { autoFocus: true as const } : {}),
            onPress: () => void actions.openSegment(segment.id),
          },
          {
            index: first + index,
            lead: leadPart(rows, color),
            name,
            rest: [barPart(rows, color, bar), figuresPart(rows, segment.tokens, stats.used)],
          },
        )
      }
      const { hotkey, mark } = markOf(rows, first + index, look)

      return (
        <Button
          key={key}
          label={def.label}
          plain
          hover={{ scope: key }}
          {...(hotkey === undefined ? {} : { hotkey })}
          {...(rows.ring === key ? { autoFocus: true as const } : {})}
          onPress={() => void actions.openSegment(segment.id)}
        >
          {mark}
          {leadPart(rows, color)}
          {isLargest ? (
            <Text mono weight="bold">
              {name}
            </Text>
          ) : (
            <Text mono>{name}</Text>
          )}
          {barPart(rows, color, bar, look)}
          {figuresPart(rows, segment.tokens, stats.used, look)}
        </Button>
      )
    })
}

/**
 * Group headings are dim: their subtotals must not outweigh the largest row.
 * A heading says what its group is, "Baseline · before your first prompt",
 * where that fits the name and bar columns (`headingText`); a heading has no
 * bar of its own.
 */
function groupHeading(rows: Rows, title: string, long: string, tokens: number, used: number) {
  const { Text } = rows.el
  const { table } = rows

  return (
    <Text mono dimColor>
      {' '.repeat(table.mark + table.lead)}
      {headingText(table, title, long)}
      <Text mono tabular>
        {figuresText(table, tokens, used)}
      </Text>
    </Text>
  )
}

/** The heading's longer forms, which say what each group holds. */
export const BASELINE_HEADING = 'Baseline · before your first prompt'
export const CONVERSATION_HEADING = 'Conversation · since the session started'
export const NOT_LOADED_HEADING = 'Not loaded · outside the window'
/** Reserve's name where the name column has room for it: it says what the reserve is for. */
export const RESERVE_NAME = 'Reserve for compaction'

/** The deferred category names say "(deferred)"; the heading says "Not loaded". */
export function withoutDeferred(name: string): string {
  return name.replace(/\s*\(deferred\)\s*$/i, '') || name
}

/** Whether a deferred category is the MCP tools one, which holds the servers (`notLoadedRows`). */
function isMcp(name: string): boolean {
  return baselineOf(name) === 'mcp'
}

/** The key of the MCP tools row of Not loaded: it opens the servers that are not loaded. */
export const SERVERS_ROW = `row-${NOT_LOADED}`

/**
 * The MCP tools row of Not loaded while a server has tools that are not
 * loaded: a control, as a segment's row is, that opens the list of servers.
 * Its text, "MCP tools · 30 servers, 696 tools", takes the name and bar
 * columns: the row has no bar, as its content is outside the window. It
 * takes a digit only among the first ten rows that open (`index`). Its name
 * is at full strength, as a row that opens; the figures are dim at rest.
 */
function serversRow(rows: Rows, row: NotLoadedRow, index: number, actions: PaneActions) {
  const { Button, Text } = rows.el
  const { table } = rows
  const name = withoutDeferred(row.name)
  const text = serversRowText(table, name, row.servers)
  const look = lookOf(rows, SERVERS_ROW)
  const onPress = () => void actions.openSegment(NOT_LOADED)
  if (!rows.swaps) {
    return desktopRow(
      rows,
      { key: SERVERS_ROW, ...(rows.ring === SERVERS_ROW ? { autoFocus: true as const } : {}), onPress },
      { index, lead: gap(rows, table.lead), name: text, rest: [row.tokens === null ? '' : figuresPart(rows, row.tokens, null)] },
    )
  }
  const { hotkey, mark } = markOf(rows, index, look)

  return (
    <Button
      key={SERVERS_ROW}
      label={name}
      plain
      hover={{ scope: SERVERS_ROW }}
      {...(hotkey === undefined ? {} : { hotkey })}
      {...(rows.ring === SERVERS_ROW ? { autoFocus: true as const } : {})}
      onPress={onPress}
    >
      {mark}
      {gap(rows, table.lead)}
      <Text mono>{text}</Text>
      {row.tokens === null ? '' : figuresPart(rows, row.tokens, null, look)}
    </Button>
  )
}

/** Rows the line that describes the ringed row always takes on the terminal: no line below moves when the ring moves. */
export const DESCRIBE_ROWS = 2

/**
 * What the row under the focus ring holds, for the line below level 1's
 * table: "Tool results: the output of tool calls, …". Empty when the ring
 * is on no row (`lit` is a control's key, or null).
 */
export function describedText(lit: string | null): string {
  if (lit === SERVERS_ROW) {
    return `${NOT_LOADED_DEF.label}: ${NOT_LOADED_DEF.definition}`
  }
  if (lit === null || !lit.startsWith('row-')) {
    return ''
  }
  const def = segmentDef(lit.slice('row-'.length) as ContextBreakdownSegment['id'])

  return def.definition === '' ? '' : `${def.label}: ${def.definition}`
}

/**
 * The terminal's line that describes the row with the focus ring, dim, in
 * lines no wider than the table. It always takes DESCRIBE_ROWS rows, blank
 * when no row has the ring or the pane does not have the keyboard; a longer
 * text ends in an ellipsis. Other surfaces do not report where the focus is,
 * so they draw no such line.
 */
function describeLine(rows: Rows) {
  const { Text } = rows.el
  const lines = wrapCells(describedText(rows.lit), rowCells(rows.table), DESCRIBE_ROWS)

  // A space, not an empty text: an empty line takes no row.
  return Array.from({ length: DESCRIBE_ROWS }, (_, row) => <Text dimColor>{lines[row] ?? ' '}</Text>)
}

/**
 * Level 1's bold heading. While free space is low, the free part takes the
 * host's `warning` colour, on every surface: the theme picks the paint, so
 * the mod replaces no host style. The words say "free" too, so colour is not
 * the only signal. The run sets no weight: it takes the heading's bold.
 * Otherwise the heading is one plain text.
 */
function levelOneHeading(el: Ui, snapshot: ContextBreakdownSnapshot, columns: number) {
  const { Text } = el
  const heading = paneHeading(snapshot, columns)
  if (!isLowFree(snapshot)) {
    return <Text weight="bold">{headingLine(heading)}</Text>
  }

  return (
    <Text weight="bold">
      {heading.used === '' ? '' : `${heading.used} · `}
      <Text color="warning">{heading.free}</Text>
    </Text>
  )
}

function segmentsBody(
  el: Ui,
  snapshot: ContextBreakdownSnapshot,
  columns: number,
  isFocused: boolean,
  actions: PaneActions,
  palette: Palette,
  ring: string | null,
  lit: string | null,
  swaps: boolean,
  caps: boolean,
) {
  const { Box, Text } = el
  const servers = snapshot.notLoadedServers
  const deferred = notLoadedRows(snapshot.deferred, servers, isMcp)
  const shown = [...snapshot.baseline, ...snapshot.conversation].filter(segment => segment.tokens > 0)
  const baselineRows = snapshot.baseline.filter(segment => segment.tokens > 0).length
  // The longer forms of the headings, of Reserve and of the MCP tools row
  // stay out: they show where the table has room, never widen it.
  const names = [
    ...shown.map(segment => segmentDef(segment.id).label),
    'Baseline',
    'Conversation',
    'Free space',
    'Reserve',
    ...deferred.map(category => withoutDeferred(category.name)),
  ]
  const table = tableLayout(columns, Math.max(...names.map(cellWidth)))
  const rows: Rows = { el, table, isFocused, palette, ring, lit, swaps, caps }
  const used = usedTokens(snapshot)
  const stats = { used, largest: largestOf(shown) }
  const mark = snapshot.isEstimate ? '~' : ''
  // On the terminal the text below the table keeps to the table's width.
  const noteCells = swaps ? rowCells(table) : null

  return (
    <Box flexDirection="column">
      {levelOneHeading(el, snapshot, columns)}
      <Text mono dimColor>
        {' '.repeat(table.mark)}
        {columnHeader(table, windowText(table, snapshot, stats.largest, used), `${mark}% of used`)}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {groupHeading(rows, 'Baseline', BASELINE_HEADING, sumTokens(snapshot.baseline), used)}
        {groupRows(rows, snapshot.baseline, 0, stats, actions)}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {groupHeading(rows, 'Conversation', CONVERSATION_HEADING, sumTokens(snapshot.conversation), used)}
        {groupRows(rows, snapshot.conversation, baselineRows, stats, actions)}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {plainRow(rows, 'Free space', freeTokens(snapshot), null, { text: FREE.repeat(2), color: palette.free })}
        {plainRow(
          rows,
          cellWidth(RESERVE_NAME) <= table.name ? RESERVE_NAME : 'Reserve',
          snapshot.reserve,
          null,
          { text: RESERVE.repeat(2), color: palette.reserve },
        )}
      </Box>
      {deferred.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text mono dimColor>
            {' '.repeat(table.mark + table.lead)}
            {notLoadedHeading(table, 'Not loaded', NOT_LOADED_HEADING)}
          </Text>
          {deferred.map(category =>
            // One row stands for every server; it comes after the segments in the ring's order.
            category.servers.length > 0
              ? serversRow(rows, category, shown.length, actions)
              : category.tokens === null
                ? plainRow(rows, withoutDeferred(category.name), 0, null, null, false)
                : plainRow(rows, withoutDeferred(category.name), category.tokens, null, null),
          )}
        </Box>
      )}
      {swaps && (
        <Box flexDirection="column" marginTop={1}>
          {describeLine(rows)}
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        {noteBelow(
          el,
          snapshot.isEstimate
            ? 'All numbers are estimates. ~: the conversation is counted from its characters until the first response after the compaction.'
            : 'All numbers are estimates.',
          noteCells,
        )}
      </Box>
    </Box>
  )
}

// Level 2.

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * The segment's own figure, as level 1 shows it; the items' sum without a
 * measurement. It can be more than the items' sum: a cut list leaves the
 * oldest items out, and a per-tool or per-skill figure is not the whole.
 * For the servers that are not loaded: the MCP tools category's figure, as
 * level 1 shows it; the servers' sum when it has none.
 */
export function segmentTotal(list: ContextBreakdownList, snapshot: ContextBreakdownSnapshot | null): number {
  if (!isSegmentList(list.segment)) {
    // The figure of the MCP tools category, as level 1's row shows it: one
    // figure for one thing. The servers' sum only when it has no figure.
    const rows = snapshot === null ? [] : notLoadedRows(snapshot.deferred, snapshot.notLoadedServers, isMcp)

    return rows.find(row => row.servers.length > 0)?.tokens ?? list.tokens
  }
  const segment = [...(snapshot?.baseline ?? []), ...(snapshot?.conversation ?? [])].find(one => one.id === list.segment)

  return segment?.tokens ?? list.tokens
}

function crumbLine(
  el: Ui,
  list: ContextBreakdownList,
  snapshot: ContextBreakdownSnapshot | null,
  tokens: number,
  columns: number,
  palette: Palette,
) {
  const { Text } = el
  if (!isSegmentList(list.segment)) {
    // The servers that are not loaded are in no segment: no swatch.
    // `tokens` is the category's figure where it has one (`segmentTotal`).
    const crumb = serversCrumb(PANE_TITLE, NOT_LOADED_DEF.block, NOT_LOADED_DEF.label, tokens > 0 ? tokens : null, columns)

    return (
      <Text>
        <Text dimColor>{crumb.trail}</Text>
        <Text weight="bold">{crumb.name}</Text>
        <Text dimColor>{crumb.figures === '' ? '' : `  ${crumb.figures}`}</Text>
      </Text>
    )
  }
  const def = segmentDef(list.segment)
  const used = snapshot === null ? null : usedTokens(snapshot)
  const crumb = crumbFor(PANE_TITLE, def.label, def.short, tokens, used, snapshot?.isEstimate === true, columns)

  return (
    <Text>
      <Text dimColor>{crumb.trail}</Text>
      <Text color={colorOf(palette, list.segment)}>{SWATCH}</Text>
      <Text weight="bold">{` ${crumb.name}`}</Text>
      <Text dimColor>{crumb.figures === '' ? '' : `  ${crumb.figures}`}</Text>
    </Text>
  )
}

/** The order the facts line names. */
function orderWords(sort: ContextBreakdownSort): string {
  return sort === 'size' ? 'largest first' : sort === 'newest' ? 'newest first' : 'most tools first'
}

function listBody(
  el: Ui,
  list: ContextBreakdownList,
  snapshot: ContextBreakdownSnapshot | null,
  columns: number,
  isFocused: boolean,
  actions: PaneActions,
  palette: Palette,
  ring: string | null,
  lit: string | null,
  swaps: boolean,
  caps: boolean,
) {
  const { Box, Button, Text } = el
  const def = isSegmentList(list.segment) ? segmentDef(list.segment) : null
  // The servers that are not loaded have no segment's colour: a neutral grey.
  const color = isSegmentList(list.segment) ? colorOf(palette, list.segment) : palette.notLoaded
  // Without a token figure for any server, the list shows their tools only.
  const hasTokens = def !== null || list.tokens > 0
  // The servers' order is always named: it can be by tools alone.
  const order = list.canSort || def === null ? orderWords(list.sort) : null
  const count = def === null ? `${countOf(list.items, 'server')} · ${countOf(list.tools ?? 0, 'tool')}` : plural(list.items, 'item')
  const facts = listFacts(count, order, list.page, list.pages, columns)
  const widest =
    def === null
      ? Math.max(1, ...list.rows.map(row => cellWidth(row.title))) + 2 + Math.max(0, ...list.rows.map(row => cellWidth(row.detail)))
      : Math.max(1, ...list.rows.map(row => cellWidth(row.detail === '' ? row.title : `${row.title}  ${row.detail}`)))
  // No swatch: every row has the segment's colour, which the breadcrumb shows once.
  const laid = tableLayout(columns, widest, false)
  // No figure, so no bar and no share: the token cell stays empty.
  const table = hasTokens ? laid : { ...laid, bar: 0, share: false }
  const rows: Rows = { el, table, isFocused, palette, ring, lit, swaps, caps }
  // Scaled to the largest item on this page, as level 1 to its largest row.
  const largest = largestOf(list.rows)?.tokens ?? 0
  // Shares of the figure the breadcrumb shows, so "% of segment" means it.
  // The servers' shares are of the MCP tools category's figure, as level 1
  // shows it, which the column names.
  const total = segmentTotal(list, snapshot)
  const column = list.rows.length > 0 && table.share ? (def === null ? `% of ${formatTokens(total)}` : '% of segment') : null
  // The facts and the column name share a row where they fit on one.
  const joined = column === null ? null : factsRow(table, facts, column)
  const servers = def === null ? serverNames(table, list.rows) : null
  // On the terminal the text below the table keeps to the table's width.
  const noteCells = swaps ? rowCells(table) : null
  const hidden =
    list.hiddenItems === 0
      ? null
      : def !== null
        ? `${plural(list.hiddenItems, 'more item')}, ${formatTokens(list.hiddenTokens)}, on other pages`
        : hasTokens
          ? `${countOf(list.hiddenItems, 'more server')}, ${formatTokens(list.hiddenTokens)}, on other pages`
          : `${countOf(list.hiddenItems, 'more server')} on other pages`
  const sizes = def?.group === 'conversation' && list.items > 0 ? 'Sizes are estimated from each item’s characters.' : null
  // A dim title marks a row that does not open beside rows that do. Where no
  // row on the page opens (the servers, most skills lists), it would mark
  // nothing, so the titles stay at full strength.
  const marksClosed = list.rows.some(row => row.isOpenable)
  let openable = 0

  return (
    <Box flexDirection="column">
      {crumbLine(el, list, snapshot, total, columns, palette)}
      {/* What the list holds, in the table's width on the terminal, as the text below the table. */}
      {noteBelow(el, sentence(def === null ? NOT_LOADED_DEF.definition : def.definition), noteCells)}
      {joined === null ? (
        <Text dimColor>{facts}</Text>
      ) : (
        <Text mono dimColor>
          {joined}
        </Text>
      )}
      {list.note !== null && (
        <Text dimColor wrap="wrap">
          {list.note}
        </Text>
      )}
      {joined === null && column !== null && (
        <Text mono dimColor>
          {' '.repeat(table.mark)}
          {columnHeader(table, '', column)}
        </Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        {list.rows.map((row, at) => {
          const index = row.isOpenable ? openable++ : null
          const key = `item-${row.id}`
          // A row that does not open is no Button: nothing inverts it.
          const look = index === null ? undefined : lookOf(rows, key)
          const { hotkey, mark } = index === null ? { mark: gap(rows, table.mark) } : markOf(rows, index, look)
          const names = servers?.[at] ?? itemNames(table, row.title, row.detail, row.pathIn)
          const inner = [
            mark,
            // A row that does not open is dim all through, as a line that is
            // not a control, while other rows on the page open (`marksClosed`).
            index === null && marksClosed ? (
              <Text mono dimColor>
                {names.title}
              </Text>
            ) : (
              <Text mono>{names.title}</Text>
            ),
            <Text
              mono
              dimColor={look?.lit !== true}
              {...(look === undefined ? {} : { hover: { scope: look.scope, dimColor: false } })}
            >
              {names.detail}
            </Text>,
            barPart(rows, color, lengthBarParts(row.tokens, largest, table.bar), look),
            hasTokens ? figuresPart(rows, row.tokens, total, look) : '',
          ]
          if (index === null) {
            return <Text mono>{inner}</Text>
          }

          if (!rows.swaps) {
            return desktopRow(
              rows,
              {
                key,
                ...(ring === key ? { autoFocus: true as const } : {}),
                onPress: () => void actions.openItem(row.id),
              },
              {
                index,
                lead: '',
                name: names.title,
                rest: [
                  <Text mono dimColor>
                    {names.detail}
                  </Text>,
                  barPart(rows, color, lengthBarParts(row.tokens, largest, table.bar)),
                  figuresPart(rows, row.tokens, total),
                ],
              },
            )
          }

          return (
            <Button
              key={key}
              label={row.title}
              plain
              hover={{ scope: key }}
              {...(hotkey === undefined ? {} : { hotkey })}
              {...(ring === key ? { autoFocus: true as const } : {})}
              onPress={() => void actions.openItem(row.id)}
            >
              {inner}
            </Button>
          )
        })}
      </Box>
      {(hidden !== null || sizes !== null) && (
        // One blank row between the table and its notes, as at level 1.
        <Box flexDirection="column" marginTop={1}>
          {hidden !== null && noteBelow(el, hidden, noteCells)}
          {sizes !== null && noteBelow(el, sizes, noteCells)}
        </Box>
      )}
    </Box>
  )
}

// Level 3.

/** The control under the text of a page that has a next one: k crossing back puts the ring on it. */
export const NEXT_BELOW = 'next-below'

/**
 * Level 3: the title, the facts line, then `keys` (the controls), then the
 * text. The controls stand above the text so that the ring, which the engine
 * brings into view on every new tree, keeps the heading in view too.
 */
function contentBody(
  el: Ui,
  segment: ContextBreakdownListId,
  item: ContextBreakdownContent,
  palette: Palette,
  keys: RenderElement,
  actions: PaneActions,
  ring: string | null,
) {
  const { Box, Button, Code, Markdown, Text } = el
  // No server row opens, so this is a segment's item; the servers' names stand in all the same.
  const def = isSegmentList(segment) ? segmentDef(segment) : { short: NOT_LOADED_DEF.label }
  const facts = [
    `${formatTokens(item.tokens)} tokens`,
    item.format === 'formatted' ? 'formatted' : 'raw',
    item.source === 'loaded' ? 'as loaded' : 'on disk',
  ]
  // Where the page lies in the whole item: a page holds hundreds of lines,
  // so a page number alone says little.
  const place = lineFacts(item)
  if (place !== '') {
    facts.push(place)
  }
  // The raw view promises every character: a line too long for the engine's
  // Code element is split, and the facts line says so.
  const code = item.format === 'raw' && item.text !== '' ? codeRuns(item.text, item.startLine) : null
  if (code?.isSplit === true) {
    facts.push('long lines split')
  }

  // The title wraps: a cut would drop the file name at the end of a path.
  return (
    <Box flexDirection="column">
      <Text weight="bold" wrap="wrap">
        <Text color={isSegmentList(segment) ? colorOf(palette, segment) : palette.notLoaded}>██</Text> {def.short} ›{' '}
        {item.title}
      </Text>
      <Text dimColor>{facts.join(' · ')}</Text>
      {item.isChanged && item.source === 'loaded' && (
        <Text color="warning" weight="bold" wrap="wrap">
          ! The file changed on disk since it was loaded.
        </Text>
      )}
      {item.note !== null && (
        <Text dimColor wrap="wrap">
          {item.note}
        </Text>
      )}
      {item.notice !== null && <Text dimColor>{item.notice}</Text>}
      {keys}
      <Box flexDirection="column" marginTop={1}>
        {item.text === '' ? (
          <Text dimColor>(empty)</Text>
        ) : code === null ? (
          // No onLinkPress: a link is the surface's to open, as in a reply.
          <Markdown key="content-formatted" text={item.text} />
        ) : (
          code.runs.map((run, index) => (
            <Code
              key={index === 0 ? 'content' : `content-${index}`}
              source={run.source}
              {...(run.startLine === null ? {} : { startLine: run.startLine })}
              {...(item.language === null ? {} : { path: item.language })}
            />
          ))
        )}
      </Box>
      {item.page + 1 < item.pages && (
        <Box marginTop={1}>
          <Button
            key={NEXT_BELOW}
            label="Next page"
            plain
            dimColor
            {...(ring === NEXT_BELOW ? { autoFocus: true as const } : {})}
            onPress={() => void actions.contentPage(1)}
          />
        </Box>
      )}
    </Box>
  )
}

// The keys line: one dim row of controls, under levels 1 and 2 and above the
// text of level 3.

/**
 * One control. `isOn` false: it does not apply now, but it can after a move
 * on the same screen (Prev page on the first of several pages), so it stays
 * in the line, drawn dimmer, and its press does nothing. A control that
 * cannot apply on the screen as it is never becomes one (`keyGroups`).
 */
type Control = { key: string; label: string; hotkey: string; isOn: boolean; onPress: (surface: RenderSurface) => unknown }

/**
 * How a control stands on the screen as it is: `on`; `off`, which a move on
 * the same screen can turn on; or `gone`, which nothing on this screen can
 * turn on (b on the segments, s in a list with one order, p and n in a list
 * with one page, v, c and m for an item they do not fit). A gone control
 * leaves the line (`hiddenKeys` may still hold its key).
 */
type Stand = 'on' | 'off' | 'gone'

/** The key of j's Button: level 3's own, so no other level's tree holds it (scroll.ts). */
function downKey(view: ContextBreakdownView): string {
  return view.level === 3 ? SCROLL_DOWN : LIST_DOWN
}

/**
 * Whether the keys line draws the j and k controls (↓ and ↑). Only the terminal draws
 * them, and only with the keyboard: a click moves one row, which the wheel
 * does better. Elsewhere Tab moves the ring along the rows and the app's own
 * scrolling moves the text.
 */
function hasSteps(isFocused: boolean, surface: RenderSurface): boolean {
  return surface === 'terminal' && isFocused
}

/**
 * Whether the pane offers its keys now: the key words and the hotkeys. The
 * desktop and VS Code draw a hotkey as a key cap and keep the keys in both
 * states. The terminal, and the mobile app, which has no keyboard, offer them
 * only while the pane holds the keys.
 */
function showsKeys(isFocused: boolean, surface: RenderSurface): boolean {
  return isFocused || surface === 'desktop' || surface === 'vscode'
}

/**
 * One group of the keys line: the words, then the controls, that belong
 * together. The line breaks only between groups (`keysLine`). `move` holds
 * the keys that move the ring, the window or the level; `view` the keys
 * that change the text of level 3; `pane` the keys for the whole pane.
 */
type KeyGroup = { key: 'move' | 'view' | 'pane'; words: string[]; controls: Control[] }

/** The label of `s`: the order it switches to; the facts line names the one shown. */
function sortLabel(list: ContextBreakdownList): string {
  if (list.sort !== 'size') {
    return 'Largest first'
  }

  return list.segment === NOT_LOADED ? 'Most tools first' : 'Newest first'
}

/** The keys line: its groups, and the keys of the controls that left it. */
type KeyLine = { groups: KeyGroup[]; gone: string[] }

/**
 * The groups of the keys line, in their order, and the controls in each:
 * level 1 move [open words, j, k], pane [r, x]; level 2 move [open words,
 * j, k, b, p, n], pane [s, r, x]; level 3 move [j, k, b, p, n], view [f, v,
 * c, m], pane [r, x]. Close is last on every level.
 *
 * A control that cannot apply on the screen as it is leaves the line
 * (`gone`): b on the segments, which have no level to go back to; s in a
 * list with one order (a baseline segment, the servers without a token
 * figure); p and n together in a list with one page; v for an item that
 * cannot switch its source; c and m for an item with no file. One that a
 * move on the same screen can turn on stays, dimmer (p on the first of
 * several pages). p and n leave and come back as a pair. Level 3 keeps p
 * and n in the line. The controls that remain keep their order. A group
 * with nothing in it is left out.
 */
function keyGroups(
  view: ContextBreakdownView,
  actions: PaneActions,
  isFocused: boolean,
  surface: RenderSurface,
  openRows: number,
  columns: number,
): KeyLine {
  const gone: string[] = []
  const move: Control[] = []
  const shown: Control[] = []
  const pane: Control[] = []
  const add = (to: Control[], key: string, label: string, hotkey: string, stand: Stand, onPress: Control['onPress']) => {
    if (stand === 'gone') {
      gone.push(hotkey)

      return
    }
    to.push({ key, label, hotkey, isOn: stand === 'on', onPress: stand === 'on' ? onPress : () => undefined })
  }
  const on = (isOn: boolean): Stand => (isOn ? 'on' : 'off')
  const only = (fits: boolean): Stand => (fits ? 'on' : 'gone')
  // The register's `ui.press` hooks do the move (ring.ts, scroll.ts), so the
  // Buttons' own presses do nothing.
  if (hasSteps(isFocused, surface)) {
    add(move, downKey(view), '↓', 'j', 'on', () => undefined)
    add(move, view.level === 3 ? SCROLL_UP : LIST_UP, '↑', 'k', 'on', () => undefined)
  }
  add(move, 'back', 'Back', 'b', only(view.level !== 1), actions.back)
  if (view.level === 2) {
    const { list } = view
    // One page: neither key can turn on here, so both leave the line.
    const paged = list.pages > 1
    add(move, 'prev', 'Prev page', 'p', paged ? on(list.page > 0) : 'gone', () => actions.listPage(-1))
    add(move, 'next', 'Next page', 'n', paged ? on(list.page + 1 < list.pages) : 'gone', () => actions.listPage(1))
    add(pane, 'sort', sortLabel(list), 's', only(list.canSort), actions.toggleSort)
  }
  if (view.level === 3) {
    const { item } = view
    add(move, 'prev', 'Prev page', 'p', on(item.page > 0), () => actions.contentPage(-1))
    add(move, 'next', 'Next page', 'n', on(item.page + 1 < item.pages), () => actions.contentPage(1))
    // Names the view it switches to; the facts line names the one shown. The
    // register's `ui.press` hook switches, as for j and k: it scrolls the
    // window to the same place, which only a hook's scroll can do.
    add(shown, 'format', item.format === 'formatted' ? 'Raw' : 'Formatted', 'f', 'on', () => undefined)
    add(shown, 'view', item.source === 'loaded' ? 'On disk' : 'As loaded', 'v', only(item.canToggle), actions.toggleSource)
    // Gone without a path, so the empty path is never used.
    const path = item.path ?? ''
    add(shown, 'copy', 'Copy path', 'c', only(item.path !== null), press => actions.copy(path, press))
    add(shown, 'mention', 'Mention', 'm', only(item.path !== null), () => actions.mention(path))
  }
  add(pane, 'refresh', 'Refresh', 'r', 'on', actions.refresh)
  add(pane, 'close', 'Close', 'x', 'on', actions.close)
  const words = view.level === 3 ? [] : openWords(openRows, columns, showsKeys(isFocused, surface))
  const groups: KeyGroup[] = [
    { key: 'move', words, controls: move },
    { key: 'view', words: [], controls: shown },
    { key: 'pane', words: [], controls: pane },
  ]

  return { groups: groups.filter(group => group.words.length > 0 || group.controls.length > 0), gone }
}

/**
 * The keys of the controls that left the line, which the pane still takes
 * with nothing drawn: each a Button that does nothing, in a Box drawn
 * `display: "none"`. A reflex press then stays in the pane, where it would
 * otherwise go to the prompt and take the keyboard from the pane. Seen live
 * on the terminal (Claude Code 2.1.328): a hidden Button keeps its hotkey,
 * and it also keeps a stop for Tab, on which no ring shows. So they stand
 * last, after Close, and the ring passes over them (`pastHidden`). Only on
 * the terminal, and only while the pane holds the keys: no other surface was seen to hide a native button this way, so
 * there the keys of those controls are not taken.
 */
export function hiddenKeys(gone: readonly string[], isFocused: boolean, surface: RenderSurface): string[] {
  return surface === 'terminal' && isFocused ? [...gone] : []
}

/** The key of the hidden Button that takes the hotkey `letter` (`hiddenKeys`). */
export function hiddenKey(letter: string): string {
  return `taken-${letter}`
}

/**
 * Where the focus ring goes instead when Tab or Shift+Tab lands it on a
 * hidden Button (`hiddenKeys`), or null for any other element. No ring shows
 * on a hidden Button, so the ring passes over them. They stand right after
 * Close. So a ring that comes from Close came forward: it goes to the element
 * after them, the Next page button below the text of level 3 where it is
 * drawn, else the first element of the pane. A ring that comes from anywhere
 * else came backward: it goes to Close. `before` is the key the ring was on.
 * Hidden Buttons are drawn only on the terminal with the keys, so j's control
 * is drawn too.
 */
export function pastHidden(
  element: string | undefined,
  before: string | null,
  view: ContextBreakdownView,
  snapshot: ContextBreakdownSnapshot | null,
): string | null {
  if (element === undefined || !element.startsWith(hiddenKey(''))) {
    return null
  }
  if (before !== 'close') {
    return 'close'
  }
  if (view.level === 3) {
    return view.item.page + 1 < view.item.pages ? NEXT_BELOW : downKey(view)
  }

  return rowKeys(view, snapshot)[0] ?? downKey(view)
}

/** How the pane gets the keyboard, on the terminal: ctrl+x tab reaches the bar only, never the pane. */
export const KEYS_HINT = 'For keys: click the pane, or run /ctx'
/** Elsewhere: a click works on every surface. */
export const CLICK_HINT = 'Click the pane for keys'

/** The line that says how the pane gets the keyboard, while it has not. */
export function keysHint(surface: RenderSurface): string {
  return surface === 'terminal' ? KEYS_HINT : CLICK_HINT
}

/**
 * The words before the controls while the pane offers its keys (`shows`):
 * Enter or a digit opens a row. "0" joins the digits when the page has a
 * tenth row that opens; a pane too narrow for digits names Enter alone. The
 * arrows and Tab still move the ring, unnamed. Without the keys, or with no
 * row that opens (`openRows`), none: the hint stands on its own line, and
 * the controls keep only their labels, so a click still works and no key is
 * offered that would go to the prompt.
 */
export function openWords(openRows: number, columns: number, shows: boolean): string[] {
  if (!shows || openRows === 0) {
    return []
  }
  if (!showsHotkeys(columns)) {
    return ['⏎: Open']
  }

  return [openRows >= 10 ? '⏎ 1-9 0: Open' : '⏎ 1-9: Open']
}

/**
 * The key of the element that takes the focus ring when a tree is drawn: the
 * row b came back from when it is shown, else the first row; at level 3 the
 * first control, or the control under the text when k crossed back into the
 * page. Null when the tree has no such element. The first control is j's,
 * where it is drawn; else Back, or at level 1, which draws no Back, Refresh.
 */
export function ringKey(
  view: ContextBreakdownView,
  snapshot: ContextBreakdownSnapshot | null,
  isFocused: boolean,
  surface: RenderSurface = 'terminal',
): string | null {
  const firstControl = hasSteps(isFocused, surface) ? downKey(view) : view.level === 1 ? 'refresh' : 'back'
  if (view.level === 3) {
    return view.item.atEnd && view.item.page + 1 < view.item.pages ? NEXT_BELOW : firstControl
  }
  if (view.level === 2) {
    const ids = view.list.rows.filter(row => row.isOpenable).map(row => row.id)
    const id = view.from !== undefined && ids.includes(view.from) ? view.from : ids[0]

    return id === undefined ? firstControl : `item-${id}`
  }
  if (snapshot === null) {
    return firstControl
  }
  const ids = levelOneLists(snapshot)
  const id = view.from !== undefined && ids.includes(view.from) ? view.from : ids[0]

  return id === undefined ? firstControl : `row-${id}`
}

function keysLine(
  el: Ui,
  view: ContextBreakdownView,
  openRows: number,
  columns: number,
  isFocused: boolean,
  surface: RenderSurface,
  actions: PaneActions,
  ring: string | null,
) {
  const { Box, Button, Text } = el
  const line = keyGroups(view, actions, isFocused, surface, openRows, columns)
  const taken = hiddenKeys(line.gone, isFocused, surface)
  const button = (control: Control) => {
    const props = {
      key: control.key,
      label: control.label,
      plain: true as const,
      ...(showsKeys(isFocused, surface) ? { hotkey: control.hotkey } : {}),
      ...(control.key === 'close' ? { role: 'dismiss' as const } : {}),
      ...(ring === control.key ? { autoFocus: true as const } : {}),
      onPress: (press: { surface: RenderSurface }) => void control.onPress(press.surface),
    }

    // A desktop draws a native button that shows only its label and
    // drops a child: a live control is drawn as it is, and one that
    // does not apply is drawn dim.
    if (surface !== 'terminal') {
      return control.isOn ? <Button {...props} /> : <Button {...props} dimColor />
    }

    // On the terminal a control that does not apply draws its label in
    // the theme's faint colour, a step below the others' dim.
    return control.isOn ? (
      <Button {...props} dimColor />
    ) : (
      <Button {...props}>
        <Text color="subtle">{control.label}</Text>
      </Button>
    )
  }

  // The hint gets a row of its own: beside the label-only controls it would
  // read as one phrase ("click the pane  Close"). The desktop and VS Code
  // keep the key words and the controls' hotkeys (drawn as key caps) in both
  // states, so Esc changes their line by the hint's row only (`showsKeys`).
  // A hotkey presses only while the pane holds the keys.
  //
  // Each group is a Box of its own in a row that wraps: the line breaks
  // between groups, so keys that belong together stay together. A group
  // wider than the pane shrinks to it and wraps inside itself.
  return (
    <Box flexDirection="column" marginTop={1}>
      {!isFocused && (
        <Text dimColor wrap="wrap">
          {keysHint(surface)}
        </Text>
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {line.groups.map(group => (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {group.words.map(words => (
              <Text dimColor>{words}</Text>
            ))}
            {group.controls.map(button)}
          </Box>
        ))}
      </Box>
      {taken.length > 0 && (
        <Box display="none">
          {taken.map(letter => (
            <Button key={hiddenKey(letter)} label={letter} plain hotkey={letter} onPress={() => undefined} />
          ))}
        </Box>
      )}
    </Box>
  )
}

/**
 * The pane's tree, `columns` wide: the level the view names, or a waiting
 * line before the first measurement. `isFocused` is whether the pane holds
 * the keyboard (`e.props.isFocused`); `surface` picks how the hint says to
 * get it. `keepsPlace`: `/ctx` only gave an open pane the keyboard, so no
 * element asks for the ring here. The engine still gives the pane a ring
 * and brings it into view; the `/ctx` hook then puts the window back.
 * `ringNow`: the key of the element the last focus event gave the ring.
 */
export function paneTree(
  el: Ui,
  snapshot: ContextBreakdownSnapshot | null,
  view: ContextBreakdownView,
  columns: number,
  actions: PaneActions,
  palette: Palette,
  isFocused: boolean,
  surface: RenderSurface,
  keepsPlace = false,
  ringNow: string | null = null,
): RenderElement {
  const { Box, Text } = el
  const ring = keepsPlace ? null : ringKey(view, snapshot, isFocused, surface)
  // Where the ring is: the last focus event's element, or, before the first
  // one for this tree, the element that asks for the ring. A pane without
  // the keyboard shows no ring.
  const lit = isFocused ? (ringNow ?? ring) : null
  if (view.level === 3) {
    const keys = keysLine(el, view, 0, columns, isFocused, surface, actions, ring)

    return contentBody(el, view.list.segment, view.item, palette, keys, actions, ring)
  }
  let body: RenderElement
  // The rows that open on the page: Enter and the digits name them.
  let openRows = 0
  if (view.level === 2) {
    body = listBody(el, view.list, snapshot, columns, isFocused, actions, palette, ring, lit, surface === 'terminal', showsKeys(isFocused, surface))
    openRows = view.list.rows.filter(row => row.isOpenable).length
  } else if (snapshot === null) {
    body = <Text dimColor>Measuring the context window…</Text>
  } else {
    body = segmentsBody(el, snapshot, columns, isFocused, actions, palette, ring, lit, surface === 'terminal', showsKeys(isFocused, surface))
    openRows = levelOneLists(snapshot).length
    if (view.note !== undefined) {
      body = (
        <Box flexDirection="column">
          <Text dimColor wrap="wrap">
            {view.note}
          </Text>
          {body}
        </Box>
      )
    }
  }

  return (
    <Box flexDirection="column">
      {body}
      {keysLine(el, view, openRows, columns, isFocused, surface, actions, ring)}
    </Box>
  )
}
