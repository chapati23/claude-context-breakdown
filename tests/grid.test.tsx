// The pane off the terminal (grid.tsx): one face, one grid of fixed columns,
// pictures for the colours, no hotkey on a row, and a defined place for
// every state.

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  BAR_CELLS,
  BAR_NARROW_CELLS,
  BUTTON_PAD_CELLS,
  FIGURE_MIN_CELLS,
  GRID_MAX_CELLS,
  LABEL_PAD_CELLS,
  LEAD_CELLS,
  MEASURED_ADVANCE_PX,
  MIN_CELL_PX,
  OPEN_WORDS,
  SWATCH_ALT,
  barCells,
  columnCells,
  figureColumnCells,
  fittedDetail,
  fittedName,
  fittedPath,
  fittedTitle,
  gridCells,
} from '../hooks/grid'
import { DARK, LIGHT } from '../hooks/palette'
import { LENGTH_BAR_HEIGHT, MEASURED_CELL_PX, lengthBarPicture, swatchPicture, windowBarPicture } from '../hooks/svgbar'
import { BASELINE_HEADING, RESERVE_NAME } from '../hooks/pane'
import { ADDED_NAME, tableLayout } from '../hooks/table'
import { cellWidth } from '../hooks/text'
import { CHAT, FOCUSED_PANE, NOTES, OPENING, PANE, PROJECT_MD, PROJECT_TEXT, SUMMARY, TRANSCRIPT, realSession, richUsage, usage, world } from './fixtures'
import { gridLines, gridRowWith, gridRowsOf, isNode, nodesOf, rightColumns, rowLine, textOf } from './grid'

const START = { cwd: '/home/user/project', surface: 'terminal', isInteractive: true } as const
const GRID_SURFACES = ['desktop', 'vscode', 'mobile'] as const
const GLOBAL_MD = '/home/user/.claude/CLAUDE.md'

type Node = ReturnType<typeof nodesOf>[number]

async function realWorld($: Engine, on: On) {
  const w = world(on)
  const real = realSession()
  w.usage = real.usage
  w.messages = real.messages
  await $.session.start(START)
  await w.clock.advance(0)

  return w
}

async function chatWorld($: Engine, on: On, messages: readonly unknown[] = CHAT) {
  const w = world(on)
  w.usage = richUsage()
  w.messages = messages
  w.files = { [NOTES]: 'alpha\nbeta\n', [PROJECT_MD]: `${PROJECT_TEXT}\n`, [GLOBAL_MD]: 'Be brief.\n' }
  await $.session.start(START)
  await w.clock.advance(0)

  return w
}

/** The Texts of a tree that hold digits: figures, counts, facts. */
const texts = (tree: unknown) => nodesOf(tree).filter(node => node.type === 'Text')

/** The top-level Boxes of a level, in order, each named by what it holds. */
function partsOf(tree: unknown): string[] {
  const root = tree as Node

  return (root.children ?? []).filter(isNode).map(part => {
    const all = nodesOf(part)
    if (all.some(node => node.type === 'Button' && (node.props?.key === 'back' || node.props?.key === 'refresh'))) {
      return 'controls'
    }
    if (all.some(isGridRowNode)) {
      return 'rows'
    }

    return textOf(part).slice(0, 24)
  })
}

const isGridRowNode = (node: Node) => gridRowsOf(node).includes(node)

/** A right-aligned column of whole cells: a figure, or the servers' tool count. */
const isFigureColumn = (node: Node) => node.type === 'Box' && node.props?.justifyContent === 'flex-end' && typeof node.props?.width === 'number'

/** The cells a level 1 row's name has: the grid less the lead and the columns on its right, each with its gap. */
const nameRoomOf = (row: Node, grid: number) => grid - LEAD_CELLS - rightColumns(row).reduce((sum, part) => sum + (part.props?.width as number) + 1, 0)

/** A world after a compaction, so level 1 has the compaction summary's row. */
async function compactedWorld($: Engine, on: On) {
  const w = world(on)
  w.files = { [GLOBAL_MD]: 'Be brief.\n' }
  await $.session.start(START)
  await w.clock.advance(0)
  w.messages = SUMMARY
  await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT })
  await w.clock.advance(0)

  return w
}

test('off the terminal no Text of the pane asks for the monospaced face; every figure is tabular', async ($, on) => {
  await realWorld($, on)
  for (const surface of GRID_SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
    const check = async (where: string) => {
      const tree = await ui.drawn()
      expect({ where, mono: nodesOf(tree).filter(node => node.props?.mono === true).length }).toEqual({ where, mono: 0 })
      // A figure stands in a column of whole cells, right-aligned, in a tabular Text.
      for (const row of gridRowsOf(tree)) {
        for (const column of rightColumns(row).filter(isFigureColumn)) {
          const figure = (column.children ?? []).filter(isNode)[0]
          if (figure !== undefined) {
            expect({ where, line: rowLine(row), tabular: figure.props?.tabular }).toEqual({ where, line: rowLine(row), tabular: true })
          }
        }
      }
      // No text lines a column up with spaces.
      expect({ where, runs: texts(tree).filter(text => / {2}/.test(textOf(text))).map(textOf) }).toEqual({ where, runs: [] })
    }
    await check(`${surface} level 1`)
    await ui.press({ key: 'row-tool-results' })
    await check(`${surface} level 2`)
    await ui.press({ key: 'item-r:real0' })
    const three = await ui.drawn()
    // Level 3: the heading, the facts and the controls take the surface's face; only the text is code.
    expect({ surface, mono: nodesOf(three).filter(node => node.props?.mono === true).length }).toEqual({ surface, mono: 0 })
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('off the terminal no row has a hotkey; the controls keep theirs and the words name Enter', async ($, on) => {
  await realWorld($, on)
  for (const surface of GRID_SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
    for (const level of [1, 2]) {
      const buttons = await ui.findAll({ type: 'Button' })
      const rows = buttons.filter(button => /^(row|item)-/.test(button.key ?? ''))
      expect({ surface, level, rows: rows.length >= 10 }).toEqual({ surface, level, rows: true })
      expect({ surface, level, hotkeys: rows.filter(row => row.props.hotkey !== undefined).map(row => row.key) }).toEqual({ surface, level, hotkeys: [] })
      expect((await ui.find({ key: 'refresh' }))?.props.hotkey).toBe('r')
      expect(await ui.find({ type: 'Text', text: OPEN_WORDS })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /1-9/ })).toBeUndefined()
      // Every row still opens: the twelfth too.
      if (level === 1) {
        await ui.press({ key: 'row-tool-results' })
      }
    }
    await ui.press({ key: 'item-r:real11' })
    expect(await ui.find({ type: 'Code' })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('level 1: the heading, the bar, the window line with the column names, the groups, the notes, then the controls', async ($, on) => {
  await realWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 100 } })
  const tree = (await ui.drawn()) as Node
  const [grid, controls] = (tree.children ?? []).filter(isNode)
  expect(grid?.props?.width).toBe(GRID_MAX_CELLS)
  const parts = (grid?.children ?? []).filter(isNode)
  expect(textOf(parts[0])).toBe('283k used · 684k free before compaction')
  // The bar: one picture as wide as the grid at the measured cell, with no width of its own.
  expect(parts[1]?.props).toMatchObject({ width: GRID_MAX_CELLS, marginTop: 1, marginBottom: 1 })
  const bar = (parts[1]?.children ?? []).filter(isNode)[0]!
  expect(bar.type).toBe('Svg')
  expect(bar.props?.width).toBeUndefined()
  expect(bar.props?.alt).toBe('Context window: 283k used · 684k free before compaction')
  expect(String(bar.props?.source)).toContain(`width="${GRID_MAX_CELLS * MEASURED_CELL_PX}"`)
  // The window on the left, the column's name at the right.
  expect(nodesOf(parts[2]).filter(node => node.type === 'Text').map(textOf)).toEqual(['1M window', '% of used'])
  // Then the rows, and the notes last in the grid.
  expect(textOf(parts.at(-1))).toBe('All numbers are estimates.')
  expect(nodesOf(controls).some(node => node.props?.key === 'close')).toBe(true)
  // Free space and Reserve: a swatch in their texture, no length bar.
  const lines = gridLines(tree)
  expect(lines).toContain('Free space 684k')
  expect(lines).toContain('Reserve for compaction 33k')
  for (const [name, mark] of [
    ['Free space', '<circle'],
    ['Reserve for compaction', 'rotate(-45)'],
  ] as const) {
    const row = gridRowsOf(tree).find(line => rowLine(line).startsWith(name))!
    const [leadBox] = ((row.children ?? []).filter(isNode)[0]!.children ?? []).filter(isNode)
    expect({ name, width: leadBox?.props?.width }).toEqual({ name, width: LEAD_CELLS })
    const picture = (leadBox?.children ?? []).filter(isNode)[0]
    expect({ name, type: picture?.type, alt: picture?.props?.alt }).toEqual({ name, type: 'Svg', alt: SWATCH_ALT })
    // Free space's swatch is dotted (circles), the Reserve's shaded (stripes turned -45 degrees).
    expect({ name, texture: String(picture?.props?.source).includes(mark) }).toEqual({ name, texture: true })
  }
  expect(lines.filter(line => line.startsWith('Free space') || line.startsWith('Reserve')).every(line => !line.includes('▬'))).toBe(true)
  await ui.unmount()
})

test('level 1: a name that does not open starts in the rows’ name column, after the lead, where a Button’s label starts', async ($, on) => {
  // The fixture's MCP tools (deferred) has no servers: its Not loaded row does not open.
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
  const rows = gridRowsOf(await ui.drawn()).filter(row => /^(Free space|Reserve|MCP tools)/.test(rowLine(row)))
  expect(rows.map(row => rowLine(row).split(' ')[0])).toEqual(['Free', 'Reserve', 'MCP'])
  for (const row of rows) {
    const where = rowLine(row)
    expect({ where, button: nodesOf(row).some(node => node.type === 'Button') }).toEqual({ where, button: false })
    const [leadBox, nameBox] = ((row.children ?? []).filter(isNode)[0]!.children ?? []).filter(isNode)
    expect({ where, lead: [leadBox?.type, leadBox?.props?.width] }).toEqual({ where, lead: ['Box', LEAD_CELLS] })
    expect({ where, name: [nameBox?.type, nameBox?.props?.paddingLeft] }).toEqual({ where, name: ['Box', LABEL_PAD_CELLS] })
    expect({ where, text: (nameBox?.children ?? []).filter(isNode)[0]?.type }).toEqual({ where, text: 'Text' })
  }
  await ui.unmount()
})

test('level 1: where the long forms do not fit, Reserve takes its short name and a heading its title alone', async ($, on) => {
  await realWorld($, on)
  const formsAt = async (columns: number) => {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: columns } })
    const rows = gridRowsOf(await ui.drawn())
    const reserve = rows.find(row => rowLine(row).startsWith('Reserve'))!
    const heading = rows.find(row => rowLine(row).startsWith('Baseline'))!
    // A heading's text has the grid less its figure columns.
    const rightOf = (row: Node) => rightColumns(row).reduce((sum, part) => sum + (part.props?.width as number) + 1, 0)
    const forms = {
      reserve: textOf((reserve.children ?? []).filter(isNode)[0]),
      heading: textOf((heading.children ?? []).filter(isNode)[0]),
      headingRoom: gridCells(columns) - rightOf(heading),
    }
    await ui.unmount()

    return forms
  }
  const wide = await formsAt(100)
  expect([wide.reserve, wide.heading]).toEqual([RESERVE_NAME, BASELINE_HEADING])
  const narrow = await formsAt(40)
  expect([narrow.reserve, narrow.heading]).toEqual(['Reserve', 'Baseline'])
  // The long heading does not fit there. In every scene tried (40 to 100 columns, a share of "<0.1%"), the
  // terminal's table picks the title before the grid's own check does, so this line does not catch a
  // removal of that check: only the Reserve's line catches a removal of its own.
  expect(cellWidth(BASELINE_HEADING)).toBeGreaterThan(narrow.headingRoom)
})

test('level 2: the title row, the definition, the controls, then the facts with the column name, the rows and the notes', async ($, on) => {
  await realWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 100 } })
  await ui.press({ key: 'row-tool-results' })
  const tree = (await ui.drawn()) as Node
  const [head, controls, body, notes] = (tree.children ?? []).filter(isNode)
  // The title row: the dim trail, the swatch, the name in bold; the figures dim at the right edge.
  const title = (head?.children ?? []).filter(isNode)[0]!
  expect(title.props).toMatchObject({ justifyContent: 'space-between' })
  const left = ((title.children ?? []).filter(isNode)[0]!.children ?? []).filter(isNode)
  expect(left.map(node => node.type)).toEqual(['Text', 'Svg', 'Text'])
  expect(left.map(textOf)).toEqual(['Context ›', '', 'Tool results'])
  expect(left[1]?.props?.alt).toBe(SWATCH_ALT)
  expect(left[2]?.props?.weight).toBe('bold')
  // The figures keep their width, as every fixed column does: a long trail and name cannot squeeze them onto several lines.
  const figures = (title.children ?? []).filter(isNode)[1]!
  expect([figures.type, figures.props?.flexShrink]).toEqual(['Box', 0])
  const figureText = (figures.children ?? []).filter(isNode)[0]!
  expect([textOf(figureText), figureText.props?.dimColor]).toEqual(['114k · 40% of used', true])
  expect(textOf((head?.children ?? []).filter(isNode)[1])).toBe('The output of tool calls, such as file reads and command output.')
  // The controls come before the rows, one cell apart.
  expect(nodesOf(controls).some(node => node.props?.key === 'back')).toBe(true)
  expect(nodesOf(controls).filter(node => node.props?.flexWrap === 'wrap').every(node => node.props?.columnGap === 1)).toBe(true)
  // The facts and the column's name share the first line of the body.
  const facts = (body?.children ?? []).filter(isNode)[0]!
  expect(nodesOf(facts).filter(node => node.type === 'Text').map(textOf)).toEqual(['12 items · largest first', '% of segment'])
  expect(gridRowsOf(body)).toHaveLength(12)
  expect(textOf(notes)).toBe('Sizes are estimated from each item’s characters.')
  // No Next page control under the rows.
  expect(nodesOf(body).concat(nodesOf(notes)).some(node => node.type === 'Button' && node.props?.key === 'next-below')).toBe(false)
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('without the keys level 2 puts the hint last, so the rows keep their place', async ($, on) => {
  await realWorld($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 88 } })
  await ui.press({ key: 'row-tool-results' })
  const idle = await ui.drawn()
  expect(partsOf(idle).at(-1)).toBe('Click the pane for keys')
  const idleRows = (idle as Node).children!.filter(isNode).findIndex(part => gridRowsOf(part).length > 0)
  await ui.redraw({ ...FOCUSED_PANE.props, bodyColumns: 88 })
  const focused = await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'Click the pane for keys' })).toBeUndefined()
  expect((focused as Node).children!.filter(isNode).findIndex(part => gridRowsOf(part).length > 0)).toBe(idleRows)
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('level 3 has a swatch picture before its bold title; the rest is as on the terminal', async ($, on) => {
  const w = world(on)
  w.usage = richUsage()
  w.messages = CHAT
  w.files = { [NOTES]: 'alpha\nbeta\n', [GLOBAL_MD]: 'Be brief.\n' }
  await $.session.start(START)
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  await ui.press({ key: 'row-global-instructions' })
  const item = (await ui.findAll({ type: 'Button' })).find(button => button.key?.startsWith('item-'))!
  await ui.press({ key: item.key! })
  const tree = (await ui.drawn()) as Node
  const [title, facts, note] = (tree.children ?? []).filter(isNode)
  expect(title?.props).toMatchObject({ flexDirection: 'row', alignItems: 'center' })
  expect((title?.children ?? []).filter(isNode).map(node => node.type)).toEqual(['Svg', 'Box'])
  // The title's Box may shrink below its text, so a long path wraps inside the pane.
  const wordsBox = (title?.children ?? []).filter(isNode)[1]!
  expect(wordsBox.props).toMatchObject({ flexShrink: 1, minWidth: 0 })
  const words = (wordsBox.children ?? []).filter(isNode)[0]!
  expect([textOf(words), words.props?.weight, words.props?.wrap]).toEqual(['Global › ~/.claude/CLAUDE.md', 'bold', 'wrap'])
  expect(textOf(facts)).toMatch(/ tokens · formatted · on disk$/)
  // A file the opening reminder lacks is shown from disk, and a note says so, under the facts.
  expect([textOf(note), note?.props?.dimColor]).toEqual(['Not found in the conversation’s opening reminder: shown from disk.', true])
  expect((await ui.findAll({ type: 'Button' })).find(button => button.props.autoFocus === true)?.key).toBe('back')
  await ui.press({ key: 'back' })
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('before the first measurement the grid holds a waiting line, and the controls stay', async ($, on) => {
  world(on)
  for (const surface of GRID_SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    const tree = (await ui.drawn()) as Node
    const [grid] = (tree.children ?? []).filter(isNode)
    expect(grid?.props?.width).toBe(gridCells(FOCUSED_PANE.props.bodyColumns))
    expect(textOf(grid)).toBe('Measuring the context window…')
    expect(nodesOf(tree).filter(node => node.type === 'Svg')).toEqual([])
    expect((await ui.find({ key: 'refresh' }))?.props.autoFocus).toBe(true)
    // No row opens yet: no words before the controls.
    expect(await ui.find({ type: 'Text', text: OPEN_WORDS })).toBeUndefined()
    await ui.unmount()
  }
})

test('a list with no rows shows its facts and its note, no column name and no row', async ($, on) => {
  const w = world(on)
  w.messages = null
  await $.session.start(START)
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  await ui.press({ key: 'row-conversation' })
  const tree = await ui.drawn()
  expect(gridRowsOf(tree)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^% of/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '0 items' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^The messages could not be read/ }))?.props).toMatchObject({ dimColor: true, wrap: 'wrap' })
  // With nothing to open, the focus starts on Back.
  expect((await ui.find({ key: 'back' }))?.props.autoFocus).toBe(true)
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('a row that does not open is a dim Text that starts where a Button’s label starts', async ($, on) => {
  await chatWorld($, on, OPENING)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  await ui.press({ key: 'row-mcp' })
  const tree = await ui.drawn()
  const rows = gridRowsOf(tree)
  const opens = rows.filter(row => nodesOf(row).some(node => node.type === 'Button'))
  const closed = rows.filter(row => !nodesOf(row).some(node => node.type === 'Button'))
  expect(opens).toHaveLength(1)
  expect(closed.length).toBeGreaterThan(0)
  for (const row of closed) {
    const titleBox = ((row.children ?? []).filter(isNode)[0]!.children ?? []).filter(isNode)[0]!
    expect(titleBox.props?.paddingLeft).toBe(LABEL_PAD_CELLS)
    expect((titleBox.children ?? []).filter(isNode)[0]?.props?.dimColor).toBe(true)
  }
  // The open row's Button sits in a Box of the same width, with no padding of the mod's.
  const openBox = ((opens[0]!.children ?? []).filter(isNode)[0]!.children ?? []).filter(isNode)[0]!
  expect(openBox.props?.paddingLeft).toBeUndefined()
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('servers without token figures: the name, then the tool count at the grid’s right edge; no bar, no tokens, no share', async ($, on) => {
  const w = world(on)
  const base = usage(66_000)
  const mcpTools = [
    ...Array.from({ length: 2 }, (_, i) => ({ name: `mcp__x__t${i}`, serverName: 'notes', tokens: 0, isLoaded: false })),
    ...Array.from({ length: 4 }, (_, i) => ({ name: `mcp__x__u${i}`, serverName: 'tickets', tokens: 0, isLoaded: false })),
  ]
  const categories = base.context.breakdown!.categories.map(category => (category.kind === 'deferred' ? { ...category, tokens: 0 } : category))
  w.usage = { ...base, context: { ...base.context, breakdown: { ...base.context.breakdown!, categories, mcpTools } } }
  await $.session.start(START)
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
  await ui.press({ key: 'row-not-loaded' })
  const tree = await ui.drawn()
  expect(gridLines(tree)).toEqual(['tickets 4 tools', 'notes 2 tools'])
  for (const row of gridRowsOf(tree)) {
    const right = rightColumns(row)
    expect(right.map(part => part.props?.width)).toEqual(['4 tools'.length])
    expect(right[0]?.props?.justifyContent).toBe('flex-end')
  }
  expect(nodesOf(tree).filter(node => node.type === 'Svg')).toEqual([])
  // No row opens: the focus starts on Back.
  expect((await ui.find({ key: 'back' }))?.props.autoFocus).toBe(true)
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('the servers list draws grey length bars and the tool counts in a column of their own', async ($, on) => {
  const w = world(on)
  const base = usage(66_000)
  const mcpTools = [
    ...Array.from({ length: 3 }, (_, i) => ({ name: `mcp__x__t${i}`, serverName: 'tickets', tokens: 1000, isLoaded: false })),
    ...Array.from({ length: 12 }, (_, i) => ({ name: `mcp__x__u${i}`, serverName: 'a-server-name-far-too-long-for-any-pane-to-show-whole', tokens: 500, isLoaded: false })),
  ]
  w.usage = { ...base, context: { ...base.context, breakdown: { ...base.context.breakdown!, mcpTools } } }
  await $.session.start(START)
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
  await ui.press({ key: 'row-not-loaded' })
  const tree = await ui.drawn()
  const rows = gridRowsOf(tree)
  expect(rows).toHaveLength(2)
  // The name in full: the surface cuts it at its end where it does not fit.
  expect(textOf(rows[0])).toContain('a-server-name-far-too-long-for-any-pane-to-show-whole')
  for (const row of rows) {
    const [count, bar] = rightColumns(row)
    expect(count?.props?.width).toBe('12 tools'.length)
    const picture = (bar?.children ?? []).filter(isNode)[0]!
    expect(String(picture.props?.source)).toContain(DARK.notLoaded)
  }
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('a share column whose shares all have 2 digits still has FIGURE_MIN_CELLS cells, so "%" does not break onto a second line', async ($, on) => {
  expect(figureColumnCells(['50%', '25%'])).toBe(FIGURE_MIN_CELLS)
  expect(figureColumnCells(['<0.1%'])).toBe(6)
  expect(columnCells(['50%', '25%'])).toBe(4)
  const w = world(on)
  const base = usage(66_000)
  const mcpTools = [
    ...Array.from({ length: 3 }, (_, i) => ({ name: `mcp__x__t${i}`, serverName: 'tickets', tokens: 1000, isLoaded: false })),
    ...Array.from({ length: 12 }, (_, i) => ({ name: `mcp__x__u${i}`, serverName: 'notes', tokens: 500, isLoaded: false })),
  ]
  w.usage = { ...base, context: { ...base.context, breakdown: { ...base.context.breakdown!, mcpTools } } }
  await $.session.start(START)
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 100 } })
  await ui.press({ key: 'row-not-loaded' })
  const tree = await ui.drawn()
  const shares = gridRowsOf(tree).flatMap(row => rightColumns(row).filter(column => isFigureColumn(column) && /^\d\d%$/.test(textOf(column))))
  expect(shares.map(column => textOf(column)).sort()).toEqual(['33%', '67%'])
  for (const column of shares) {
    expect(column.props?.width).toBe(FIGURE_MIN_CELLS)
  }
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('while free space is low the window line names the largest segment where it fits beside the column name, else gives way', async ($, on) => {
  const w = world(on)
  w.usage = usage(156_000, 130_000)
  await $.session.start(START)
  await w.clock.advance(0)
  const wide = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
  expect(await wide.find({ type: 'Text', text: '200k window · largest: Tool results 63%' })).toBeDefined()
  expect(await wide.find({ type: 'Text', text: '% of used' })).toBeDefined()
  await wide.unmount()
  // At 45 columns the long form leaves no room for the column's name: the window alone, and the name stays.
  const narrow = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 45 } })
  expect(await narrow.find({ type: 'Text', text: '200k window' })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: '% of used' })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: /largest/ })).toBeUndefined()
  await narrow.unmount()
})

test('after a compaction the column name carries the ~ of an estimate', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)
  w.messages = SUMMARY
  await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT })
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '~% of used' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^All numbers are estimates\. ~: / })).toBeDefined()
  // The compaction summary's swatch is striped.
  const row = gridRowWith(await ui.drawn(), 'row-compaction-summary')!
  const swatch = nodesOf(row).find(node => node.type === 'Svg' && node.props?.alt === SWATCH_ALT)!
  expect(String(swatch.props?.source)).toContain('<pattern')
  await ui.unmount()
})

test('a surface that offers no keys draws no hotkey and no words, and the hint says how to get them', async ($, on) => {
  await realWorld($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  for (const level of [1, 2]) {
    expect({ level, hotkeys: (await ui.findAll({ type: 'Button' })).filter(button => button.props.hotkey !== undefined).length }).toEqual({ level, hotkeys: 0 })
    expect(await ui.find({ type: 'Text', text: OPEN_WORDS })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Click the pane for keys' })).toBeDefined()
    if (level === 1) {
      await ui.press({ key: 'row-tool-results' })
    }
  }
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('the focus starts on the first row, the servers list on Back, level 3 on Back; b comes back onto the row', async ($, on) => {
  await realWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
  const ringed = async () => (await ui.findAll({ type: 'Button' })).filter(button => button.props.autoFocus === true).map(button => button.key)
  expect(await ringed()).toEqual(['row-system'])
  await ui.press({ key: 'row-tool-results' })
  expect(await ringed()).toEqual(['item-r:real0'])
  await ui.press({ key: 'item-r:real4' })
  expect(await ringed()).toEqual(['back'])
  await ui.press({ key: 'back' })
  expect(await ringed()).toEqual(['item-r:real4'])
  await ui.press({ key: 'back' })
  expect(await ringed()).toEqual(['row-tool-results'])
  await ui.unmount()
})

test('every picture whose width matters sets none and stands in a Box of whole cells, drawn for the measured cell', async ($, on) => {
  await realWorld($, on)
  for (const columns of [32, 46, 88, 140]) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: columns } })
    for (const level of [1, 2]) {
      const tree = await ui.drawn()
      const boxes = nodesOf(tree).filter(node => node.type === 'Box' && (node.children ?? []).some(child => isNode(child) && child.type === 'Svg'))
      for (const box of boxes) {
        const svg = (box.children ?? []).filter(isNode).find(child => child.type === 'Svg')!
        const where = `${columns} columns, level ${level}, ${String(svg.props?.alt)}`
        if (svg.props?.alt === SWATCH_ALT) {
          expect({ where, size: [svg.props?.width, svg.props?.height] }).toEqual({ where, size: [10, 10] })
          continue
        }
        // A bar: no width; its Box is whole cells; the markup is as wide as those cells at the measured size.
        const cells = box.props?.width as number
        expect({ where, width: svg.props?.width, whole: Number.isInteger(cells) }).toEqual({ where, width: undefined, whole: true })
        expect({ where, markup: String(svg.props?.source).includes(`width="${Math.round(cells * MEASURED_CELL_PX * 100) / 100}"`) }).toEqual({ where, markup: true })
        expect({ where, stretches: String(svg.props?.source).includes('preserveAspectRatio="none"') }).toEqual({ where, stretches: true })
      }
      if (level === 1) {
        await ui.press({ key: 'row-tool-results' })
      }
    }
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the length bars scale to the largest row and alt texts use the full name and detail once', async ($, on) => {
  await realWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
  await ui.press({ key: 'row-tool-results' })
  const tree = await ui.drawn()
  const bars = nodesOf(tree).filter(node => node.type === 'Svg' && node.props?.alt !== SWATCH_ALT)
  expect(bars[0]?.props?.alt).toBe('Read ~/project/src/module-1.ts: 31k')
  // The largest fills its column; the smallest keeps at least 2 px.
  const fill = (svg: Node) => Number(/<rect width="([\d.]+)"/.exec(String(svg.props?.source))?.[1])
  expect(fill(bars[0]!)).toBe(BAR_CELLS * MEASURED_CELL_PX)
  expect(fill(bars.at(-1)!)).toBeGreaterThanOrEqual(2)
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('every right-aligned column is as wide as its widest text on the page and one cell more (a figure column at least FIGURE_MIN_CELLS), the same on every row', async ($, on) => {
  expect(columnCells(['406k', '<0.1%', null])).toBe(6)
  expect(columnCells(['150k', '36%'])).toBe(5)
  expect(columnCells([ADDED_NAME, '+2.5k'])).toBe(6)
  const check = (tree: unknown, where: string) => {
    // The columns of every row, counted from the right; the window line's "added" stands in the last one.
    const byPlace = new Map<number, Node[]>()
    const rows = gridRowsOf(tree)
    expect({ where, rows: rows.length > 0 }).toEqual({ where, rows: true })
    for (const row of rows) {
      rightColumns(row)
        .reverse()
        .forEach((part, place) => {
          if (isFigureColumn(part)) {
            byPlace.set(place, [...(byPlace.get(place) ?? []), part])
          }
        })
    }
    const added = nodesOf(tree).find(node => isFigureColumn(node) && textOf(node) === ADDED_NAME && !rows.some(row => nodesOf(row).includes(node)))
    if (added !== undefined) {
      byPlace.set(0, [...(byPlace.get(0) ?? []), added])
    }
    for (const [place, columns] of byPlace) {
      const widths = [...new Set(columns.map(column => column.props?.width))]
      const widest = Math.max(...columns.map(column => cellWidth(textOf(column))))
      expect({ where, place, widths }).toEqual({ where, place, widths: [Math.max(FIGURE_MIN_CELLS, widest + 1)] })
    }
  }
  await realWorld($, on)
  for (const columns of [40, 46, 88]) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: columns } })
    check(await ui.drawn(), `${columns} columns, level 1`)
    for (const key of ['row-tool-results', 'row-system']) {
      await ui.press({ key })
      check(await ui.drawn(), `${columns} columns, ${key}`)
      await ui.press({ key: 'back' })
    }
    await ui.unmount()
  }
})

test('fittedName: the name, else the short name, else the short name cut, in the room less the native padding', () => {
  expect(fittedName('Compaction summary', 'Summary', 14)).toBe('Summary')
  expect(fittedName('Global instructions', 'Global', 30)).toBe('Global instructions')
  expect(fittedName('Skills list and custom agents', 'Skills/agents', 10)).toBe('Skills/…')
})

for (const make of [realWorld, compactedWorld]) {
  test(`at 40 and 46 columns every level 1 row’s Button fits its name’s room: the label’s cells and the native padding (${make.name})`, async ($, on) => {
    await make($, on)
    for (const columns of [40, 46]) {
      const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: columns } })
      const tree = await ui.drawn()
      const buttons = nodesOf(tree).filter(node => node.type === 'Button' && String(node.props?.key).startsWith('row-'))
      expect(buttons.length).toBeGreaterThan(3)
      for (const button of buttons) {
        const row = gridRowWith(tree, String(button.props?.key))!
        const label = String(button.props?.label)
        const where = `${columns} columns, ${label}`
        expect({ where, fits: cellWidth(label) + BUTTON_PAD_CELLS <= nameRoomOf(row, gridCells(columns)) }).toEqual({ where, fits: true })
      }
      await ui.unmount()
    }
  })
}

test('an item title’s column holds its Button: the label’s cells and the native padding at the smallest cell', async ($, on) => {
  expect(BUTTON_PAD_CELLS * MIN_CELL_PX).toBeGreaterThanOrEqual(12)
  await realWorld($, on)
  for (const columns of [40, 46, 88]) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: columns } })
    await ui.press({ key: 'row-tool-results' })
    const tree = await ui.drawn()
    const held = nodesOf(tree).filter(
      node => node.type === 'Box' && typeof node.props?.width === 'number' && (node.children ?? []).some(child => isNode(child) && child.type === 'Button'),
    )
    expect(held.length).toBeGreaterThan(5)
    for (const box of held) {
      const label = textOf(box)
      const where = `${columns} columns, ${label}`
      expect({ where, fits: cellWidth(label) + BUTTON_PAD_CELLS <= (box.props?.width as number) }).toEqual({ where, fits: true })
    }
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('gridCells and barCells: the grid stops at its cap; the bar is shorter in a narrower grid and gone where the table drops it', () => {
  expect(MEASURED_ADVANCE_PX).toBe(8.43)
  expect([24, 40, 46, 60, 66, 100, 200].map(gridCells)).toEqual([22, 38, 44, 57, 63, 64, 64])
  // The grid ends inside the body where a Box's cell (8.8 px) is wider than the code font's advance that the columns count (8.43 px).
  for (let columns = 3; columns <= 200; columns++) {
    expect({ columns, fits: gridCells(columns) * MEASURED_CELL_PX <= columns * 8.43 }).toEqual({ columns, fits: true })
  }
  // A pane too narrow for any grid still gets one cell.
  expect([0, 1, 2].map(gridCells)).toEqual([1, 1, 1])
  expect(barCells(tableLayout(100, 32), gridCells(100))).toBe(BAR_CELLS)
  expect(barCells(tableLayout(46, 32), gridCells(46))).toBe(BAR_NARROW_CELLS)
  expect(barCells(tableLayout(24, 32), gridCells(24))).toBe(0)
  expect(LEAD_CELLS * MEASURED_CELL_PX).toBeGreaterThan(10)
})

test('fittedTitle and fittedDetail: a path keeps the end of its file name inside its cells; a command is given in full', () => {
  expect(fittedDetail('~/project/src/ledger/balance.go', 20, true)).toBe('…/ledger/balance.go')
  expect(fittedDetail('~/project/src/ledger/balance.go', 40, true)).toBe('~/project/src/ledger/balance.go')
  expect(fittedDetail('go test ./src/ledger/... -run TestBalance -v', 20, false)).toBe('go test ./src/ledger/... -run TestBalance -v')
  expect(fittedTitle('~/.claude/projects/x/memory/MEMORY.md', 16, true).endsWith('MEMORY.md')).toBe(true)
  // Where the file name does not fit, its head is cut: its end stays, and the path keeps to its cells.
  expect(fittedDetail('~/project/src/ledger/balance.go', 5, true)).toBe('…e.go')
  expect(fittedTitle('~/.claude/projects/x/memory/MEMORY.md', 4, true)).toBe('….md')
  expect(fittedDetail('~/project/src/ledger/a-file-name-longer-than-the-room.go', 10, true)).toBe('…e-room.go')
  // A wide character counts 2 cells: the head is cut further, and none is split.
  expect(fittedPath('~/docs/日本語のファイル名.md', 8)).toBe('…ル名.md')
  // Never fewer than 2 cells.
  expect(fittedPath('~/project/balance.go', 0)).toBe('…o')
  for (const cells of [0, 1, 2, 3, 5, 8, 13, 21]) {
    for (const path of ['~/project/src/ledger/balance.go', '~/docs/日本語のファイル名.md', '/srv/a-file-name-longer-than-the-room.go']) {
      expect({ path, cells, fits: cellWidth(fittedPath(path, cells)) <= Math.max(2, cells) }).toEqual({ path, cells, fits: true })
    }
  }
  // A title that is not a path is cut in its middle: a third of the cells before the ellipsis, the rest after it.
  expect(fittedTitle('mcp__claude-in-chrome__computer', 12, false)).toBe('mcp…computer')
  expect(fittedTitle('mcp__notes__search', 11, false)).toBe('mcp…_search')
  expect(fittedTitle('mcp__notes__lookup', 11, false)).toBe('mcp…_lookup')
  // Spaces at the cut go.
  expect(fittedTitle('ab cdefghijklmn', 10, false)).toBe('ab…ijklmn')
  expect(fittedTitle('abcdefghij klmno', 10, false)).toBe('abc…klmno')
  // Wide characters: a character that does not fit is left out.
  expect(fittedTitle('日本語のツール名前です', 7, false)).toBe('日…です')
  expect(fittedTitle('日本語のツール名前です', 6, false)).toBe('…です')
  // In 2 cells or fewer, the head and the ellipsis.
  expect(fittedTitle('abcdef', 2, false)).toBe('a…')
  expect(fittedTitle('abcdef', 1, false)).toBe('…')
  expect(fittedTitle('Read', 12, false)).toBe('Read')
  for (const cells of [1, 2, 3, 4, 7, 11, 20]) {
    for (const title of ['mcp__claude-in-chrome__computer', '日本語のツール名前です', 'Please read the notes file and list the folder.']) {
      expect({ title, cells, fits: cellWidth(fittedTitle(title, cells, false)) <= cells }).toEqual({ title, cells, fits: true })
    }
  }
})

test('at 40 and 46 columns a path detail keeps the end of its file name and stays inside its column', async ($, on) => {
  await realWorld($, on)
  for (const columns of [40, 46]) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: columns } })
    await ui.press({ key: 'row-tool-results' })
    const reads = gridRowsOf(await ui.drawn()).filter(row => rowLine(row).startsWith('Read '))
    expect(reads.length).toBeGreaterThan(3)
    for (const row of reads) {
      const detail = rowLine(row).split(' ')[1] ?? ''
      // The whole path is in the length bar's alt text: "Read ~/project/src/module-1.ts: 31k".
      const alt = String(nodesOf(row).find(node => node.type === 'Svg')?.props?.alt)
      const path = alt.slice('Read '.length, alt.lastIndexOf(':'))
      // The detail's cells: the grid less the columns on the right, the title's Box and two gaps.
      const titleBox = ((row.children ?? []).filter(isNode)[0]!.children ?? []).filter(isNode)[0]!
      const cells = gridCells(columns) - rightColumns(row).reduce((sum, part) => sum + (part.props?.width as number) + 1, 0) - 1 - (titleBox.props?.width as number) - 1
      const where = `${columns} columns, ${detail}`
      expect({ where, end: detail === path || (detail.startsWith('…') && path.endsWith(detail.slice(1))) }).toEqual({ where, end: true })
      expect({ where, fits: cellWidth(detail) <= cells }).toEqual({ where, fits: true })
    }
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the pictures: grey grounds that read on light and dark, textures, the fewest pixels a part gets', () => {
  // The free space and reserve grounds are a mid grey, part see-through, on both palettes.
  for (const palette of [DARK, LIGHT]) {
    const bar = windowBarPicture(
      [
        { kind: 'segment', color: palette.segments.system, tokens: 50_000, texture: null },
        { kind: 'segment', color: palette.segments['compaction-summary'], tokens: 100, texture: 'striped' },
        { kind: 'free', color: palette.free, tokens: 100_000, texture: 'dotted' },
        { kind: 'reserve', color: palette.reserve, tokens: 33_000, texture: 'shaded' },
      ],
      563.2,
    )
    expect(bar).toContain('fill="#808080" fill-opacity="0.3"')
    expect(bar).toContain('fill="#808080" fill-opacity="0.18"')
    expect(bar).toContain('preserveAspectRatio="none"')
    // A part of 100 tokens still shows: at least 3 px.
    const widths = [...bar.matchAll(/<rect x="[\d.]+" y="0" width="([\d.]+)" height="10" fill="url\(#t1\)"/g)].map(match => Number(match[1]))
    expect(widths[0]).toBeGreaterThanOrEqual(1.5)
  }
  // A bar too short for every part's minimum: no stretch gets a negative width, and none runs back.
  const tiny = windowBarPicture(
    [
      { kind: 'segment', color: '#111111', tokens: 1, texture: null },
      { kind: 'segment', color: '#222222', tokens: 1, texture: null },
      { kind: 'segment', color: '#333333', tokens: 1, texture: null },
      { kind: 'free', color: '#444444', tokens: 100_000, texture: null },
    ],
    3,
  )
  const xs = [...tiny.matchAll(/<rect x="(-?[\d.]+)" y="0" width="(-?[\d.]+)"/g)].map(match => [Number(match[1]), Number(match[2])] as const)
  expect(xs.every(([x, width]) => x >= 0 && width >= 0)).toBe(true)
  expect(xs.map(([x]) => x)).toEqual([...xs.map(([x]) => x)].sort((a, b) => a - b))
  // A part with no tokens draws nothing.
  expect(windowBarPicture([{ kind: 'reserve', color: '#000000', tokens: 0, texture: 'shaded' }], 100)).not.toContain('url(#t0)')
  expect(lengthBarPicture(0, 100, '#123456', 44)).not.toContain('#123456')
  expect(lengthBarPicture(1, 1_000_000, '#123456', 44)).toContain('<rect width="2" height="6"')
  expect(lengthBarPicture(100, 100, '#123456', 44)).toContain(`<rect width="44" height="${LENGTH_BAR_HEIGHT}"`)
  expect(swatchPicture('#123456', null)).toContain('fill="#123456"')
  expect(swatchPicture('#123456', 'striped')).toContain('<pattern id="t"')
})

/** The node of `tree` whose children hold `node`. */
function parentOf(tree: unknown, node: Node): Node | undefined {
  return nodesOf(tree).find(parent => (parent.children ?? []).includes(node))
}

/**
 * The widest server id of the servers-100 scene, in cells: the reference
 * renderer drew it 261.2 px wide at a cell of 7.92 px (the measured cell at
 * the page's zoom), 32.98 cells.
 */
const WIDEST_ID_CELLS = 33

test('the servers’ tool-count column is as wide as its widest text, with no spare cell; at 100 columns a server id shows whole', async ($, on) => {
  const w = world(on)
  const base = usage(66_000)
  // The first servers of the servers-100 scene: two long ids, the widest id, and a short name.
  const servers: [string, number, number][] = [
    ['724b336b-d694-46f4-b9af-6d2655b2deab', 240, 150_000],
    ['ceadc063-7ff5-41d4-93a2-b1525f9336b6', 78, 60_000],
    ['grafana', 79, 52_000],
    ['65cc47e7-438a-4b29-bd37-5989096a0f43', 27, 22_000],
  ]
  const mcpTools = servers.flatMap(([serverName, count, tokens]) =>
    Array.from({ length: count }, (_, i) => ({ name: `mcp__${serverName}__t${i}`, serverName, tokens: tokens / count, isLoaded: false })),
  )
  // The category holds every server's tokens, so the shares are those of the scene.
  const total = servers.reduce((sum, [, , tokens]) => sum + tokens, 0)
  const categories = base.context.breakdown!.categories.map(category => (category.kind === 'deferred' ? { ...category, tokens: total } : category))
  w.usage = { ...base, context: { ...base.context, breakdown: { ...base.context.breakdown!, categories, mcpTools } } }
  await $.session.start(START)
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 100 } })
  await ui.press({ key: 'row-not-loaded' })
  const rows = gridRowsOf(await ui.drawn())
  expect(rows).toHaveLength(servers.length)
  for (const row of rows) {
    const [count] = rightColumns(row)
    // A gap and the length bar follow the count: it needs no spare cell.
    expect(count?.props?.width).toBe(cellWidth('240 tools'))
    // The name has the grid less the columns on its right, each with its gap.
    const room = gridCells(100) - rightColumns(row).reduce((sum, part) => sum + (part.props?.width as number) + 1, 0)
    expect({ line: rowLine(row), room: room >= WIDEST_ID_CELLS }).toEqual({ line: rowLine(row), room: true })
  }
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('at 40 and 46 columns a long item title keeps at least half of the room it shares with its detail; at 46 it keeps 8 characters and the detail 4 cells', async ($, on) => {
  const w = world(on)
  const base = richUsage()
  const mcpTools = [
    { name: 'mcp__claude-in-chrome__computer', serverName: 'claude-in-chrome', tokens: 400, isLoaded: true },
    { name: 'mcp__0d2d52de-84ea-4267__get_meetings', serverName: '0d2d52de-84ea-4267', tokens: 300, isLoaded: true },
    { name: 'mcp__ccd_turn__update_plan', serverName: 'ccd_turn', tokens: 200, isLoaded: true },
  ]
  w.usage = { ...base, context: { ...base.context, breakdown: { ...base.context.breakdown!, mcpTools } } }
  w.messages = OPENING
  await $.session.start(START)
  await w.clock.advance(0)
  for (const columns of [46, 40]) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: columns } })
    await ui.press({ key: 'row-mcp' })
    // The tool names: "mcp…" or, at 40 columns, "mc…"; the server instructions' row starts with "MCP".
    const detailed = gridRowsOf(await ui.drawn()).filter(row => textOf(row).startsWith('mc'))
    expect(detailed).toHaveLength(mcpTools.length)
    for (const row of detailed) {
      const [titleBox, detailBox] = ((row.children ?? []).filter(isNode)[0]!.children ?? []).filter(isNode)
      const title = textOf(titleBox)
      const titleCells = (titleBox!.props?.width as number) - BUTTON_PAD_CELLS
      // The title and the detail share the grid less the columns on the right, the button's padding and the detail's margin.
      const shared = gridCells(columns) - rightColumns(row).reduce((sum, part) => sum + (part.props?.width as number) + 1, 0) - 1 - BUTTON_PAD_CELLS - 1
      const where = `${columns} columns, ${title} ${textOf(detailBox)}`
      expect({ where, half: titleCells >= Math.floor(shared / 2) }).toEqual({ where, half: true })
      if (columns === 46) {
        expect({ where, title: (title.endsWith('…') ? title.length - 1 : title.length) >= 8 }).toEqual({ where, title: true })
        expect({ where, detail: shared - titleCells >= 4 }).toEqual({ where, detail: true })
      }
    }
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the words of the controls row start where a Button’s label starts, at every level; the hint does not', async ($, on) => {
  await realWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 46 } })
  const check = async (where: string, hasWords: boolean) => {
    const tree = await ui.drawn()
    // No Text stands bare in a wrapping row of the key line: each sits in a Box with the button's padding.
    const bare = nodesOf(tree).filter(node => node.type === 'Text' && parentOf(tree, node)?.props?.flexWrap === 'wrap')
    expect({ where, bare: bare.map(textOf) }).toEqual({ where, bare: [] })
    const words = nodesOf(tree).filter(node => node.type === 'Text' && textOf(node) === OPEN_WORDS)
    expect({ where, words: words.length }).toEqual({ where, words: hasWords ? 1 : 0 })
    for (const text of words) {
      expect({ where, pad: parentOf(tree, text)?.props?.paddingLeft }).toEqual({ where, pad: LABEL_PAD_CELLS })
    }
  }
  await check('level 1', true)
  await ui.press({ key: 'row-tool-results' })
  await check('level 2', true)
  await ui.press({ key: 'item-r:real11' })
  await check('level 3', false)
  await ui.press({ key: 'back' })
  await ui.press({ key: 'back' })
  await ui.unmount()
  // Without the keys the hint stands at the left edge, with no padding.
  const away = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 46 } })
  const tree = await away.drawn()
  const hint = nodesOf(tree).find(node => node.type === 'Text' && textOf(node) === 'Click the pane for keys')
  expect(hint).toBeDefined()
  expect(parentOf(tree, hint!)?.props?.paddingLeft).toBeUndefined()
  await away.unmount()
})

test('the group headings of level 1 and the trail of the level 2 title are cut at their end, never on a second line', async ($, on) => {
  await realWorld($, on)
  // A phone wraps a Text cut at its end unless maxLines is set: each such Text has maxLines 1.
  for (const surface of GRID_SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns: 46 } })
    const headings = nodesOf(await ui.drawn()).filter(node => node.type === 'Text' && /^(Baseline|Conversation|Not loaded)/.test(textOf(node)))
    expect(headings.length).toBeGreaterThanOrEqual(2)
    for (const heading of headings) {
      expect({ surface, heading: textOf(heading), maxLines: heading.props?.maxLines }).toEqual({ surface, heading: textOf(heading), maxLines: 1 })
      expect({ surface, heading: textOf(heading), wraps: heading.props?.wrap === 'wrap' }).toEqual({ surface, heading: textOf(heading), wraps: false })
    }
    await ui.press({ key: 'row-tool-results' })
    const tree = await ui.drawn()
    const trail = nodesOf(tree).find(node => node.type === 'Text' && textOf(node).endsWith('›'))
    expect({ surface, maxLines: trail?.props?.maxLines }).toEqual({ surface, maxLines: 1 })
    const name = nodesOf(tree).find(node => node.type === 'Text' && node.props?.weight === 'bold')
    expect({ surface, maxLines: name?.props?.maxLines }).toEqual({ surface, maxLines: 1 })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a name that does not open is one line on every surface: Free space, Reserve, and a title that is not a Button', async ($, on) => {
  await chatWorld($, on, OPENING)
  for (const surface of GRID_SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns: 46 } })
    const lineOf = (tree: unknown, text: RegExp) => nodesOf(tree).find(node => node.type === 'Text' && text.test(textOf(node)))?.props?.maxLines
    const one = await ui.drawn()
    expect({ surface, free: lineOf(one, /^Free space$/), reserve: lineOf(one, /^Reserve/) }).toEqual({ surface, free: 1, reserve: 1 })
    await ui.press({ key: 'row-mcp' })
    const two = await ui.drawn()
    const closed = gridRowsOf(two).filter(row => !nodesOf(row).some(node => node.type === 'Button'))
    expect(closed.length).toBeGreaterThan(0)
    for (const row of closed) {
      const title = nodesOf(row).find(node => node.type === 'Text')!
      expect({ surface, title: textOf(title), maxLines: title.props?.maxLines }).toEqual({ surface, title: textOf(title), maxLines: 1 })
    }
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('at 46 columns two tools of one server keep labels of their own: a title that is not a path is cut in its middle', async ($, on) => {
  const w = world(on)
  const base = richUsage()
  const mcpTools = [
    { name: 'mcp__notes__search', serverName: 'notes', tokens: 400, isLoaded: true },
    { name: 'mcp__notes__lookup', serverName: 'notes', tokens: 300, isLoaded: true },
    { name: 'mcp__0d2d52de-84ea-4267__get_meetings', serverName: '0d2d52de-84ea-4267', tokens: 200, isLoaded: true },
  ]
  w.usage = { ...base, context: { ...base.context, breakdown: { ...base.context.breakdown!, mcpTools } } }
  w.messages = OPENING
  await $.session.start(START)
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 46 } })
  await ui.press({ key: 'row-mcp' })
  const titles = gridRowsOf(await ui.drawn())
    .filter(row => textOf(row).startsWith('mcp'))
    .map(row => textOf(((row.children ?? []).filter(isNode)[0]!.children ?? []).filter(isNode)[0]))
  expect(titles).toHaveLength(3)
  // The long tool name is cut, and its end stays.
  expect(titles.some(title => title.includes('…') && title.endsWith('eetings'))).toBe(true)
  expect(titles.filter(title => title.endsWith('search') || title.endsWith('lookup'))).toHaveLength(2)
  expect(new Set(titles).size).toBe(3)
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('a level 1 row shows its full name where it fits in the grid, whatever the terminal’s name column holds', async ($, on) => {
  await realWorld($, on)
  for (const columns of [58, 60, 61]) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: columns } })
    const tree = await ui.drawn()
    const row = gridRowWith(tree, 'row-system')!
    const label = String(nodesOf(row).find(node => node.type === 'Button')?.props?.label)
    const full = 'System prompt and built-in tools'
    expect({ columns, fits: cellWidth(full) + BUTTON_PAD_CELLS <= nameRoomOf(row, gridCells(columns)) }).toEqual({ columns, fits: true })
    expect({ columns, label }).toEqual({ columns, label: full })
    await ui.unmount()
  }
  // In a pane too narrow for the short name, the short name is cut: the label is never empty.
  const narrow = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 10 } })
  const labels = nodesOf(await narrow.drawn())
    .filter(node => node.type === 'Button' && String(node.props?.key).startsWith('row-'))
    .map(node => String(node.props?.label))
  expect(labels.length).toBeGreaterThan(3)
  expect(labels.filter(label => label === '')).toEqual([])
  await narrow.unmount()
})
