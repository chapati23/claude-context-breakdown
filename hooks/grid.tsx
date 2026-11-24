// The pane on the surfaces other than the terminal (the desktop app, the
// editor, the mobile app): the same three levels as `pane.tsx`, laid out in
// one grid. Those surfaces draw text in a proportional face and a Button as a
// native button that shows only its label, so no column here counts on
// character cells or runs of spaces: each column is a Box of its own, and the
// colours are pictures.
//
// The grid of a row, left to right: the lead (a swatch at level 1), the name
// (a Button where the row opens, else a Text that starts where a Button's
// label starts), the length bar, then the figures in Boxes of fixed width,
// right-aligned: tokens, share, added. Headings, Free space, Reserve, the
// Not loaded rows, the column names and the notes stand in the same grid, so
// every figure of one kind ends at one x. Rows carry no hotkey: the native
// button would draw a key cap. A row opens with a click, or with the app's
// own focus keys and Enter. The controls keep their hotkeys (`showsKeys`).
//
// Units: a Box's width counts in cells, an Svg's in CSS pixels, and the
// declarations state no size for a cell (MEASURED_CELL_PX is one Mac's). So
// every picture whose width matters stands in a Box of whole cells and sets
// no `width`: the declarations say it then takes the markup's own width up
// to its Box. The markup is drawn for MEASURED_CELL_PX, so at that cell it
// fills its Box; a smaller cell squeezes it into the Box, and a larger one
// leaves room after it. The figures are right-aligned in Boxes of whole
// cells, so no figure column moves with the cell's size.

import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type {
  ContextBreakdownBase,
  ContextBreakdownList,
  ContextBreakdownRow,
  ContextBreakdownSegment,
  ContextBreakdownSnapshot,
  ContextBreakdownView,
} from '../types'
import type { Ui } from './band'
import { formatShare, formatTokens } from './format'
import { colorOf } from './palette'
import type { Palette } from './palette'
import {
  BASELINE_HEADING,
  CONVERSATION_HEADING,
  NOT_LOADED_HEADING,
  RESERVE_NAME,
  SERVERS_ROW,
  addedNote,
  contentBody,
  contentListCrumb,
  keyGroups,
  keysHint,
  levelOne,
  levelOneHeading,
  levelTwo,
  placeFact,
  ringKey,
  showsKeys,
  withoutDeferred,
} from './pane'
import type { Control, LevelTwo, PaneActions } from './pane'
import { levelOneLists } from './ring'
import { NOT_LOADED, NOT_LOADED_DEF, isSegmentList, segmentDef, sentence } from './segments'
import { freeTokens, sumTokens, usedTokens } from './snapshot'
import { PANE_TITLE } from './state'
import {
  MEASURED_CELL_PX,
  LENGTH_BAR_HEIGHT,
  SVG_BAR_HEIGHT,
  SVG_SWATCH_PX,
  lengthBarPicture,
  segmentTexture,
  swatchPicture,
  windowBarPicture,
} from './svgbar'
import type { Texture, WindowPart } from './svgbar'
import { ADDED_NAME, crumbFor, headingText, notLoadedHeading, serversCrumb, serversRowText, textCells, windowText } from './table'
import type { Table } from './table'
import { cellWidth, headCells, shortenPath } from './text'
import { fit, headingLine, paneHeading } from './view'

/** The widest the grid grows, in cells: in a wider pane it does not stretch. */
export const GRID_MAX_CELLS = 64
/** The lead before a level 1 row's name: holds the swatch. */
export const LEAD_CELLS = 2
/**
 * The smallest cell the grid holds for, in CSS pixels. The declarations
 * state no size: one Mac measured MEASURED_CELL_PX, and another code font
 * gives another size.
 */
export const MIN_CELL_PX = 7
/** The length bar's column: in a grid at its widest, and in a narrower one. */
export const BAR_CELLS = 8
export const BAR_NARROW_CELLS = 5
/**
 * The padding a native button draws before its label, 6 CSS pixels, in
 * cells: a name that is a Text starts after it, where a Button's label
 * starts. The one fractional cell in the grid.
 */
export const LABEL_PAD_CELLS = Math.round((6 / MEASURED_CELL_PX) * 10000) / 10000
/**
 * The padding a native button draws on both sides of its label, 12 CSS
 * pixels, in whole cells at the smallest cell: a column that holds a Button
 * leaves this room beside the label's cells, because the button does not
 * shrink.
 */
export const BUTTON_PAD_CELLS = Math.ceil(12 / MIN_CELL_PX)
/**
 * CSS pixels of one advance of the code font, measured on the same Mac as
 * MEASURED_CELL_PX. A pane's `columns` count these advances, and a Box's
 * cell is wider (8.8 against 8.43 pixels): a grid of `columns` cells would
 * end past the pane's body. So the grid takes the cells that fit in the
 * columns' pixels.
 */
export const MEASURED_ADVANCE_PX = 8.43
/**
 * The fewest cells a figure column has. At a cell of about 7.5 pixels "%" is
 * wider than a cell, and a share such as "50%" in 4 cells breaks onto a
 * second line. 5 cells is the target's width.
 */
export const FIGURE_MIN_CELLS = 5
/**
 * The cells an item's detail keeps at level 2 where the row has room: the
 * title's column stops short of them. In a narrow row the title still gets
 * half of the cells that it shares with the detail.
 */
export const DETAIL_MIN_CELLS = 12
/** The words before the controls while a row opens and the pane offers its keys: Enter opens the row with the focus. */
export const OPEN_WORDS = '⏎: Open'
/**
 * What a swatch's picture says to a reader that cannot see it. Short: the
 * name beside it says the rest, and a row says its name once in its Button
 * and once in its length bar's text.
 */
export const SWATCH_ALT = 'Colour'

/** The element table of a surface that has `Svg`. */
type GridUi = Elements['desktop'] | Elements['mobile'] | Elements['vscode']

/**
 * The grid's width for a pane `columns` wide: the cells that fit in the
 * columns' pixels (MEASURED_ADVANCE_PX), at most the columns less one spare
 * cell each side, and at most GRID_MAX_CELLS.
 */
export function gridCells(columns: number): number {
  return Math.max(1, Math.min(GRID_MAX_CELLS, columns - 2, Math.floor((columns * MEASURED_ADVANCE_PX) / MEASURED_CELL_PX)))
}

/**
 * A right-aligned column's width: its widest text on the page, and one cell
 * to spare. In the surface's face a figure or a capital can be wider than a
 * cell when the cell is small, and a column too narrow for its text breaks
 * it onto a second line. Every row of the page takes this one width.
 */
export function columnCells(texts: readonly (string | null)[]): number {
  return Math.max(0, ...texts.map(text => (text === null ? 0 : cellWidth(text)))) + 1
}

/** A figure column's width: `columnCells`, and at least FIGURE_MIN_CELLS. */
export function figureColumnCells(texts: readonly (string | null)[]): number {
  return Math.max(FIGURE_MIN_CELLS, columnCells(texts))
}

/**
 * A level 1 row's name for a Button in `room` cells: the name, else the
 * mod's short name, else the short name cut with an ellipsis. The Button
 * takes the label's cells and BUTTON_PAD_CELLS, and does not shrink.
 */
export function fittedName(name: string, short: string, room: number): string {
  const cells = Math.max(1, room - BUTTON_PAD_CELLS)
  if (cellWidth(name) <= cells) {
    return name
  }

  return cellWidth(short) <= cells ? short : fit(short, cells).trimEnd()
}

/** The length bar's cells: none where the terminal's table drops its bar, fewer where the grid is not at its widest. */
export function barCells(table: Table, grid: number): number {
  return table.bar === 0 ? 0 : grid >= GRID_MAX_CELLS ? BAR_CELLS : BAR_NARROW_CELLS
}

/** One figure: its text, and whether it is dim. Null text: the column stays empty. */
type Figure = { text: string | null; dim: boolean }

/** What every row of one level shares while it is drawn. */
type Grid = {
  el: GridUi
  /** The figure columns each row has, in order after tokens: the share, the column `added`. */
  share: boolean
  added: boolean
  /** The width of each figure column on the page (`columnCells`). */
  cells: FigureCells
  /** The length bar's cells, 0 for none. */
  bar: number
  /** The key of the element that takes the focus ring (`ringKey`). */
  ring: string | null
}

/** The width of each figure column, in cells. */
type FigureCells = { tokens: number; share: number; added: number }

const NO_CELLS: FigureCells = { tokens: 1, share: 1, added: 1 }

/** The cells the columns right of a row's name take, each with its gap of one cell. */
function rightCells(g: Grid): number {
  return (g.bar > 0 ? g.bar + 1 : 0) + g.cells.tokens + 1 + (g.share ? g.cells.share + 1 : 0) + (g.added ? g.cells.added + 1 : 0)
}

function figureBox(g: Grid, figure: Figure, width: number) {
  const { Box, Text } = g.el

  return (
    <Box width={width} flexShrink={0} justifyContent="flex-end">
      {figure.text !== null && (
        <Text tabular {...(figure.dim ? { dimColor: true } : {})}>
          {figure.text}
        </Text>
      )}
    </Box>
  )
}

/** A row's figure columns: tokens, then the share and the column `added` where the grid has them. */
function figures(g: Grid, tokens: Figure, share: Figure, added: Figure) {
  return [figureBox(g, tokens, g.cells.tokens), g.share ? figureBox(g, share, g.cells.share) : null, g.added ? figureBox(g, added, g.cells.added) : null]
}

const NONE: Figure = { text: null, dim: true }

/** One row of the grid: `left` takes the room the fixed columns on the right leave. */
function gridRow(g: Grid, left: unknown[], right: unknown[]) {
  const { Box } = g.el

  return (
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      <Box flexDirection="row" alignItems="center" flexGrow={1} flexShrink={1} minWidth={0}>
        {left as RenderElement[]}
      </Box>
      {right as RenderElement[]}
    </Box>
  )
}

/** A swatch picture in `color`. */
function swatch(g: Grid, color: string, texture: Texture | null) {
  const { Svg } = g.el

  return <Svg source={swatchPicture(color, texture)} alt={SWATCH_ALT} width={SVG_SWATCH_PX} height={SVG_SWATCH_PX} />
}

/** The lead column of a level 1 row: the swatch, or nothing in its place. */
function lead(g: Grid, picture: RenderElement | null) {
  const { Box } = g.el

  return (
    <Box width={LEAD_CELLS} flexShrink={0} flexDirection="row" alignItems="center">
      {picture}
    </Box>
  )
}

/** A row's Button: its name is the label, with no hotkey, and the Button holds nothing else. */
function rowButton(g: Grid, key: string, label: string, onPress: () => void) {
  const { Button } = g.el

  return <Button key={key} label={label} plain {...(g.ring === key ? { autoFocus: true as const } : {})} onPress={onPress} />
}

/** The name of a level 1 row that opens. */
function nameButton(g: Grid, key: string, label: string, onPress: () => void) {
  const { Box } = g.el

  return (
    <Box flexDirection="row" flexShrink={0}>
      {rowButton(g, key, label, onPress)}
    </Box>
  )
}

/**
 * A name that does not open: a Text that starts where a Button's label
 * starts. Where it does not fit, the surface cuts it at its end: it never
 * takes a second line.
 */
function plainName(g: Grid, name: string, dim: boolean) {
  const { Box, Text } = g.el

  return (
    <Box flexDirection="row" paddingLeft={LABEL_PAD_CELLS} flexShrink={1} minWidth={0}>
      <Text wrap="truncate" maxLines={1} {...(dim ? { dimColor: true } : {})}>
        {name}
      </Text>
    </Box>
  )
}

/**
 * A row's length bar in its column: `tokens` against `largest`, which fills
 * it. `alt` says what it shows, from the full texts.
 */
function lengthBar(g: Grid, tokens: number, largest: number, color: string, alt: string) {
  const { Box, Svg } = g.el
  if (g.bar === 0) {
    return null
  }

  return (
    <Box width={g.bar} flexShrink={0} flexDirection="row" alignItems="center">
      <Svg source={lengthBarPicture(tokens, largest, color, g.bar * MEASURED_CELL_PX)} alt={alt} height={LENGTH_BAR_HEIGHT} />
    </Box>
  )
}

/** Dim notes below a level, one after the other, wrapped by the surface. */
function notes(el: GridUi, texts: readonly string[]) {
  const { Box, Text } = el

  return (
    texts.length > 0 && (
      <Box flexDirection="column" marginTop={1}>
        {texts.map(text => (
          <Text dimColor wrap="wrap">
            {text}
          </Text>
        ))}
      </Box>
    )
  )
}

// Level 1.

/**
 * The line under the bar: the window on the left, the column names over
 * their columns. While free space is low the left text also names the
 * largest segment where it fits beside the names (`windowText`); where it
 * does not, it gives way to the window alone and the names stay.
 */
function windowLine(g: Grid, snapshot: ContextBreakdownSnapshot, table: Table, largest: ContextBreakdownSegment | null, used: number, grid: number) {
  const { Box, Text } = g.el
  const label = `${snapshot.isEstimate ? '~' : ''}% of used`
  const room = grid - (g.share ? cellWidth(label) + 1 : 0) - (g.added ? g.cells.added + 1 : 0)
  const left = windowText({ mark: 0, lead: 0, name: Math.max(0, room), bar: 0, share: table.share }, snapshot, largest, used)

  return (
    <Box flexDirection="row" columnGap={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text dimColor>{left}</Text>
      </Box>
      {g.share && (
        <Box flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
      )}
      {g.added && (
        <Box width={g.cells.added} flexShrink={0} justifyContent="flex-end">
          <Text dimColor>{ADDED_NAME}</Text>
        </Box>
      )}
    </Box>
  )
}

function segmentsGrid(
  g: Grid,
  snapshot: ContextBreakdownSnapshot,
  columns: number,
  actions: PaneActions,
  palette: Palette,
  base: ContextBreakdownBase | null,
  grid: number,
) {
  const { Box, Svg, Text } = g.el
  const { deferred, shown, table, stats } = levelOne(snapshot, columns, base)
  const { used } = stats
  const largest = stats.largest?.tokens ?? 0
  const addedText = (tokens: number | undefined) => (tokens !== undefined && tokens > 0 ? `+${formatTokens(tokens)}` : null)
  const addedOf = (tokens: number | undefined): Figure => ({ text: addedText(tokens), dim: false })
  const groupAdded = (segments: readonly ContextBreakdownSegment[]) =>
    segments.reduce((sum, segment) => sum + (stats.added[segment.id] ?? 0), 0)
  // Each figure column is as wide as its widest text on the page: the
  // headings', the segments', Free space's, the Reserve's and Not loaded's;
  // and the column's name where it stands in the column ("added"). Each has
  // at least FIGURE_MIN_CELLS.
  const groups = [snapshot.baseline, snapshot.conversation]
  const drawn = groups.flatMap(segments => segments.filter(segment => segment.tokens > 0))
  const cells: FigureCells = {
    tokens: figureColumnCells([
      ...groups.map(segments => formatTokens(sumTokens(segments))),
      ...drawn.map(segment => formatTokens(segment.tokens)),
      formatTokens(freeTokens(snapshot)),
      formatTokens(snapshot.reserve),
      ...deferred.map(category => (category.tokens === null ? null : formatTokens(category.tokens))),
    ]),
    share: figureColumnCells([...groups.map(segments => formatShare(sumTokens(segments), used)), ...drawn.map(segment => formatShare(segment.tokens, used))]),
    added: figureColumnCells([ADDED_NAME, ...groups.map(segments => addedText(groupAdded(segments))), ...drawn.map(segment => addedText(stats.added[segment.id]))]),
  }
  // The column `added` shows where the terminal's table has it and where it
  // shortens no name: the grid's bar keeps its cells, so the column takes
  // its cells from the names.
  const without: Grid = { ...g, share: table.share, added: false, cells, bar: barCells(table, grid) }
  const namesIn = (room: number) => drawn.map(segment => fittedName(segmentDef(segment.id).label, segmentDef(segment.id).short, room))
  const withColumn: Grid = { ...without, added: true }
  const keepsNames =
    namesIn(grid - LEAD_CELLS - rightCells(withColumn)).join('\n') === namesIn(grid - LEAD_CELLS - rightCells(without)).join('\n')
  const rows: Grid = table.added === true && keepsNames ? withColumn : without
  // The cells a heading's text has, and a row's name after the lead.
  const headingRoom = grid - rightCells({ ...rows, bar: 0 })
  const nameRoom = grid - LEAD_CELLS - rightCells(rows)
  const plainRoom = grid - LEAD_CELLS - rightCells({ ...rows, bar: 0 })
  const heading = (title: string, long: string, segments: readonly ContextBreakdownSegment[]) => {
    const tokens = sumTokens(segments)
    const text = headingText(table, title, long).trimEnd()

    return gridRow(rows, [<Text dimColor wrap="truncate" maxLines={1}>{cellWidth(text) <= headingRoom ? text : title}</Text>], figures(
      rows,
      { text: formatTokens(tokens), dim: true },
      { text: formatShare(tokens, used), dim: true },
      { ...addedOf(groupAdded(segments)), dim: true },
    ))
  }
  const segmentRows = (segments: readonly ContextBreakdownSegment[]) =>
    segments
      .filter(segment => segment.tokens > 0)
      .map(segment => {
        const def = segmentDef(segment.id)
        const color = colorOf(palette, def.id)
        const name = fittedName(def.label, def.short, nameRoom)

        return gridRow(
          rows,
          [lead(rows, swatch(rows, color, segmentTexture(def.id))), nameButton(rows, `row-${segment.id}`, name, () => void actions.openSegment(segment.id))],
          [
            lengthBar(rows, segment.tokens, largest, color, `${def.label}: ${formatTokens(segment.tokens)}`),
            ...figures(rows, { text: formatTokens(segment.tokens), dim: false }, { text: formatShare(segment.tokens, used), dim: true }, addedOf(stats.added[segment.id])),
          ],
        )
      })
  // Free space and Reserve: a swatch in the bar's own texture, no length bar.
  const partRow = (name: string, tokens: number, color: string, texture: Texture) =>
    gridRow(rows, [lead(rows, swatch(rows, color, texture)), plainName(rows, name, true)], figures(rows, { text: formatTokens(tokens), dim: true }, NONE, NONE))
  // The bar on top: the segments in the rows' order, then free space, then the reserve.
  const parts: WindowPart[] = [
    ...shown.map(segment => ({ kind: 'segment' as const, color: colorOf(palette, segment.id), tokens: segment.tokens, texture: segmentTexture(segment.id) })),
    { kind: 'free', color: palette.free, tokens: freeTokens(snapshot), texture: 'dotted' },
    { kind: 'reserve', color: palette.reserve, tokens: snapshot.reserve, texture: 'shaded' },
  ]

  return (
    <Box flexDirection="column" width={grid}>
      {levelOneHeading(g.el as Ui, snapshot, columns)}
      <Box flexDirection="row" width={grid} marginTop={1} marginBottom={1}>
        <Svg
          source={windowBarPicture(parts, grid * MEASURED_CELL_PX)}
          alt={`Context window: ${headingLine(paneHeading(snapshot, columns))}`}
          height={SVG_BAR_HEIGHT}
        />
      </Box>
      {windowLine(rows, snapshot, table, stats.largest, used, grid)}
      <Box flexDirection="column" marginTop={1}>
        {heading('Baseline', BASELINE_HEADING, snapshot.baseline)}
        {segmentRows(snapshot.baseline)}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {heading('Conversation', CONVERSATION_HEADING, snapshot.conversation)}
        {segmentRows(snapshot.conversation)}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {partRow('Free space', freeTokens(snapshot), palette.free, 'dotted')}
        {partRow(cellWidth(RESERVE_NAME) <= plainRoom - 1 ? RESERVE_NAME : 'Reserve', snapshot.reserve, palette.reserve, 'shaded')}
      </Box>
      {deferred.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor wrap="truncate" maxLines={1}>
            {notLoadedHeading(table, 'Not loaded', NOT_LOADED_HEADING)}
          </Text>
          {deferred.map(category => {
            const name = withoutDeferred(category.name)
            const tokens: Figure = { text: category.tokens === null ? null : formatTokens(category.tokens), dim: category.servers.length === 0 }
            // One row stands for every server, and opens their list; the others open nothing.
            const named =
              category.servers.length > 0
                ? nameButton(
                    rows,
                    SERVERS_ROW,
                    // The longest form that fits the row's room: Not loaded rows have no length bar.
                    serversRowText({ ...table, name: Math.min(textCells(table), Math.max(1, plainRoom - BUTTON_PAD_CELLS)), bar: 0 }, name, category.servers).trimEnd(),
                    () => void actions.openSegment(NOT_LOADED),
                  )
                : plainName(rows, name, true)

            return gridRow(rows, [lead(rows, null), named], figures(rows, tokens, NONE, NONE))
          })}
        </Box>
      )}
      {notes(g.el, [
        ...(rows.added ? [addedNote(snapshot, stats.added)] : []),
        snapshot.isEstimate
          ? 'All numbers are estimates. ~: the conversation is counted from its characters until the first response after the compaction.'
          : 'All numbers are estimates.',
      ])}
    </Box>
  )
}

// Level 2.

/** The title row of level 2: the trail, the swatch, the name in bold; the figures at the grid's right edge. */
function titleRow(g: Grid, list: ContextBreakdownList, snapshot: ContextBreakdownSnapshot | null, tokens: number, columns: number, palette: Palette) {
  const { Box, Text } = g.el
  const segment = isSegmentList(list.segment) ? list.segment : null
  const def = segment === null ? null : segmentDef(segment)
  const used = snapshot === null ? null : usedTokens(snapshot)
  // The servers that are not loaded are in no segment: no swatch.
  // `tokens` is the category's figure where it has one (`segmentTotal`).
  // The forms the terminal picks for the pane's width, so the words stay the
  // same; the surface's face is narrower than its cells, and where the name
  // does not fit after all, the surface cuts it and the figures stay.
  const crumb =
    def === null
      ? serversCrumb(PANE_TITLE, NOT_LOADED_DEF.block, NOT_LOADED_DEF.label, tokens > 0 ? tokens : null, columns)
      : crumbFor(PANE_TITLE, def.label, def.short, tokens, used, snapshot?.isEstimate === true, columns)
  const trail = crumb.trail.trimEnd()

  return (
    <Box flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={1}>
      <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={1} minWidth={0}>
        {trail !== '' && (
          <Text dimColor wrap="truncate" maxLines={1}>
            {trail}
          </Text>
        )}
        {segment !== null && swatch(g, colorOf(palette, segment), segmentTexture(segment))}
        <Text weight="bold" wrap="truncate" maxLines={1}>
          {crumb.name}
        </Text>
      </Box>
      {crumb.figures !== '' && (
        <Box flexShrink={0}>
          <Text dimColor>{crumb.figures}</Text>
        </Box>
      )}
    </Box>
  )
}

/** The longest tail of a text that fits in `cells` cells; never splits a character. */
function tailCells(text: string, cells: number): string {
  const chars = [...text]
  let used = 0
  let start = chars.length
  while (start > 0 && used + cellWidth(chars[start - 1]!) <= cells) {
    used += cellWidth(chars[start - 1]!)
    start -= 1
  }

  return chars.slice(start).join('')
}

/**
 * A path in `cells`, at least 2: the mod's short form (`shortenPath`). Where
 * that form is still wider than its cells (wide characters), its head is cut
 * further. The end of the file name always stays, and the result is never
 * wider than its cells, as in the terminal's rows (`itemNames`).
 */
export function fittedPath(text: string, cells: number): string {
  const room = Math.max(2, cells)
  const short = shortenPath(text, room)
  if (cellWidth(short) <= room) {
    return short
  }

  return `…${tailCells(short.startsWith('…') ? short.slice(1) : short, room - 1)}`
}

/**
 * An item's title in a column `cells` wide, for a Button's label: a native
 * button does not shrink, so a title that does not fit is cut to fit. A path
 * takes its short form (`fittedPath`): its head is cut and the end of its
 * file name stays. Any other title is cut in its middle, so both ends of the
 * title stay. This usually keeps the labels of two tools of one server
 * apart, but a column of fewer than about 10 cells can still give two long
 * names the same label. Cells count a monospaced face: the surface's own
 * face is narrower for most text.
 */
export function fittedTitle(text: string, cells: number, isPath: boolean): string {
  if (cellWidth(text) <= cells) {
    return text
  }
  if (isPath) {
    return fittedPath(text, cells)
  }
  if (cells <= 2) {
    return fit(text, Math.max(1, cells)).trimEnd()
  }
  const headRoom = Math.max(1, Math.floor((cells - 1) / 3))

  return `${headCells(text, headRoom).trimEnd()}…${tailCells(text, cells - 1 - headRoom).trimStart()}`
}

/**
 * An item's dim detail in the `cells` the row leaves it. The desktop app and
 * the editor cut an over-long text at its end, whatever `wrap` says (a phone
 * cuts `truncate-middle` in its middle): a command loses its tail,
 * which is fine, but a path would lose its file name. So a path that does
 * not fit takes its short form (`fittedPath`): its head is cut and the end of
 * its file name stays. Any other detail is given in full.
 */
export function fittedDetail(text: string, cells: number, isPath: boolean): string {
  return isPath && cellWidth(text) > cells ? fittedPath(text, cells) : text
}

function listGrid(
  g: Grid,
  list: ContextBreakdownList,
  snapshot: ContextBreakdownSnapshot | null,
  actions: PaneActions,
  palette: Palette,
  grid: number,
  two: LevelTwo,
) {
  const { Box, Text } = g.el
  const { def, hasTokens, facts, table, largest, total, column, hidden, sizes, marksClosed } = two
  // The servers that are not loaded have no segment's colour: a neutral grey.
  const color = isSegmentList(list.segment) ? colorOf(palette, list.segment) : palette.notLoaded
  const cells: FigureCells = {
    tokens: figureColumnCells(list.rows.map(row => formatTokens(row.tokens))),
    share: figureColumnCells(list.rows.map(row => formatShare(row.tokens, total))),
    added: 1,
  }
  const rows: Grid = { ...g, share: hasTokens && table.share, added: false, cells, bar: hasTokens ? barCells(table, grid) : 0 }
  // The cells the figures and the bar take at a row's right, with their gaps.
  const right = hasTokens ? rightCells(rows) : 0
  const rowFigures = (row: ContextBreakdownRow) =>
    hasTokens ? figures(rows, { text: formatTokens(row.tokens), dim: false }, { text: formatShare(row.tokens, total), dim: true }, NONE) : []
  const alt = (row: ContextBreakdownRow) => `${row.detail === '' ? row.title : `${row.title} ${row.detail}`}: ${formatTokens(row.tokens)}`
  let body: unknown[]
  if (def === null) {
    // The servers: none opens. The name takes the room; the tool count has a
    // column of its own, as wide as its widest text and no wider: a gap and
    // the length bar follow it, so it needs no spare cell.
    const countCells = Math.max(0, ...list.rows.map(row => cellWidth(row.detail)))
    body = list.rows.map(row =>
      gridRow(
        rows,
        [
          <Box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0}>
            <Text wrap="truncate-middle">{row.title}</Text>
          </Box>,
        ],
        [
          <Box width={countCells} flexShrink={0} justifyContent="flex-end">
            <Text dimColor tabular>
              {row.detail}
            </Text>
          </Box>,
          hasTokens ? lengthBar(rows, row.tokens, largest, color, `${row.title}: ${formatTokens(row.tokens)}`) : null,
          ...rowFigures(row),
        ],
      ),
    )
  } else {
    // The title's column is as wide as the longest title of a row with a
    // detail on the page, and BUTTON_PAD_CELLS for the button's padding: a
    // native button does not shrink. It stops short of DETAIL_MIN_CELLS for
    // the details, but where that leaves the title less than half of the
    // cells that the title and the detail share, the title takes that half:
    // in a narrow pane a title of three letters says nothing. The detail
    // takes the rest. A row with no detail gives its title the detail's room
    // too.
    const room = Math.max(1, grid - right - 1)
    const shared = room - BUTTON_PAD_CELLS - 1
    const cap = Math.max(4, shared - DETAIL_MIN_CELLS, Math.floor(shared / 2))
    const detailed = list.rows.filter(row => row.detail !== '')
    const titleCells = Math.min(cap, Math.max(1, ...detailed.map(row => cellWidth(row.title))))
    const detailCells = Math.max(1, room - (titleCells + BUTTON_PAD_CELLS) - 1)
    body = list.rows.map(row => {
      const key = `item-${row.id}`
      const hasDetail = row.detail !== ''
      const title = fittedTitle(row.title, hasDetail ? titleCells : room - BUTTON_PAD_CELLS, row.pathIn === 'title')
      // A row that does not open has a dim title, as a line that is not a
      // control, while other rows on the page open (`marksClosed`).
      const named = row.isOpenable ? (
        rowButton(rows, key, title, () => void actions.openItem(row.id))
      ) : (
        <Text wrap="truncate" maxLines={1} {...(marksClosed ? { dimColor: true } : {})}>
          {title}
        </Text>
      )

      return gridRow(
        rows,
        [
          hasDetail ? (
            <Box width={titleCells + BUTTON_PAD_CELLS} flexShrink={0} flexDirection="row" {...(row.isOpenable ? {} : { paddingLeft: LABEL_PAD_CELLS })}>
              {named}
            </Box>
          ) : (
            <Box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0} {...(row.isOpenable ? {} : { paddingLeft: LABEL_PAD_CELLS })}>
              {named}
            </Box>
          ),
          row.detail !== '' && (
            <Box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0} marginLeft={1}>
              <Text dimColor wrap="truncate-middle">
                {fittedDetail(row.detail, detailCells, row.pathIn === 'detail')}
              </Text>
            </Box>
          ),
        ],
        [lengthBar(rows, row.tokens, largest, color, alt(row)), ...rowFigures(row)],
      )
    })
  }

  const below = [...(hidden === null ? [] : [hidden]), ...(sizes === null ? [] : [sizes])]

  // The facts and the column's name share a line: the name ends where the
  // share column ends, and the facts give way where the line is short.
  return [
    <Box flexDirection="column" marginTop={1} width={grid}>
      {column === null ? (
        <Text dimColor>{facts}</Text>
      ) : (
        <Box flexDirection="row" columnGap={1}>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text dimColor>{facts}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text dimColor>{column}</Text>
          </Box>
        </Box>
      )}
      {list.note !== null && (
        <Text dimColor wrap="wrap">
          {list.note}
        </Text>
      )}
      {body as RenderElement[]}
    </Box>,
    below.length > 0 && (
      <Box flexDirection="column" marginTop={1} width={grid}>
        {below.map(text => (
          <Text dimColor wrap="wrap">
            {text}
          </Text>
        ))}
      </Box>
    ),
  ]
}

// The controls.

/**
 * The row of controls: the hint while the pane does not hold the keys
 * (unless `hint` is false), then the groups of `keyGroups`, which break
 * between them. Each control is a
 * native button that shows its label and, while the pane offers its keys
 * (`showsKeys`), its hotkey as a key cap; one that does not apply is dim. The
 * words name Enter alone: rows carry no digit here.
 */
function controlsRow(
  el: GridUi,
  view: ContextBreakdownView,
  openRows: number,
  columns: number,
  isFocused: boolean,
  surface: RenderSurface,
  actions: PaneActions,
  ring: string | null,
  gap: number,
  hint = true,
) {
  const { Box, Button, Text } = el
  const shows = showsKeys(isFocused, surface)
  const line = keyGroups(view, actions, isFocused, surface, openRows, columns)
  const words = view.level !== 3 && shows && openRows > 0 ? [OPEN_WORDS] : []
  const button = (control: Control) => {
    const props = {
      key: control.key,
      label: control.label,
      plain: true as const,
      ...(shows ? { hotkey: control.hotkey } : {}),
      ...(control.key === 'close' ? { role: 'dismiss' as const } : {}),
      ...(ring === control.key ? { autoFocus: true as const } : {}),
      onPress: (press: { surface: RenderSurface }) => void control.onPress(press.surface),
    }

    return control.isOn ? <Button {...props} /> : <Button {...props} dimColor />
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {hint && !isFocused && (
        <Text dimColor wrap="wrap">
          {keysHint(surface)}
        </Text>
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={gap}>
        {line.groups.map(group => (
          <Box flexDirection="row" flexWrap="wrap" columnGap={gap}>
            {/* The words start where a Button's label starts, so a second line, which starts with a Button, shares their left edge. */}
            {(group.key === 'move' ? words : group.words).map(text => (
              <Box paddingLeft={LABEL_PAD_CELLS}>
                <Text dimColor>{text}</Text>
              </Box>
            ))}
            {group.controls.map(button)}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/**
 * The pane's tree on a surface other than the terminal, `columns` wide; the
 * arguments are `paneTree`'s. Level 1: the heading, the bar, the window line,
 * the rows, the notes, then the controls. Level 2: the title row, the
 * definition, the controls, then the facts line with the column's name, the
 * rows and the notes; the hint comes last there, so the rows keep their place
 * when the pane gains or loses the keys. Level 3: as on the terminal, with a
 * swatch before the title.
 */
export function gridTree(
  ui: Ui,
  snapshot: ContextBreakdownSnapshot | null,
  view: ContextBreakdownView,
  columns: number,
  actions: PaneActions,
  palette: Palette,
  isFocused: boolean,
  surface: RenderSurface,
  keepsPlace = false,
  base: ContextBreakdownBase | null = null,
): RenderElement {
  const el = ui as GridUi
  const { Box, Text } = el
  const ring = keepsPlace ? null : ringKey(view, snapshot, isFocused, surface)
  const grid = gridCells(columns)
  const g: Grid = { el, share: false, added: false, cells: NO_CELLS, bar: 0, ring }
  if (view.level === 3) {
    const keys = controlsRow(el, view, 0, columns, isFocused, surface, actions, ring, 2)
    const segment = view.list.segment
    // The form of level 2's title row: the dim trail, the swatch, the name.
    const crumb = contentListCrumb(segment, view.item.title, columns)
    const trail = crumb.trail.trimEnd()
    const title = (
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        {trail !== '' && (
          <Box flexShrink={0}>
            <Text dimColor>{trail}</Text>
          </Box>
        )}
        {swatch(g, isSegmentList(segment) ? colorOf(palette, segment) : palette.notLoaded, isSegmentList(segment) ? segmentTexture(segment) : null)}
        <Box flexShrink={1} minWidth={0}>
          <Text weight="bold" wrap="wrap">{`${crumb.name} › ${view.item.title}`}</Text>
        </Box>
      </Box>
    )

    return contentBody(ui, title, view.item, placeFact(view), keys, actions, ring)
  }
  if (view.level === 2) {
    const { list } = view
    const def = isSegmentList(list.segment) ? segmentDef(list.segment) : null
    const openRows = list.rows.filter(row => row.isOpenable).length
    const two = levelTwo(list, snapshot, columns)

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" width={grid}>
          {titleRow(g, list, snapshot, two.total, columns, palette)}
          {/* What the list holds. */}
          <Text dimColor wrap="wrap">
            {sentence(def === null ? NOT_LOADED_DEF.definition : def.definition)}
          </Text>
        </Box>
        {controlsRow(el, view, openRows, columns, isFocused, surface, actions, ring, 1, false)}
        {listGrid(g, list, snapshot, actions, palette, grid, two)}
        {!isFocused && (
          <Box flexDirection="column" marginTop={1} width={grid}>
            <Text dimColor wrap="wrap">
              {keysHint(surface)}
            </Text>
          </Box>
        )}
      </Box>
    )
  }
  // Before the first measurement a waiting line stands in the grid's place.
  const body =
    snapshot === null ? (
      <Box flexDirection="column" width={grid}>
        <Text dimColor>Measuring the context window…</Text>
      </Box>
    ) : (
      segmentsGrid(g, snapshot, columns, actions, palette, base, grid)
    )

  return (
    <Box flexDirection="column">
      {snapshot !== null && view.note !== undefined && (
        <Text dimColor wrap="wrap">
          {view.note}
        </Text>
      )}
      {body}
      {controlsRow(el, view, snapshot === null ? 0 : levelOneLists(snapshot).length, columns, isFocused, surface, actions, ring, 2)}
    </Box>
  )
}
