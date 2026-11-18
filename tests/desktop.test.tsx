// The desktop surface: the band is one Client (barclient.tsx), and a pane row
// is a Button holding the name, with its figures in Texts beside it.

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { targetAt } from '../hooks/barclient'
import type { BarClientProps, BarRun } from '../hooks/barclient'
import { desktopHotkeyOf } from '../hooks/pane'
import { HOTKEY_CELLS } from '../hooks/table'
import { DARK } from '../hooks/palette'
import { cellWidth } from '../hooks/text'
import { BAND, CHAT, FOCUSED_PANE, NOTES, PANE, PROJECT_MD, PROJECT_TEXT, richUsage, realSession, world } from './fixtures'

const START = { cwd: '/home/user/project', surface: 'terminal', isInteractive: true } as const
const WIDE = { ...BAND, props: { ...BAND.props, bodyColumns: 100 } } as const
const CLIENT = 'context-bar'

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (x: unknown): x is Node => typeof x === 'object' && x !== null && 'type' in x
const textOf = (x: unknown): string =>
  typeof x === 'string' ? x : isNode(x) ? (x.children ?? []).map(textOf).join('') : ''

/** The Client element of a desktop band, with the props it was given. */
async function clientOf(ui: { drawn: () => Promise<unknown> }) {
  const tree = (await ui.drawn()) as Node

  expect(tree.type).toBe('Client')

  return tree.props as { key: string; module: string; props: BarClientProps }
}

/** The terminal band's visible text: its flow, without the chips laid over it. */
async function terminalRowText(ui: { drawn: () => Promise<unknown> }): Promise<string> {
  const tree = (await ui.drawn()) as Node

  return (tree.children ?? [])
    .filter(isNode)
    .filter(child => !(child.type === 'Box' && child.props?.position === 'absolute'))
    .map(textOf)
    .join('')
}

/** The run that draws a segment, found by its colour: the part index it targets. */
function targetOfColor(runs: readonly BarRun[], color: string): number {
  const run = runs.find(one => one.color === color && typeof one.target === 'number')

  expect(run).toBeDefined()

  return run!.target as number
}

async function measured($: Engine, on: On) {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  return w
}

test('the desktop band is one Client with the terminal row’s text, split into runs by what a click opens', async ($, on) => {
  await measured($, on)
  const terminal = await $.ui.mount({ ...WIDE, surface: 'terminal' })
  const desktop = await $.ui.mount({ ...WIDE, surface: 'desktop' })

  const client = await clientOf(desktop)
  expect(client.key).toBe(CLIENT)
  expect(client.module).toMatch(/barclient\.tsx$/)
  // No segment Button and no picture: the one Client draws the row.
  expect(await desktop.findAll({ type: 'Button' })).toEqual([])
  expect(await desktop.findAll({ type: 'Svg' })).toEqual([])
  expect(await desktop.findAll({ type: 'Client' })).toHaveLength(1)

  const { runs } = client.props
  // The same cells and words as the terminal's row.
  expect(runs.map(run => run.text).join('')).toBe(await terminalRowText(terminal))
  // Each segment's colour targets a part; the six segments make four cells here.
  const targets = ['system', 'project-instructions', 'tool-results', 'claude-output'].map(id =>
    targetOfColor(runs, DARK.segments[id as keyof typeof DARK.segments]),
  )
  expect(new Set(targets).size).toBe(4)
  // The parts of one segment all point at it: the fill and the edge cell.
  const toolTarget = targetOfColor(runs, DARK.segments['tool-results'])
  const toolRuns = runs.filter(run => run.target === toolTarget)
  expect(toolRuns.length).toBeGreaterThan(1)
  expect(toolRuns.every(run => run.color === DARK.segments['tool-results'])).toBe(true)
  // Free space and reserve open nothing.
  expect(runs.find(run => run.color === DARK.free)?.target).toBeNull()
  expect(runs.find(run => run.color === DARK.reserve)?.target).toBeNull()
  // The total opens level 1; its text is the terminal's total, dim.
  const total = runs.filter(run => run.target === 'total')
  expect(total.map(run => run.text.trim())).toEqual(['66k/200k 33%'])
  expect(total[0]?.dimColor).toBe(true)
  // The legend's swatch and words are marked as legend, so a hover can replace them.
  expect(runs.filter(run => run.isLegend === true).map(run => run.text)).toEqual(['▉', ' Tool results 45%'])
  expect(runs.find(run => run.isLegend === true)?.color).toBe(DARK.segments['tool-results'])
  expect(runs.filter(run => run.isLegend !== true && run.text.includes('Tool results'))).toEqual([])

  await terminal.unmount()
  await desktop.unmount()
})

test('the desktop band’s hover texts name the segments and never outgrow the legend', async ($, on) => {
  await measured($, on)

  for (const bodyColumns of [55, 60, 80, 100, 160]) {
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns } })
    const { runs, hovers } = (await clientOf(ui)).props
    const legend = runs.filter(run => run.isLegend === true)
    const room = legend.reduce((sum, run) => sum + cellWidth(run.text), 0)

    expect(legend.length).toBeGreaterThan(0)
    expect(Object.keys(hovers).length).toBeGreaterThan(0)
    for (const [index, text] of Object.entries(hovers)) {
      // The text takes the legend's place: it must fit the cells the legend frees.
      expect(cellWidth(text)).toBeLessThanOrEqual(room)
      expect(runs.some(run => run.target === Number(index))).toBe(true)
    }
    await ui.unmount()
  }

  // Wide: a segment says its name and tokens in full.
  const wide = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns: 160 } })
  const { runs, hovers } = (await clientOf(wide)).props
  expect(hovers[String(targetOfColor(runs, DARK.segments['claude-output']))]).toBe('Claude output 8k')
  expect(hovers[String(targetOfColor(runs, DARK.segments.system))]).toBe('System 20k')
  await wide.unmount()

  // No room for a legend, so none for a name: nothing replaces anything.
  const narrow = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns: 54 } })
  const bare = (await clientOf(narrow)).props
  expect(bare.runs.some(run => run.isLegend === true)).toBe(false)
  expect(bare.hovers).toEqual({})
  await narrow.unmount()
})

test('the Client module draws the runs, swaps the legend for a name under the pointer, and posts a click', async ($, on) => {
  await measured($, on)
  const ui = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  const { runs, hovers } = (await clientOf(ui)).props
  const claude = targetOfColor(runs, DARK.segments['claude-output'])
  const column = (target: BarRun['target']) => {
    let start = 0
    for (const run of runs) {
      if (run.target === target) {
        return start
      }
      start += [...run.text].length
    }
    throw new Error('no run')
  }
  const drawnText = async () => (await ui.findAll({ type: 'Text', in: CLIENT })).map(text => text.text).join('')

  expect(await drawnText()).toBe(runs.map(run => run.text).join(''))
  expect(await drawnText()).toContain('Tool results 45%')

  await ui.pointer({ type: 'move', x: column(claude), y: 0 })
  const hovered = await drawnText()
  expect(hovered).toContain(hovers[String(claude)]!)
  expect(hovered).not.toContain('Tool results 45%')
  // The total stays while a name shows.
  expect(hovered).toContain('66k/200k 33%')

  await ui.pointer({ type: 'leave', x: 0, y: 0 })
  expect(await drawnText()).toContain('Tool results 45%')
  await ui.unmount()
})

test('a click posted from the band opens the pane; the total opens level 1', async ($, on) => {
  const w = world(on)
  w.usage = richUsage()
  w.messages = CHAT
  w.files = { [NOTES]: 'alpha\nbeta\n', [PROJECT_MD]: `${PROJECT_TEXT}\n` }
  await $.session.start(START)
  await w.clock.advance(0)
  const band = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  const { runs } = (await clientOf(band)).props
  const keysOf = async (ui: { findAll: (q: { type: string }) => Promise<{ key?: string }[]> }, prefix: string) =>
    (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith(prefix))
  const pane = async () => {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
    const out = { rows: await keysOf(ui, 'row-'), items: await keysOf(ui, 'item-') }
    await ui.unmount()

    return out
  }

  // Claude output is a cell of its own: a click opens its items (level 2).
  const claude = targetOfColor(runs, DARK.segments['claude-output'])
  await band.post({ open: claude }, { in: CLIENT })
  expect(w.opened).toEqual(['context-breakdown'])
  const items = await pane()
  expect(items.items.length).toBeGreaterThan(0)
  expect(items.rows).toEqual([])

  // The total opens the overview: segment rows, no items.
  await band.post({ open: 'total' }, { in: CLIENT })
  expect(w.opened).toEqual(['context-breakdown', 'context-breakdown'])
  const overview = await pane()
  expect(overview.items).toEqual([])
  expect(overview.rows).toContain('row-tool-results')

  // Nothing opens for a part that is not a segment, or an index that is not a part.
  await band.post({ open: 99 }, { in: CLIENT })
  await band.post({ nothing: true }, { in: CLIENT })
  expect(w.opened).toHaveLength(2)
  await band.unmount()
})

test('a click on a merged cell opens level 1, not one member’s items', async ($, on) => {
  const w = await measured($, on)
  const band = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  const { runs } = (await clientOf(band)).props

  // The task report is merged into the tool results here: the cell holds two segments.
  const merged = targetOfColor(runs, DARK.segments['tool-results'])
  await band.post({ open: merged }, { in: CLIENT })
  expect(w.opened).toEqual(['context-breakdown'])
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  const keys = (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '')
  expect(keys.filter(key => key.startsWith('item-'))).toEqual([])
  expect(keys).toContain('row-tool-results')
  await ui.unmount()
  await band.unmount()
})

test('targetAt maps a column to the target of the run that covers it', () => {
  const runs: BarRun[] = [
    { text: '███', target: 0 },
    { text: '▉', target: 0 },
    { text: '▉', target: 1 },
    { text: '··', target: null },
    { text: ' 9k/20k', target: 'total' },
    { text: ' · ', target: null, isLegend: true },
  ]

  expect([0, 2, 3].map(x => targetAt(runs, x))).toEqual([0, 0, 0])
  expect(targetAt(runs, 4)).toBe(1)
  expect(targetAt(runs, 5)).toBeNull()
  expect(targetAt(runs, 6)).toBeNull()
  // The total's text starts at column 7 and is 7 cells wide.
  expect(targetAt(runs, 7)).toBe('total')
  expect(targetAt(runs, 13)).toBe('total')
  expect(targetAt(runs, 14)).toBeNull()
  // Past the last run, and before the first, nothing.
  expect(targetAt(runs, 17)).toBeNull()
  expect(targetAt(runs, -1)).toBeNull()
  expect(targetAt([], 0)).toBeNull()
  // A character is a cell, a surrogate pair too.
  expect(targetAt([{ text: '😀a', target: 3 }, { text: 'b', target: 4 }], 1)).toBe(3)
})

/** A desktop row: the Box that holds the Button keyed `key`. */
function rowBoxOf(tree: unknown, key: string): Node | undefined {
  if (!isNode(tree)) {
    return undefined
  }
  const kids = (tree.children ?? []).filter(isNode)
  if (tree.type === 'Box' && kids.some(kid => kid.type === 'Box' && (kid.children ?? []).some(c => isNode(c) && c.props?.key === key))) {
    return tree
  }
  for (const kid of kids) {
    const found = rowBoxOf(kid, key)
    if (found !== undefined) {
      return found
    }
  }

  return undefined
}

test('a desktop pane row is the name in a Button, then a mono bar and figures beside it', async ($, on) => {
  await measured($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  const tree = await ui.drawn()

  const button = await ui.find({ key: 'row-tool-results' })
  // The Button carries the name and its hotkey, and nothing else: a desktop
  // draws a Button as its label alone.
  expect(button?.props.label).toBe('Tool results')
  expect(button?.props.hotkey).toBe('4')
  expect(button?.props.plain).toBe(true)
  expect(button?.children).toEqual([])

  const row = rowBoxOf(tree, 'row-tool-results')!
  expect(row.props?.flexDirection).toBe('row')
  const parts = (row.children ?? []).filter(isNode)
  const bar = parts[parts.length - 1]!
  // The last part is a mono Text of the bar and the figures.
  expect(bar.type).toBe('Text')
  expect(bar.props?.mono).toBe(true)
  expect(textOf(bar)).toMatch(/^ █+ +30k +45%$/)
  const runs = (bar.children ?? []).filter(isNode)
  // The bar keeps the segment colour (whole blocks on their own colour), and
  // swaps nothing: no hover overrides to un-invert it.
  const fill = runs.find(run => /^█+$/.test(textOf(run)))!
  expect(fill.props).toMatchObject({ mono: true, color: DARK.segments['tool-results'], backgroundColor: DARK.segments['tool-results'] })
  expect(runs.every(run => (run as { hover?: unknown }).hover === undefined)).toBe(true)
  // The figures stand in their own tabular Text.
  expect(runs.find(run => /30k/.test(textOf(run)))?.props).toMatchObject({ mono: true, tabular: true })
  // The mod draws no digit of its own: the native button draws the hotkey
  // as a key cap before the label, in the cells the name's Box adds for it.
  expect(textOf(row)).not.toMatch(/\d: /)
  const nameBox = parts.find(holdsButton)!
  expect((nameBox.children ?? []).filter(isNode).map(part => part.type)).toEqual(['Button'])
  expect(nameBox.props?.width).toBeGreaterThanOrEqual(HOTKEY_CELLS + cellWidth('Tool results'))

  // The key line lists the hotkeys while the pane has the keyboard.
  expect(await ui.find({ type: 'Text', text: '⏎ or 1-9: Open' })).toBeDefined()
  const focusedRow = withoutHandles(row)
  await ui.unmount()

  // Without the keyboard the row keeps its hotkey, so the key cap stays; a
  // hotkey presses only while the pane holds the keys. The row is the same.
  const idle = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const idleButton = await idle.find({ key: 'row-tool-results' })
  expect(idleButton?.props.hotkey).toBe('4')
  expect(idleButton?.props.label).toBe('Tool results')
  expect(withoutHandles(rowBoxOf(await idle.drawn(), 'row-tool-results')!)).toEqual(focusedRow)
  await idle.unmount()
})

test('desktop segment rows keep their names whole in a narrow pane, figures beside them', async ($, on) => {
  await measured($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 24 } })

  expect((await ui.find({ key: 'row-system' }))?.props.label).toBe('System')
  expect((await ui.find({ key: 'row-skills-agents' }))?.props.label).toBe('Skills/agents')
  const row = rowBoxOf(await ui.drawn(), 'row-system')!
  // The Button names it; the swatch and figures stand in the row beside the Button.
  expect(textOf(row)).toMatch(/20k$/)
  expect(textOf(row)).not.toContain('System')
  // Too narrow for hotkeys (table.ts): no key cap and no cells kept for one.
  expect((await ui.find({ key: 'row-system' }))?.props.hotkey).toBeUndefined()
  const nameBox = (row.children ?? []).filter(isNode).find(holdsButton)!
  expect((nameBox.children ?? []).filter(isNode).map(part => part.type)).toEqual(['Button'])
  expect(textOf(row)).not.toMatch(/^ {3}/)
  await ui.unmount()
})

test('desktop item rows: the Button holds the title; the detail, bar and figures stand beside it', async ($, on) => {
  const w = world(on)
  const real = realSession()
  w.usage = real.usage
  w.messages = real.messages
  await $.session.start(START)
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
  await ui.press({ key: 'row-tool-results' })

  const item = await ui.find({ key: 'item-r:real0' })
  expect(item?.props.label).toBe('Read')
  expect(item?.props.hotkey).toBe('1')
  expect(item?.children).toEqual([])

  const row = rowBoxOf(await ui.drawn(), 'item-r:real0')!
  // No digit of the mod's: the key cap is the native button's.
  expect(textOf(row)).toMatch(/^ *~\/project\/src\/module-1\.ts +█+ +31k +27%$/)
  expect(textOf(row)).not.toContain('Read')
  const parts = (row.children ?? []).filter(isNode)
  const rest = (parts[parts.length - 1]!.children ?? []).filter(isNode)
  // The detail is dim; the bar is in the segment's colour; the figures are tabular.
  expect(rest.find(run => textOf(run).includes('module-1.ts'))?.props?.dimColor).toBe(true)
  expect(rest.find(run => /^█+$/.test(textOf(run)))?.props?.color).toBe(DARK.segments['tool-results'])
  expect(rest.find(run => /31k/.test(textOf(run)))?.props?.tabular).toBe(true)

  // A row with no detail (a Bash call's command is its detail) still names itself by its title.
  expect((await ui.find({ key: 'item-r:real2' }))?.props.label).toBe('Bash')
  // The tenth item has no hotkey: blank cells in the cap's place, inside the name's Box.
  expect((await ui.find({ key: 'item-r:real9' }))?.props.hotkey).toBeUndefined()
  expect(textOf(rowBoxOf(await ui.drawn(), 'item-r:real9')!)).toMatch(/^ {3}/)

  await ui.press({ key: 'item-r:real0' })
  expect(await ui.find({ type: 'Code' })).toBeDefined()
  await ui.unmount()
})

test('the widget seat still shows a glance with no Button and no Client', async ($, on) => {
  await measured($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement: 'widget', bodyColumns: 100 } })

  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  expect(await ui.findAll({ type: 'Client' })).toEqual([])
  // The bar is the picture, with the total and the legend in the code font.
  expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThanOrEqual(2)
  expect((await ui.find({ type: 'Text', text: /66k\/200k 33%/ }))?.text.trim()).toBe('66k/200k 33%')
  expect(await ui.find({ type: 'Text', text: 'Tool results 45%' })).toBeDefined()
  await ui.unmount()
})

/** Cells a desktop row part takes: a Box its width, a Text its text. */
function cellsOf(part: Node): number {
  return typeof part.props?.width === 'number' ? part.props.width : cellWidth(textOf(part))
}

/** A drawn tree without the press handles, which each drawing numbers anew. */
function withoutHandles(tree: unknown): unknown {
  return JSON.parse(JSON.stringify(tree, (key, value: unknown) => (key === 'press' ? undefined : value)))
}

/** A drawn tree without the press handles and the focus ring. */
function withoutRing(tree: unknown): unknown {
  return JSON.parse(JSON.stringify(tree, (key, value: unknown) => (key === 'press' || key === 'autoFocus' ? undefined : value)))
}

/** Whether `part` is the Box that holds a row's Button. */
const holdsButton = (part: Node) => part.type === 'Box' && (part.children ?? []).some(c => isNode(c) && c.type === 'Button')

/**
 * Where a desktop row's parts stand: the cells before the name's Box, that
 * Box's width, and the column where the bar and figures start. Also checks
 * that every part outside the Button asks for the code font itself.
 */
function columnsOf(row: Node) {
  const parts = (row.children ?? []).filter(isNode)
  const at = parts.findIndex(holdsButton)
  expect(at).toBeGreaterThanOrEqual(0)
  for (const part of parts.filter((_, index) => index !== at)) {
    const texts = part.type === 'Text' ? [part] : (part.children ?? []).filter(isNode)
    expect(texts.length).toBeGreaterThan(0)
    expect(texts.every(text => text.type === 'Text' && text.props?.mono === true)).toBe(true)
  }
  const before = parts.slice(0, at).reduce((sum, part) => sum + cellsOf(part), 0)
  const name = parts[at]!.props?.width as number

  return { kinds: parts.map(part => part.type), before, name, rest: before + name }
}

test('desktop rows keep their parts and columns when Esc takes the keys and a click gives them back', async ($, on) => {
  const w = world(on)
  const real = realSession()
  w.usage = real.usage
  w.messages = real.messages
  await $.session.start(START)
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
  const columns = async (keys: readonly string[]) => {
    const tree = await ui.drawn()

    return keys.map(key => columnsOf(rowBoxOf(tree, key)!))
  }
  const states = async (keys: readonly string[]) => {
    const focused = await columns(keys)
    const firstTree = await ui.drawn()
    const focusedRows = keys.map(key => withoutRing(rowBoxOf(firstTree, key)!))
    await ui.redraw({ ...PANE.props, bodyColumns: 88 })
    const idle = await columns(keys)
    // Each row's drawn tree is the same in both states, the ring apart.
    const idleTree = await ui.drawn()
    expect(keys.map(key => withoutRing(rowBoxOf(idleTree, key)!))).toEqual(focusedRows)
    await ui.redraw({ ...FOCUSED_PANE.props, bodyColumns: 88 })
    const again = await columns(keys)
    // The same parts in the same columns in both states, and the same tree after a click.
    expect(idle).toEqual(focused)
    expect(again).toEqual(focused)
    expect(withoutHandles(await ui.drawn())).toEqual(withoutHandles(firstTree))

    return focused
  }

  // Level 1: the name's Box (key cap and name), then the bar and figures;
  // every row in the same columns.
  const segments = await states(['row-system', 'row-tool-results', 'row-claude-output'])
  expect(new Set(segments.map(row => JSON.stringify(row))).size).toBe(1)
  expect(segments[0]!.before).toBe(0)

  // Level 2: a row with a key cap and the tenth row, which has none, keep
  // their name's Box as wide: the tenth fills the cap's cells with blanks.
  await ui.press({ key: 'row-tool-results' })
  const items = await states(['item-r:real0', 'item-r:real8', 'item-r:real9'])
  expect(items.map(row => row.before)).toEqual([0, 0, 0])
  expect(new Set(items.map(row => row.name)).size).toBe(1)
  expect((await ui.find({ key: 'item-r:real9' }))?.props.hotkey).toBeUndefined()
  expect((await ui.find({ key: 'item-r:real8' }))?.props.hotkey).toBe('9')
  const tree = await ui.drawn()
  const inner = (key: string) => ((rowBoxOf(tree, key)!.children ?? []).filter(isNode).find(holdsButton)!.children ?? []).filter(isNode)
  expect(inner('item-r:real8').map(part => part.type)).toEqual(['Button'])
  expect(inner('item-r:real9').map(part => part.type)).toEqual(['Text', 'Button'])
  expect(textOf(inner('item-r:real9')[0])).toBe(' '.repeat(HOTKEY_CELLS))
  // The bar starts where the title and its dim detail end: one column for every row.
  const barStart = (key: string) => {
    const parts = (rowBoxOf(tree, key)!.children ?? []).filter(isNode)
    const rest = (parts[parts.length - 1]!.children ?? []).filter(isNode)
    const detail = cellWidth(textOf(rest[0]))

    return columnsOf(rowBoxOf(tree, key)!).rest + detail
  }
  expect(new Set(['item-r:real0', 'item-r:real8', 'item-r:real9'].map(barStart)).size).toBe(1)
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('a desktop row in a narrow pane keeps its swatch in one place in both states', async ($, on) => {
  await measured($, on)
  // 32 columns: hotkeys, and a swatch where there is no room for a length bar.
  // The swatch comes first; the key cap is inside the name's Box after it.
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 32 } })
  const focused = columnsOf(rowBoxOf(await ui.drawn(), 'row-system')!)
  expect(focused.kinds).toEqual(['Text', 'Text', 'Box', 'Text'])
  expect((await ui.find({ key: 'row-system' }))?.props.hotkey).toBe('1')
  await ui.redraw({ ...PANE.props, bodyColumns: 32 })
  expect(columnsOf(rowBoxOf(await ui.drawn(), 'row-system')!)).toEqual(focused)
  await ui.unmount()
})

test('desktopHotkeyOf: the first nine rows that open get 1-9, in a pane wide enough for hotkeys', () => {
  expect([0, 3, 8].map(index => desktopHotkeyOf(HOTKEY_CELLS, index))).toEqual(['1', '4', '9'])
  // The tenth row, and a row that does not open, get none.
  expect(desktopHotkeyOf(HOTKEY_CELLS, 9)).toBeUndefined()
  expect(desktopHotkeyOf(HOTKEY_CELLS, null)).toBeUndefined()
  // Too narrow for hotkeys: none.
  expect(desktopHotkeyOf(0, 0)).toBeUndefined()
})

test('the desktop key line keeps one set of controls in one order when Esc takes the keys', async ($, on) => {
  const w = world(on)
  w.usage = richUsage()
  w.messages = CHAT
  w.files = { [NOTES]: 'alpha\nbeta\n', [PROJECT_MD]: `${PROJECT_TEXT}\n` }
  await $.session.start(START)
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  const line = async () => (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => !/^(row|item)-/.test(key))
  const words = async () => (await ui.findAll({ type: 'Text', text: /: (Move|Open)$/ })).map(text => text.text)
  const hint = async () => (await ui.find({ type: 'Text', text: 'Click the pane for keys' })) !== undefined
  const hotkeys = async () =>
    (await ui.findAll({ type: 'Button' })).filter(button => !/^(row|item)-/.test(button.key ?? '')).map(button => button.props.hotkey)
  const check = async () => {
    const keys = await line()
    const said = await words()
    const caps = await hotkeys()
    expect(await hint()).toBe(false)
    expect(caps).toHaveLength(keys.length)
    await ui.redraw({ ...PANE.props })
    expect(await line()).toEqual(keys)
    expect(await words()).toEqual(said)
    // The one row Esc adds: the hint. Every control keeps its hotkey, so its key cap stays.
    expect(await hint()).toBe(true)
    expect(await hotkeys()).toEqual(caps)
    await ui.redraw({ ...FOCUSED_PANE.props })
    expect(await line()).toEqual(keys)
    expect(await hotkeys()).toEqual(caps)

    return keys
  }
  expect(await check()).toEqual(['list-down', 'list-up', 'back', 'close', 'refresh'])
  await ui.press({ key: 'row-tool-results' })
  expect(await check()).toEqual(['list-down', 'list-up', 'back', 'sort', 'prev', 'next', 'close', 'refresh'])
  await ui.press({ key: 'item-r:tu2' })
  expect((await check()).slice(0, 2)).toEqual(['scroll-down', 'scroll-up'])
  await ui.unmount()
})
