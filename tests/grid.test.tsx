// The pane off the terminal (grid.tsx): one face, one grid of fixed columns,
// pictures for the colours, no hotkey on a row, and a defined place for
// every state.

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  BAR_CELLS,
  BAR_NARROW_CELLS,
  FIGURE_CELLS,
  GRID_MAX_CELLS,
  LABEL_PAD_CELLS,
  LEAD_CELLS,
  OPEN_WORDS,
  SWATCH_ALT,
  barCells,
  fittedDetail,
  fittedTitle,
  gridCells,
} from '../hooks/grid'
import { DARK, LIGHT } from '../hooks/palette'
import { LENGTH_BAR_HEIGHT, MEASURED_CELL_PX, lengthBarPicture, swatchPicture, windowBarPicture } from '../hooks/svgbar'
import { tableLayout } from '../hooks/table'
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

test('off the terminal no Text of the pane asks for the monospaced face; every figure is tabular', async ($, on) => {
  await realWorld($, on)
  for (const surface of GRID_SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
    const check = async (where: string) => {
      const tree = await ui.drawn()
      expect({ where, mono: nodesOf(tree).filter(node => node.props?.mono === true).length }).toEqual({ where, mono: 0 })
      // A figure stands in a column of whole cells, right-aligned, in a tabular Text.
      for (const row of gridRowsOf(tree)) {
        for (const column of rightColumns(row).filter(part => part.props?.width === FIGURE_CELLS)) {
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
  await ui.unmount()
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
  const figures = (title.children ?? []).filter(isNode)[1]!
  expect([textOf(figures), figures.props?.dimColor]).toEqual(['114k · 40% of used', true])
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
  expect((title?.children ?? []).filter(isNode).map(node => node.type)).toEqual(['Svg', 'Text'])
  const words = (title?.children ?? []).filter(isNode)[1]!
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

test('gridCells and barCells: the grid stops at its cap; the bar is shorter in a narrower grid and gone where the table drops it', () => {
  expect([24, 46, 66, 100, 200].map(gridCells)).toEqual([22, 44, 64, 64, 64])
  expect(barCells(tableLayout(100, 32), gridCells(100))).toBe(BAR_CELLS)
  expect(barCells(tableLayout(46, 32), gridCells(46))).toBe(BAR_NARROW_CELLS)
  expect(barCells(tableLayout(24, 32), gridCells(24))).toBe(0)
  expect(LEAD_CELLS * MEASURED_CELL_PX).toBeGreaterThan(10)
})

test('fittedTitle and fittedDetail: a path keeps its file name; a command is given in full', () => {
  expect(fittedDetail('~/project/src/ledger/balance.go', 20, true)).toBe('…/ledger/balance.go')
  expect(fittedDetail('~/project/src/ledger/balance.go', 40, true)).toBe('~/project/src/ledger/balance.go')
  expect(fittedDetail('go test ./src/ledger/... -run TestBalance -v', 20, false)).toBe('go test ./src/ledger/... -run TestBalance -v')
  expect(fittedTitle('~/.claude/projects/x/memory/MEMORY.md', 16, true).endsWith('MEMORY.md')).toBe(true)
  expect(fittedTitle('mcp__claude-in-chrome__computer', 12, false)).toBe('mcp__claude…')
  expect(fittedTitle('Read', 12, false)).toBe('Read')
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
  // A part with no tokens draws nothing.
  expect(windowBarPicture([{ kind: 'reserve', color: '#000000', tokens: 0, texture: 'shaded' }], 100)).not.toContain('url(#t0)')
  expect(lengthBarPicture(0, 100, '#123456', 44)).not.toContain('#123456')
  expect(lengthBarPicture(1, 1_000_000, '#123456', 44)).toContain('<rect width="2" height="6"')
  expect(lengthBarPicture(100, 100, '#123456', 44)).toContain(`<rect width="44" height="${LENGTH_BAR_HEIGHT}"`)
  expect(swatchPicture('#123456', null)).toContain('fill="#123456"')
  expect(swatchPicture('#123456', 'striped')).toContain('<pattern id="t"')
})
