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
  ADDED_NOTE,
  BASELINE_HEADING,
  CONVERSATION_HEADING,
  NOT_LOADED_HEADING,
  RESERVE_NAME,
  SERVERS_ROW,
  contentBody,
  contentListName,
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
import type { Control, PaneActions } from './pane'
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
import { ADDED_NAME, crumbFor, headingText, nameText, notLoadedHeading, serversCrumb, serversRowText, windowText } from './table'
import type { Table } from './table'
import { cellWidth, shortenPath } from './text'
import { fit, headingLine, paneHeading } from './view'

/** The widest the grid grows, in cells: in a wider pane it does not stretch. */
export const GRID_MAX_CELLS = 64
/** The lead before a level 1 row's name: holds the swatch. */
export const LEAD_CELLS = 2
/** A figure's column: tokens ("406k"), share ("<0.1%"), added ("+2.5k"). */
export const FIGURE_CELLS = 5
/** The length bar's column: in a grid at its widest, and in a narrower one. */
export const BAR_CELLS = 8
export const BAR_NARROW_CELLS = 5
/**
 * The padding a native button draws before its label, 6 CSS pixels, in
 * cells: a name that is a Text starts after it, where a Button's label
 * starts. The one fractional cell in the grid.
 */
export const LABEL_PAD_CELLS = Math.round((6 / MEASURED_CELL_PX) * 10000) / 10000
/** The fewest cells an item's detail keeps at level 2: the title's column stops short of them. */
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

/** The grid's width for a pane `columns` wide: one spare cell each side, at most GRID_MAX_CELLS. */
export function gridCells(columns: number): number {
  return Math.max(1, Math.min(GRID_MAX_CELLS, Math.floor(columns) - 2))
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
  /** The length bar's cells, 0 for none. */
  bar: number
  /** The key of the element that takes the focus ring (`ringKey`). */
  ring: string | null
}

function figureBox(g: Grid, figure: Figure) {
  const { Box, Text } = g.el

  return (
    <Box width={FIGURE_CELLS} flexShrink={0} justifyContent="flex-end">
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
  return [figureBox(g, tokens), g.share ? figureBox(g, share) : null, g.added ? figureBox(g, added) : null]
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

/** A name that does not open: a Text that starts where a Button's label starts. */
function plainName(g: Grid, name: string, dim: boolean) {
  const { Box, Text } = g.el

  return (
    <Box flexDirection="row" paddingLeft={LABEL_PAD_CELLS}>
      <Text {...(dim ? { dimColor: true } : {})}>{name}</Text>
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
  const room = grid - (g.share ? cellWidth(label) + 1 : 0) - (g.added ? FIGURE_CELLS + 1 : 0)
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
        <Box width={FIGURE_CELLS} flexShrink={0} justifyContent="flex-end">
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
  const rows: Grid = { ...g, share: table.share, added: table.added === true, bar: barCells(table, grid) }
  const { used } = stats
  const largest = stats.largest?.tokens ?? 0
  const addedOf = (tokens: number | undefined): Figure => ({ text: tokens !== undefined && tokens > 0 ? `+${formatTokens(tokens)}` : null, dim: false })
  const groupAdded = (segments: readonly ContextBreakdownSegment[]) =>
    segments.reduce((sum, segment) => sum + (stats.added[segment.id] ?? 0), 0)
  const heading = (title: string, long: string, segments: readonly ContextBreakdownSegment[]) => {
    const tokens = sumTokens(segments)

    return gridRow(rows, [<Text dimColor>{headingText(table, title, long).trimEnd()}</Text>], figures(
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
        const name = nameText(table, def.label, def.short).trimEnd()

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
        {partRow(cellWidth(RESERVE_NAME) <= table.name ? RESERVE_NAME : 'Reserve', snapshot.reserve, palette.reserve, 'shaded')}
      </Box>
      {deferred.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{notLoadedHeading(table, 'Not loaded', NOT_LOADED_HEADING)}</Text>
          {deferred.map(category => {
            const name = withoutDeferred(category.name)
            const tokens: Figure = { text: category.tokens === null ? null : formatTokens(category.tokens), dim: category.servers.length === 0 }
            // One row stands for every server, and opens their list; the others open nothing.
            const named =
              category.servers.length > 0
                ? nameButton(rows, SERVERS_ROW, serversRowText(table, name, category.servers).trimEnd(), () => void actions.openSegment(NOT_LOADED))
                : plainName(rows, name, true)

            return gridRow(rows, [lead(rows, null), named], figures(rows, tokens, NONE, NONE))
          })}
        </Box>
      )}
      {notes(g.el, [
        ...(table.added === true ? [ADDED_NOTE] : []),
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
        {trail !== '' && <Text dimColor>{trail}</Text>}
        {segment !== null && swatch(g, colorOf(palette, segment), segmentTexture(segment))}
        <Text weight="bold">{crumb.name}</Text>
      </Box>
      {crumb.figures !== '' && <Text dimColor>{crumb.figures}</Text>}
    </Box>
  )
}

/**
 * An item's title in a column `cells` wide, for a Button's label: a native
 * button does not shrink, so a title that does not fit is cut to fit with an
 * ellipsis, or, for a path, takes the mod's short form (`shortenPath`), which
 * keeps the file name. Cells count a monospaced face: the surface's own face
 * is narrower for most text.
 */
export function fittedTitle(text: string, cells: number, isPath: boolean): string {
  if (cellWidth(text) <= cells) {
    return text
  }

  return isPath ? shortenPath(text, Math.max(2, cells)) : fit(text, Math.max(1, cells)).trimEnd()
}

/**
 * An item's dim detail in the `cells` the row leaves it. The surface cuts an
 * over-long text at its end, whatever `wrap` says: a command loses its tail,
 * which is fine, but a path would lose its file name. So a path that does
 * not fit takes the mod's short form (`shortenPath`); any other detail is
 * given in full.
 */
export function fittedDetail(text: string, cells: number, isPath: boolean): string {
  return isPath && cellWidth(text) > cells ? shortenPath(text, Math.max(2, cells)) : text
}

function listGrid(
  g: Grid,
  list: ContextBreakdownList,
  snapshot: ContextBreakdownSnapshot | null,
  columns: number,
  actions: PaneActions,
  palette: Palette,
  grid: number,
) {
  const { Box, Text } = g.el
  const { def, hasTokens, facts, table, largest, total, column, hidden, sizes, marksClosed } = levelTwo(list, snapshot, columns)
  // The servers that are not loaded have no segment's colour: a neutral grey.
  const color = isSegmentList(list.segment) ? colorOf(palette, list.segment) : palette.notLoaded
  const rows: Grid = { ...g, share: hasTokens && table.share, added: false, bar: hasTokens ? barCells(table, grid) : 0 }
  // The cells the figures and the bar take at a row's right, with their gaps.
  const right = (rows.bar > 0 ? rows.bar + 1 : 0) + (hasTokens ? FIGURE_CELLS + 1 : 0) + (rows.share ? FIGURE_CELLS + 1 : 0)
  const rowFigures = (row: ContextBreakdownRow) =>
    hasTokens ? figures(rows, { text: formatTokens(row.tokens), dim: false }, { text: formatShare(row.tokens, total), dim: true }, NONE) : []
  const alt = (row: ContextBreakdownRow) => `${row.detail === '' ? row.title : `${row.title} ${row.detail}`}: ${formatTokens(row.tokens)}`
  let body: unknown[]
  if (def === null) {
    // The servers: none opens. The name takes the room; the tool count has a column of its own.
    const countCells = Math.max(1, ...list.rows.map(row => cellWidth(row.detail)))
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
    // detail on the page, and a cell for the button's padding: a native
    // button does not shrink. It stops short of DETAIL_MIN_CELLS for the
    // details. A row with no detail gives its title the detail's room too.
    const room = Math.max(1, grid - right - 1)
    const cap = Math.max(4, room - 1 - DETAIL_MIN_CELLS)
    const detailed = list.rows.filter(row => row.detail !== '')
    const titleCells = Math.min(cap, Math.max(1, ...detailed.map(row => cellWidth(row.title))))
    const detailCells = Math.max(1, room - (titleCells + 1) - 1)
    body = list.rows.map(row => {
      const key = `item-${row.id}`
      const hasDetail = row.detail !== ''
      const title = fittedTitle(row.title, hasDetail ? titleCells : room - 1, row.pathIn === 'title')
      // A row that does not open has a dim title, as a line that is not a
      // control, while other rows on the page open (`marksClosed`).
      const named = row.isOpenable ? (
        rowButton(rows, key, title, () => void actions.openItem(row.id))
      ) : (
        <Text {...(marksClosed ? { dimColor: true } : {})}>{title}</Text>
      )

      return gridRow(
        rows,
        [
          hasDetail ? (
            <Box width={titleCells + 1} flexShrink={0} flexDirection="row" {...(row.isOpenable ? {} : { paddingLeft: LABEL_PAD_CELLS })}>
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
            {(group.key === 'move' ? words : group.words).map(text => (
              <Text dimColor>{text}</Text>
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
  const g: Grid = { el, share: false, added: false, bar: 0, ring }
  if (view.level === 3) {
    const keys = controlsRow(el, view, 0, columns, isFocused, surface, actions, ring, 2)
    const segment = view.list.segment
    const title = (
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        {swatch(g, isSegmentList(segment) ? colorOf(palette, segment) : palette.notLoaded, isSegmentList(segment) ? segmentTexture(segment) : null)}
        <Text weight="bold" wrap="wrap">{`${contentListName(segment)} › ${view.item.title}`}</Text>
      </Box>
    )

    return contentBody(ui, title, view.item, placeFact(view), keys, actions, ring)
  }
  if (view.level === 2) {
    const { list } = view
    const def = isSegmentList(list.segment) ? segmentDef(list.segment) : null
    const openRows = list.rows.filter(row => row.isOpenable).length

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" width={grid}>
          {titleRow(g, list, snapshot, levelTwo(list, snapshot, columns).total, columns, palette)}
          {/* What the list holds. */}
          <Text dimColor wrap="wrap">
            {sentence(def === null ? NOT_LOADED_DEF.definition : def.definition)}
          </Text>
        </Box>
        {controlsRow(el, view, openRows, columns, isFocused, surface, actions, ring, 1, false)}
        {listGrid(g, list, snapshot, columns, actions, palette, grid)}
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
