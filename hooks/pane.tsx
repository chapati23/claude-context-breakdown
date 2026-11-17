// The pane: the segments (level 1), the items of one segment (level 2) and
// the text of one item (level 3). It draws from state alone; each press
// hands the move to an action.

import type { RenderElement, RenderSurface } from 'claude-code'

import type {
  ContextBreakdownContent,
  ContextBreakdownList,
  ContextBreakdownSegment,
  ContextBreakdownSegmentId,
  ContextBreakdownServer,
  ContextBreakdownSnapshot,
  ContextBreakdownView,
} from '../types'
import type { Ui } from './band'
import { FILLED, FREE, RESERVE } from './bar'
import { baselineOf } from './categories'
import { formatTokens } from './format'
import { colorOf } from './palette'
import type { Palette } from './palette'
import { LIST_DOWN, LIST_UP, SCROLL_DOWN, SCROLL_UP } from './scroll'
import { segmentDef } from './segments'
import { freeTokens, sumTokens, usedTokens } from './snapshot'
import { PANE_TITLE } from './state'
import {
  SWATCH,
  columnHeader,
  crumbFor,
  figuresText,
  itemNames,
  largestOf,
  lengthBarParts,
  lineFacts,
  listFacts,
  nameText,
  notLoadedRows,
  serverTexts,
  showsHotkeys,
  tableLayout,
} from './table'
import type { LengthBarParts, Table } from './table'
import { cellWidth, codeRuns } from './text'
import { paneHeading } from './view'

export type PaneActions = {
  close: () => unknown
  refresh: () => unknown
  openSegment: (id: ContextBreakdownSegmentId) => unknown
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
}

// Every part of a table row is a Text drawn `mono`: the columns line up only
// cell for cell, and a surface other than the terminal draws text in a face
// that is not monospaced unless asked. The figures are also `tabular`.

/** Blank cells that hold a column's place. */
function gap(rows: Rows, cells: number) {
  const { Text } = rows.el

  return cells > 0 ? <Text mono>{' '.repeat(cells)}</Text> : ''
}

/**
 * The mark before a row: "1" to "9" for the first nine rows. With the
 * keyboard the Button draws it from its `hotkey`; without, the row draws it
 * dim, as a hotkey that does not work yet, and gets no `hotkey`. A row with
 * no mark is indented by as much, so the rows line up.
 */
function markOf(rows: Rows, index: number): { hotkey?: string; mark: RenderElement | string } {
  if (rows.table.mark === 0) {
    return { mark: '' }
  }
  const digit = index < 9 ? String(index + 1) : undefined
  if (digit === undefined) {
    return { mark: gap(rows, rows.table.mark) }
  }
  if (rows.isFocused) {
    return { hotkey: digit, mark: '' }
  }
  const { Text } = rows.el

  return {
    mark: (
      <Text mono dimColor>
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
 * takes the row's highlight, not the segment's colour. The one eighth block
 * cannot be stable: inverted it shows the rest of its cell instead.
 */
function barPart(rows: Rows, color: string, bar: LengthBarParts) {
  const { Text } = rows.el
  if (rows.table.bar === 0) {
    return ''
  }
  const runs: (RenderElement | string)[] = [gap(rows, 1)]
  if (bar.full !== '') {
    // The texture keeps the background showing through it.
    const back = bar.full.startsWith(FILLED) ? { backgroundColor: color } : {}
    runs.push(
      <Text mono color={color} {...back}>
        {bar.full}
      </Text>,
    )
  }
  if (bar.rest !== '') {
    runs.push(
      <Text mono color={color}>
        {bar.rest}
      </Text>,
    )
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

/** A row's figures, dim. */
function figuresPart(rows: Rows, tokens: number, of: number | null) {
  const { Text } = rows.el

  return (
    <Text mono tabular dimColor>
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
  const lead = glyph === null ? ' '.repeat(table.lead) : leadPart(rows, glyph.color, glyph.text)
  const bar = glyph === null ? null : { full: '', rest: glyph.text, pad: ' '.repeat(Math.max(0, table.bar - cellWidth(glyph.text))) }

  return (
    <Text mono dimColor>
      {' '.repeat(table.mark)}
      {lead}
      {nameText(table, name)}
      {glyph === null || bar === null ? (table.bar > 0 ? ` ${' '.repeat(table.bar)}` : '') : barPart(rows, glyph.color, bar)}
      <Text mono tabular>
        {!hasFigure ? '' : of === null ? figuresText(table, tokens, of).trimEnd() : figuresText(table, tokens, of)}
      </Text>
    </Text>
  )
}

/**
 * The server rows under MCP tools in Not loaded: plain lines, no Button, so
 * they take no focus. `hasTokens` false: the engine gave no figure for any
 * of them, so the token cell stays empty rather than saying 0.
 */
function serverLines(rows: Rows, servers: readonly ContextBreakdownServer[], hasTokens: boolean) {
  const { Text } = rows.el
  const { table } = rows
  const texts = serverTexts(table, servers)

  return servers.map((server, index) => (
    <Text mono dimColor>
      {' '.repeat(table.mark)}
      {texts[index] ?? ''}
      <Text mono tabular>
        {hasTokens ? figuresText(table, server.tokens, null).trimEnd() : ''}
      </Text>
    </Text>
  ))
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
      const { hotkey, mark } = markOf(rows, first + index)
      const name = nameText(table, def.label, def.short)
      const isLargest = stats.largest?.id === segment.id
      const bar = lengthBarParts(segment.tokens, stats.largest?.tokens ?? 0, table.bar, segment.id)

      return (
        <Button
          key={`row-${segment.id}`}
          label={def.label}
          plain
          {...(hotkey === undefined ? {} : { hotkey })}
          {...(rows.ring === `row-${segment.id}` ? { autoFocus: true as const } : {})}
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
          {barPart(rows, color, bar)}
          {figuresPart(rows, segment.tokens, stats.used)}
        </Button>
      )
    })
}

/** Group headings are dim: their subtotals must not outweigh the largest row. */
function groupHeading(rows: Rows, title: string, tokens: number, used: number) {
  return plainRow(rows, title, tokens, used, null)
}

/** The deferred category names say "(deferred)"; the heading says "Not loaded". */
export function withoutDeferred(name: string): string {
  return name.replace(/\s*\(deferred\)\s*$/i, '') || name
}

function segmentsBody(
  el: Ui,
  snapshot: ContextBreakdownSnapshot,
  columns: number,
  isFocused: boolean,
  actions: PaneActions,
  palette: Palette,
  ring: string | null,
) {
  const { Box, Text } = el
  const servers = snapshot.notLoadedServers
  const hasServerTokens = servers.some(server => server.tokens > 0)
  const deferred = notLoadedRows(snapshot.deferred, servers, name => baselineOf(name) === 'mcp')
  const shown = [...snapshot.baseline, ...snapshot.conversation].filter(segment => segment.tokens > 0)
  const baselineRows = snapshot.baseline.filter(segment => segment.tokens > 0).length
  // Server names stay out: they are cut to the table, never widen it.
  const names = [
    ...shown.map(segment => segmentDef(segment.id).label),
    'Baseline',
    'Conversation',
    'Free space',
    'Reserve',
    ...deferred.map(category => withoutDeferred(category.name)),
  ]
  const table = tableLayout(columns, Math.max(...names.map(cellWidth)))
  const rows: Rows = { el, table, isFocused, palette, ring }
  const used = usedTokens(snapshot)
  const stats = { used, largest: largestOf(shown) }
  const mark = snapshot.isEstimate ? '~' : ''

  return (
    <Box flexDirection="column">
      <Text weight="bold">{paneHeading(snapshot, columns)}</Text>
      <Text mono dimColor>
        {' '.repeat(table.mark)}
        {columnHeader(table, `${formatTokens(snapshot.window)} window`, `${mark}% of used`)}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {groupHeading(rows, 'Baseline', sumTokens(snapshot.baseline), used)}
        {groupRows(rows, snapshot.baseline, 0, stats, actions)}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {groupHeading(rows, 'Conversation', sumTokens(snapshot.conversation), used)}
        {groupRows(rows, snapshot.conversation, baselineRows, stats, actions)}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {plainRow(rows, 'Free space', freeTokens(snapshot), null, { text: FREE.repeat(2), color: palette.free })}
        {plainRow(rows, 'Reserve', snapshot.reserve, null, { text: RESERVE.repeat(2), color: palette.reserve })}
      </Box>
      {deferred.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text mono dimColor>
            {' '.repeat(table.mark + table.lead)}
            {'Not loaded'}
          </Text>
          {deferred.map(category => [
            category.tokens === null
              ? plainRow(rows, withoutDeferred(category.name), 0, null, null, false)
              : plainRow(rows, withoutDeferred(category.name), category.tokens, null, null),
            ...serverLines(rows, category.servers, hasServerTokens),
          ])}
          {servers.length > 0 && (
            <Text dimColor wrap="wrap">
              {hasServerTokens
                ? 'Per MCP server: the tools not loaded yet, and the tokens their schemas take once loaded.'
                : 'Per MCP server: the tools not loaded yet. Claude Code gives no token figure for them.'}
            </Text>
          )}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor wrap="wrap">
          {snapshot.isEstimate
            ? 'All numbers are estimates. ~: the conversation is counted from its characters until the first response after the compaction.'
            : 'All numbers are estimates.'}
        </Text>
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
 */
export function segmentTotal(list: ContextBreakdownList, snapshot: ContextBreakdownSnapshot | null): number {
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

function listBody(
  el: Ui,
  list: ContextBreakdownList,
  snapshot: ContextBreakdownSnapshot | null,
  columns: number,
  isFocused: boolean,
  actions: PaneActions,
  palette: Palette,
  ring: string | null,
) {
  const { Box, Button, Text } = el
  const def = segmentDef(list.segment)
  const color = colorOf(palette, list.segment)
  const order = list.canSort ? (list.sort === 'size' ? 'largest first' : 'newest first') : null
  const facts = listFacts(plural(list.items, 'item'), order, list.page, list.pages, columns)
  const widest = Math.max(1, ...list.rows.map(row => cellWidth(row.detail === '' ? row.title : `${row.title}  ${row.detail}`)))
  // No swatch: every row has the segment's colour, which the breadcrumb shows once.
  const table = tableLayout(columns, widest, false)
  const rows: Rows = { el, table, isFocused, palette, ring }
  // Scaled to the largest item on this page, as level 1 to its largest row.
  const largest = largestOf(list.rows)?.tokens ?? 0
  // Shares of the figure the breadcrumb shows, so "% of segment" means it.
  const total = segmentTotal(list, snapshot)
  let openable = 0

  return (
    <Box flexDirection="column">
      {crumbLine(el, list, snapshot, total, columns, palette)}
      <Text dimColor>{facts}</Text>
      {list.note !== null && (
        <Text dimColor wrap="wrap">
          {list.note}
        </Text>
      )}
      {list.rows.length > 0 && table.share && (
        <Text mono dimColor>
          {' '.repeat(table.mark)}
          {columnHeader(table, '', '% of segment')}
        </Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        {list.rows.map(row => {
          const index = row.isOpenable ? openable++ : null
          const { hotkey, mark } = index === null ? { mark: gap(rows, table.mark) } : markOf(rows, index)
          const names = itemNames(table, row.title, row.detail, row.pathIn)
          const inner = [
            mark,
            <Text mono>{names.title}</Text>,
            <Text mono dimColor>
              {names.detail}
            </Text>,
            barPart(rows, color, lengthBarParts(row.tokens, largest, table.bar)),
            figuresPart(rows, row.tokens, total),
          ]
          if (index === null) {
            return <Text mono>{inner}</Text>
          }

          return (
            <Button
              key={`item-${row.id}`}
              label={row.title}
              plain
              {...(hotkey === undefined ? {} : { hotkey })}
              {...(ring === `item-${row.id}` ? { autoFocus: true as const } : {})}
              onPress={() => void actions.openItem(row.id)}
            >
              {inner}
            </Button>
          )
        })}
      </Box>
      {list.hiddenItems > 0 && (
        <Text dimColor wrap="wrap">
          {`${plural(list.hiddenItems, 'more item')}, ${formatTokens(list.hiddenTokens)}, on other pages`}
        </Text>
      )}
      {def.group === 'conversation' && list.items > 0 && (
        <Text dimColor wrap="wrap">
          Sizes are estimated from each item’s characters.
        </Text>
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
  segment: ContextBreakdownSegmentId,
  item: ContextBreakdownContent,
  palette: Palette,
  keys: RenderElement,
  actions: PaneActions,
  ring: string | null,
) {
  const { Box, Button, Code, Markdown, Text } = el
  const def = segmentDef(segment)
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
        <Text color={colorOf(palette, segment)}>██</Text> {def.short} › {item.title}
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
 * One control. `isOn` false: it does not apply now (no next page, no file),
 * so it is drawn dimmer and its press does nothing. It stays in the line all
 * the same: a key with no control would go to the prompt and take the
 * keyboard from the pane, and the line keeps one order.
 */
type Control = { key: string; label: string; hotkey: string; isOn: boolean; onPress: (surface: RenderSurface) => unknown }

/** The key of j's Button: level 3's own, so no other level's tree holds it (scroll.ts). */
function downKey(view: ContextBreakdownView): string {
  return view.level === 3 ? SCROLL_DOWN : LIST_DOWN
}

function controls(view: ContextBreakdownView, actions: PaneActions, isFocused: boolean): Control[] {
  const out: Control[] = []
  const add = (key: string, label: string, hotkey: string, isOn: boolean, onPress: Control['onPress']) =>
    out.push({ key, label, hotkey, isOn, onPress: isOn ? onPress : () => undefined })
  // j and k only with the keyboard: a click moves one row, which the wheel
  // does better. The register's `ui.press` hook does the scroll (scroll.ts
  // says why), so the Buttons' own presses do nothing.
  if (isFocused) {
    add(downKey(view), 'Down', 'j', true, () => undefined)
    add(view.level === 3 ? SCROLL_UP : LIST_UP, 'Up', 'k', true, () => undefined)
  }
  // b at level 1 too: a reflex press there must not leave the pane.
  add('back', 'Back', 'b', view.level !== 1, actions.back)
  if (view.level === 2) {
    const { list } = view
    // Names the order it switches to; the facts line names the one shown.
    add('sort', list.sort === 'size' ? 'Sort by time' : 'Sort by size', 's', list.canSort, actions.toggleSort)
    add('prev', 'Previous page', 'p', list.page > 0, () => actions.listPage(-1))
    add('next', 'Next page', 'n', list.page + 1 < list.pages, () => actions.listPage(1))
  }
  if (view.level === 3) {
    const { item } = view
    add('prev', 'Previous page', 'p', item.page > 0, () => actions.contentPage(-1))
    add('next', 'Next page', 'n', item.page + 1 < item.pages, () => actions.contentPage(1))
    // Names the view it switches to; the facts line names the one shown. The
    // register's `ui.press` hook switches, as for j and k: it scrolls the
    // window to the same place, which only a hook's scroll can do.
    add('format', item.format === 'formatted' ? 'Raw text' : 'Formatted', 'f', true, () => undefined)
    add('view', item.source === 'loaded' ? 'On disk' : 'As loaded', 'v', item.canToggle, actions.toggleSource)
    // Off without a path, so the empty path is never used.
    const path = item.path ?? ''
    add('copy', 'Copy path', 'c', item.path !== null, surface => actions.copy(path, surface))
    add('mention', 'Mention', 'm', item.path !== null, () => actions.mention(path))
  }
  add('close', 'Close', 'x', true, actions.close)
  add('refresh', 'Refresh', 'r', true, actions.refresh)

  return out
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
 * The words before the controls, with the keyboard: Tab walks the rows (the
 * arrows scroll a pane) and Enter or a digit opens one. Without it, none:
 * the hint stands on its own line, and the controls keep only their labels,
 * so a click still works and no key is offered that would go to the prompt.
 */
export function keyWords(hasRows: boolean, columns: number, isFocused: boolean): string[] {
  if (!isFocused || !hasRows) {
    return []
  }

  return ['tab: Move', showsHotkeys(columns) ? '⏎ or 1-9: Open' : '⏎: Open']
}

/**
 * The key of the element that takes the focus ring when a tree is drawn: the
 * row b came back from when it is shown, else the first row; at level 3 the
 * first control, or the control under the text when k crossed back into the
 * page. Null when the tree has no such element.
 */
export function ringKey(view: ContextBreakdownView, snapshot: ContextBreakdownSnapshot | null, isFocused: boolean): string | null {
  const firstControl = isFocused ? downKey(view) : 'back'
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
  const ids = [...snapshot.baseline, ...snapshot.conversation].filter(segment => segment.tokens > 0).map(segment => segment.id)
  const id = view.from !== undefined && ids.includes(view.from) ? view.from : ids[0]

  return id === undefined ? firstControl : `row-${id}`
}

function keysLine(
  el: Ui,
  view: ContextBreakdownView,
  hasRows: boolean,
  columns: number,
  isFocused: boolean,
  surface: RenderSurface,
  actions: PaneActions,
  ring: string | null,
) {
  const { Box, Button, Text } = el

  // The hint gets a row of its own: beside the label-only controls it would
  // read as one phrase ("click the pane  Close").
  return (
    <Box flexDirection="column" marginTop={1}>
      {!isFocused && (
        <Text dimColor wrap="wrap">
          {keysHint(surface)}
        </Text>
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {keyWords(hasRows, columns, isFocused).map(words => (
          <Text dimColor>{words}</Text>
        ))}
        {controls(view, actions, isFocused).map(control => {
          const props = {
            key: control.key,
            label: control.label,
            plain: true as const,
            ...(isFocused ? { hotkey: control.hotkey } : {}),
            ...(control.key === 'close' ? { role: 'dismiss' as const } : {}),
            ...(ring === control.key ? { autoFocus: true as const } : {}),
            onPress: (press: { surface: RenderSurface }) => void control.onPress(press.surface),
          }

          // A control that does not apply draws its label in the theme's
          // faint colour, a step below the others' dim.
          return control.isOn ? (
            <Button {...props} dimColor />
          ) : (
            <Button {...props}>
              <Text color="subtle">{control.label}</Text>
            </Button>
          )
        })}
      </Box>
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
): RenderElement {
  const { Box, Text } = el
  const ring = keepsPlace ? null : ringKey(view, snapshot, isFocused)
  if (view.level === 3) {
    const keys = keysLine(el, view, false, columns, isFocused, surface, actions, ring)

    return contentBody(el, view.list.segment, view.item, palette, keys, actions, ring)
  }
  let body: RenderElement
  let hasRows = false
  if (view.level === 2) {
    body = listBody(el, view.list, snapshot, columns, isFocused, actions, palette, ring)
    hasRows = view.list.rows.some(row => row.isOpenable)
  } else if (snapshot === null) {
    body = <Text dimColor>Measuring the context window…</Text>
  } else {
    body = segmentsBody(el, snapshot, columns, isFocused, actions, palette, ring)
    hasRows = true
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
      {keysLine(el, view, hasRows, columns, isFocused, surface, actions, ring)}
    </Box>
  )
}
