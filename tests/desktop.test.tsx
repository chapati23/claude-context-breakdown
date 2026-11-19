// The desktop surface: the band is one Client (barclient.tsx), and a pane row
// is a Button holding the name, with its figures in Texts beside it.

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { bandTree } from '../hooks/band'
import { hoveredPart, isFaded, targetAt } from '../hooks/barclient'
import type { BarClientPost, BarClientProps, BarRun } from '../hooks/barclient'
import { desktopHotkeyOf } from '../hooks/pane'
import { HOTKEY_CELLS, TABLE_MAX_COLUMNS } from '../hooks/table'
import { DARK } from '../hooks/palette'
import { cellWidth } from '../hooks/text'
import type { BandModel } from '../hooks/view'
import { BAND, CHAT, FOCUSED_PANE, MESSAGES, NOTES, PANE, PROJECT_MD, PROJECT_TEXT, manyResults, richUsage, realSession, usage, world } from './fixtures'
import type { World } from './fixtures'
import { flatten, mountPane } from './e2e/helpers'
import { level2 } from './e2e/journeys'

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

/** What the Client posts for a click on part `target`: its index and its identity. */
function postOf(props: BarClientProps, target: number): BarClientPost {
  const identity = props.parts[String(target)]

  expect(identity).toBeDefined()

  return { open: target, ...identity! }
}

/** The column where the first run of `target` starts. */
function columnOf(runs: readonly BarRun[], target: BarRun['target']): number {
  let start = 0
  for (const run of runs) {
    if (run.target === target) {
      return start
    }
    start += [...run.text].length
  }
  throw new Error('no run')
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
  const w = await measured($, on)
  const ui = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  const { runs, hovers } = (await clientOf(ui)).props
  const claude = targetOfColor(runs, DARK.segments['claude-output'])
  const column = (target: BarRun['target']) => columnOf(runs, target)
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

  // A left press on a segment posts it, and the hooks module opens the pane.
  await ui.pointer({ type: 'down', x: column(claude), y: 0, button: 'left' })
  expect(w.opened).toEqual(['context-breakdown'])
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
  const props = (await clientOf(band)).props
  const { runs } = props
  const keysOf =async (ui: { findAll: (q: { type: string }) => Promise<{ key?: string }[]> }, prefix: string) =>
    (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith(prefix))
  const pane = async () => {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
    const out = { rows: await keysOf(ui, 'row-'), items: await keysOf(ui, 'item-') }
    await ui.unmount()

    return out
  }

  // Claude output is a cell of its own: a click opens its items (level 2).
  const claude = targetOfColor(runs, DARK.segments['claude-output'])
  await band.post(postOf(props, claude), { in: CLIENT })
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

  // Nothing opens for an index without an identity, an identity no part has, or no index.
  await band.post({ open: claude }, { in: CLIENT })
  await band.post({ open: 99, id: 'mcp', members: ['mcp'] }, { in: CLIENT })
  await band.post({ nothing: true }, { in: CLIENT })
  expect(w.opened).toHaveLength(2)
  await band.unmount()
})

test('a desktop click opens what the desktop bar drew, after the terminal drew its own bar', async ($, on) => {
  const w = await measured($, on)
  const band = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  const props = (await clientOf(band)).props
  const prompts = targetOfColor(props.runs, DARK.segments.prompts)
  // A terminal of the same session draws its bar narrower, after the
  // desktop: there the prompts have no part of their own.
  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 50 } })
  expect(await terminal.find({ key: 'seg-prompts' })).toBeUndefined()

  await band.post(postOf(props, prompts), { in: CLIENT })
  expect(w.opened).toEqual(['context-breakdown'])
  const pane = await mountPane($, 'desktop', { columns: 88, isFocused: true })
  expect(level2(flatten(await pane.drawn(), { surface: 'desktop', columns: 88 })).name).toBe('Your prompts')
  await pane.unmount()
  await terminal.unmount()
  await band.unmount()
})

test('a click on a merged cell opens level 1, not one member’s items', async ($, on) => {
  const w = await measured($, on)
  const band = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  const props = (await clientOf(band)).props

  // The task report is merged into the tool results here: the cell holds two segments.
  const merged = targetOfColor(props.runs, DARK.segments['tool-results'])
  await band.post(postOf(props, merged), { in: CLIENT })
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

test('hoveredPart reads the segment under a column from the runs it is given; isFaded dims the other segments', () => {
  const runs: BarRun[] = [
    { text: '██', target: 0 },
    { text: '█', target: 1 },
    { text: '··', target: null },
    { text: ' 9k', target: 'total' },
  ]
  expect(hoveredPart(runs, null)).toBeNull()
  expect(hoveredPart(runs, 1)).toBe(0)
  expect(hoveredPart(runs, 2)).toBe(1)
  // Free space and the total are no segment.
  expect(hoveredPart(runs, 3)).toBeNull()
  expect(hoveredPart(runs, 6)).toBeNull()
  // After a relayout the same column names the part now under it.
  expect(hoveredPart([{ text: '█', target: 0 }, { text: '██', target: 1 }], 1)).toBe(1)

  expect(isFaded(runs[0]!, 1)).toBe(true)
  expect(isFaded(runs[1]!, 1)).toBe(false)
  expect(isFaded(runs[2]!, 1)).toBe(false)
  expect(isFaded(runs[3]!, 1)).toBe(false)
  expect(isFaded(runs[0]!, null)).toBe(false)
})

/** A new measurement of `messages`, `chars` characters in all. */
async function remeasure($: Engine, w: World, messages: readonly unknown[], chars: number) {
  w.messages = messages
  w.usage = usage(26_000 + chars, chars)
  await $.session.measure({ context: w.usage.context!, rateLimits: [], changed: ['context'] })
  await w.clock.advance(0)
}

/** Longer prompts: their cell grows, so the columns after it shift. */
const longerPrompts = ($: Engine, w: World) =>
  remeasure($, w, [{ role: 'user', content: [{ type: 'text', text: 'p'.repeat(20_000) }] }, ...MESSAGES.slice(1)], 58_100)

/** A skill body: a new cell before the prompts and Claude output, so their indices shift. */
const skillBody = ($: Engine, w: World) =>
  remeasure($, w, [...MESSAGES, { role: 'user', content: [{ type: 'text', text: `Base directory for this skill: ${'s'.repeat(10_000)}` }] }], 50_031)

test('a click posted before a relayout opens the segment it was on, never the part now at its index', async ($, on) => {
  const w = await measured($, on)
  const first = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  const before = (await clientOf(first)).props
  const claude = targetOfColor(before.runs, DARK.segments['claude-output'])
  const old = postOf(before, claude)
  await first.unmount()

  await skillBody($, w)
  const band = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  const after = (await clientOf(band)).props
  // Another segment now stands at the index the click names.
  expect(after.parts[String(claude)]).toBeDefined()
  expect(after.parts[String(claude)]?.id).not.toBe('claude-output')

  await band.post(old, { in: CLIENT })
  expect(w.opened).toEqual(['context-breakdown'])
  const pane = await mountPane($, 'desktop', { columns: 88, isFocused: true })
  expect(level2(flatten(await pane.drawn(), { surface: 'desktop', columns: 88 })).name).toBe('Claude output')
  await pane.unmount()
  await band.unmount()
})

// The test kit cannot raise `ui.fault`, so this asks `bandTree` directly,
// with an element table whose every element returns its tag and props.
test('after the bar Client failed, bandTree draws the desktop bar as the picture row with the total as a Button', () => {
  type Drawn = { type: string; props: Record<string, unknown> & { children?: unknown } }
  const ui = new Proxy({}, { get: (_, type) => (props: Drawn['props']) => ({ type: String(type), props }) }) as never
  const model: BandModel = {
    label: '9k/20k 45%',
    legend: null,
    parts: [{ kind: 'segment', id: 'system', members: ['system'], tokens: 9000, cells: 4 }, { kind: 'free', cells: 4 }],
    chips: [],
  }
  const opened: unknown[] = []
  const draw = (clientFailed: boolean) =>
    bandTree(ui, model, DARK, part => opened.push(part), null, { tokensOf: () => 9000, used: 9000 }, 'desktop', clientFailed) as unknown as Drawn
  const all = (node: unknown): Drawn[] => {
    if (Array.isArray(node)) {
      return node.flatMap(all)
    }
    if (typeof node !== 'object' || node === null || !('type' in node)) {
      return []
    }
    const drawn = node as Drawn

    return [drawn, ...all(drawn.props.children)]
  }

  expect(draw(false).type).toBe('Client')
  const fallback = all(draw(true))
  expect(fallback.filter(node => node.type === 'Client')).toEqual([])
  expect(fallback.filter(node => node.type === 'Svg').length).toBeGreaterThan(0)
  const total = fallback.find(node => node.type === 'Button' && node.props.key === 'context-total')
  expect(total).toBeDefined()
  ;(total!.props.onPress as () => void)()
  expect(opened).toEqual([null])
})

test('the Client names the segment under the pointer after a relayout, not the part that was there', async ($, on) => {
  const w = await measured($, on)
  const ui = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  const before = (await clientOf(ui)).props
  const x = columnOf(before.runs, targetOfColor(before.runs, DARK.segments['claude-output']))
  await ui.pointer({ type: 'move', x, y: 0 })

  await longerPrompts($, w)
  const after = (await clientOf(ui)).props
  const now = hoveredPart(after.runs, x)
  const drawn = (await ui.findAll({ type: 'Text', in: CLIENT })).map(text => text.text).join('')
  expect(now).not.toBeNull()
  expect(drawn).toContain(after.hovers[String(now)]!)
  await ui.unmount()
})

test('an enter names no segment until a move places the pointer', async ($, on) => {
  await measured($, on)
  const ui = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  const { runs, hovers } = (await clientOf(ui)).props
  const claude = targetOfColor(runs, DARK.segments['claude-output'])
  const drawnText = async () => (await ui.findAll({ type: 'Text', in: CLIENT })).map(text => text.text).join('')

  await ui.pointer({ type: 'move', x: columnOf(runs, claude), y: 0 })
  await ui.pointer({ type: 'leave', x: columnOf(runs, claude), y: 0 })
  // The enter carries the column the last move reported, wherever the pointer came back in.
  await ui.pointer({ type: 'enter', x: columnOf(runs, claude), y: 0 })
  expect(await drawnText()).not.toContain(hovers[String(claude)]!)
  expect(await drawnText()).toContain('Tool results 45%')
  await ui.unmount()
})

test('with no room for a name, the pointer on a segment still dims the other segments', async ($, on) => {
  await measured($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns: 54 } })
  const { runs, hovers } = (await clientOf(ui)).props
  expect(hovers).toEqual({})
  const pointed = targetOfColor(runs, DARK.segments['claude-output'])

  await ui.pointer({ type: 'move', x: columnOf(runs, pointed), y: 0 })
  const drawn = await ui.findAll({ type: 'Text', in: CLIENT })
  expect(drawn.map(text => text.text)).toEqual(runs.map(run => run.text))
  runs.forEach((run, index) => {
    if (typeof run.target === 'number') {
      expect(drawn[index]?.props.dimColor === true).toBe(run.target !== pointed)
    }
  })
  await ui.unmount()
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
  expect(await ui.find({ type: 'Text', text: '⏎ 1-9: Open' })).toBeDefined()
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
  // The tenth item has 0; the eleventh has no hotkey: blank cells in the cap's place, inside the name's Box.
  expect((await ui.find({ key: 'item-r:real9' }))?.props.hotkey).toBe('0')
  expect((await ui.find({ key: 'item-r:real10' }))?.props.hotkey).toBeUndefined()
  expect(textOf(rowBoxOf(await ui.drawn(), 'item-r:real10')!)).toMatch(/^ {3}/)

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

  // Level 2: a row with a key cap and the eleventh row, which has none, keep
  // their name's Box as wide: the eleventh fills the cap's cells with blanks.
  await ui.press({ key: 'row-tool-results' })
  const items = await states(['item-r:real0', 'item-r:real9', 'item-r:real10'])
  expect(items.map(row => row.before)).toEqual([0, 0, 0])
  expect(new Set(items.map(row => row.name)).size).toBe(1)
  expect((await ui.find({ key: 'item-r:real10' }))?.props.hotkey).toBeUndefined()
  expect((await ui.find({ key: 'item-r:real9' }))?.props.hotkey).toBe('0')
  const tree = await ui.drawn()
  const inner = (key: string) => ((rowBoxOf(tree, key)!.children ?? []).filter(isNode).find(holdsButton)!.children ?? []).filter(isNode)
  expect(inner('item-r:real9').map(part => part.type)).toEqual(['Button'])
  expect(inner('item-r:real10').map(part => part.type)).toEqual(['Text', 'Button'])
  expect(textOf(inner('item-r:real10')[0])).toBe(' '.repeat(HOTKEY_CELLS))
  // The bar starts where the title and its dim detail end: one column for every row.
  const barStart = (key: string) => {
    const parts = (rowBoxOf(tree, key)!.children ?? []).filter(isNode)
    const rest = (parts[parts.length - 1]!.children ?? []).filter(isNode)
    const detail = cellWidth(textOf(rest[0]))

    return columnsOf(rowBoxOf(tree, key)!).rest + detail
  }
  expect(new Set(['item-r:real0', 'item-r:real9', 'item-r:real10'].map(barStart)).size).toBe(1)
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

test('desktopHotkeyOf: the first nine rows that open get 1-9 and the tenth 0, in a pane wide enough for hotkeys', () => {
  expect([0, 3, 8, 9].map(index => desktopHotkeyOf(HOTKEY_CELLS, index))).toEqual(['1', '4', '9', '0'])
  // The eleventh row, and a row that does not open, get none.
  expect(desktopHotkeyOf(HOTKEY_CELLS, 10)).toBeUndefined()
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
  // No Down and Up at any level: Tab moves the ring along the rows, and the
  // app scrolls the text. The key words name Enter and the digits. A control
  // that cannot apply here leaves the line; off the terminal nothing takes
  // its key. Close is last.
  expect(await check()).toEqual(['refresh', 'close'])
  expect(await words()).toEqual(['⏎ 1-9 0: Open'])
  await ui.press({ key: 'row-tool-results' })
  // One page: p and n leave together.
  expect(await check()).toEqual(['back', 'sort', 'refresh', 'close'])
  expect(await words()).toEqual(['⏎ 1-9: Open'])
  // A Bash result has no file: v, c and m leave; p and n stay at level 3.
  await ui.press({ key: 'item-r:tu2' })
  expect(await check()).toEqual(['back', 'prev', 'next', 'format', 'refresh', 'close'])
  await ui.unmount()
})

test('desktop plain lines line up with the rows, and the table stops at its cap', async ($, on) => {
  const w = await measured($, on)
  // One MCP server whose tool is not loaded: a server line under MCP tools.
  const base = usage(66_000)
  const mcpTools = [{ name: 'mcp__tickets__find', serverName: 'tickets', tokens: 4000, isLoaded: false }]
  w.usage = { ...base, context: { ...base.context, breakdown: { ...base.context.breakdown!, mcpTools } } }
  const first = await mountPane($, 'desktop')
  await first.press({ key: 'refresh' })
  await w.clock.advance(0)
  await first.unmount()
  /** The cells of `line` before `text` starts, and up to where it ends. */
  const span = (line: string, text: string) => {
    const at = line.indexOf(text)
    expect(at, `${text} in ${JSON.stringify(line)}`).toBeGreaterThanOrEqual(0)

    return { start: cellWidth(line.slice(0, at)), end: cellWidth(line.slice(0, at + text.length)) }
  }
  const rowsAt: Record<number, string> = {}
  // At 32 columns a swatch leads each row and the key cap follows it.
  for (const columns of [32, 45, 64, 88, 140]) {
    const ui = await mountPane($, 'desktop', { columns })
    // The flattened desktop text draws a key cap as "4: " before the label.
    const lines = flatten(await ui.drawn(), { surface: 'desktop' }).map(line => line.replace(/[⟦⟧⟪⟫⟨⟩]/g, ''))
    const line = (pattern: RegExp) => lines.find(text => pattern.test(text)) ?? ''
    const row = line(/Tool results .*30k/)
    rowsAt[columns] = row
    const name = span(row, 'Tool results').start
    const tokens = span(row, '30k').end
    // Where the row's colour starts: the swatch in a narrow pane, else the length bar.
    const color = cellWidth(row.slice(0, row.search(/[█▉▊▋▌▍▎▏]/)))
    const share = cellWidth(row.trimEnd())
    const where = `${columns} columns`
    // Group headings: the name in the rows' column, the share at the rows' end.
    for (const heading of ['Baseline', 'Conversation']) {
      const text = line(new RegExp(`^ *${heading} `))
      expect({ where, heading, at: span(text, heading).start, end: cellWidth(text.trimEnd()) }).toEqual({ where, heading, at: name, end: share })
    }
    // Free space, Reserve and the Not loaded lines: the name in the rows'
    // column, the tokens at the rows' tokens column.
    for (const [label, figure] of [
      ['Free space', '101k'],
      ['Reserve', '33k'],
      ['MCP tools', '9k'],
    ] as const) {
      // In a narrow pane Free space and Reserve show their glyph in the swatch's place.
      const text = line(new RegExp(`(^|\\s)${label} `))
      expect({ where, label, at: span(text, label).start, end: span(text, figure).end }).toEqual({ where, label, at: name, end: tokens })
    }
    // Free space and Reserve draw the bar's own glyph where a row's colour starts.
    for (const [label, glyph] of [
      ['Free space', '··'],
      ['Reserve', '▒▒'],
    ] as const) {
      expect({ where, label, glyph: span(line(new RegExp(`(^|\\s)${label} `)), glyph).start }).toEqual({ where, label, glyph: color })
    }
    expect({ where, at: span(line(/^ *Not loaded( · outside the window)?$/), 'Not loaded').start }).toEqual({ where, at: name })
    // With a server, MCP tools is a row that opens: a Button with its name and counts, no line per server.
    const label = String((await ui.find({ key: 'row-not-loaded' }))?.props.label)
    expect({ where, label: /^MCP tools( · 1 server(, 1 tool)?)?$/.test(label) }).toEqual({ where, label: true })
    expect({ where, server: line(/tickets/) }).toEqual({ where, server: '' })
    // The row never reaches the pane's edge, and stops at the cap.
    expect({ where, fits: cellWidth(row.trimEnd()) < columns }).toEqual({ where, fits: true })
    expect({ where, capped: cellWidth(row.trimEnd()) <= TABLE_MAX_COLUMNS }).toEqual({ where, capped: true })
    await ui.unmount()
  }
  // A wide pane draws the same row as one at the cap.
  expect(rowsAt[140]).toBe(rowsAt[88])
})

test('a rebuild that puts a new item first keeps the autoFocus key on the row that had it', async ($, on) => {
  const w = world(on)
  w.usage = richUsage()
  w.messages = CHAT
  w.files = { [NOTES]: 'alpha\nbeta\n', [PROJECT_MD]: `${PROJECT_TEXT}\n` }
  await $.session.start(START)
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  await ui.press({ key: 'row-tool-results' })
  const ringed = async () => (await ui.findAll({ type: 'Button' })).filter(button => button.props.autoFocus === true).map(button => button.key)
  const items = async () => (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith('item-'))
  const before = await ringed()
  expect(before).toEqual([(await items())[0]])

  // A new result, the newest and the largest: first in either order.
  w.messages = [
    ...CHAT,
    { role: 'assistant', content: [{ type: 'tool_use', id: 'fresh', name: 'Bash', input: { command: 'seq' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'fresh', content: 'x'.repeat(40_000) }] },
  ]
  await ui.press({ key: 'refresh' })
  await w.clock.advance(0)
  expect((await items())[0]).toBe('item-r:fresh')
  // A desktop moves the focus to a new autoFocus key: the key stays on the row it was on.
  expect(await ringed()).toEqual(before)
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('off the terminal a page or sort change of a list names no row for the focus, until the level changes', async ($, on) => {
  const w = world(on)
  w.usage = richUsage()
  w.messages = manyResults(45)
  await $.session.start(START)
  await w.clock.advance(0)
  const ringed = async (ui: { findAll: (q: { type: string }) => Promise<{ key?: string; props: Record<string, unknown> }[]> }) =>
    (await ui.findAll({ type: 'Button' })).filter(button => button.props.autoFocus === true).map(button => button.key ?? '')

  for (const surface of ['desktop', 'vscode', 'mobile', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    const items = async () => (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith('item-'))
    await ui.press({ key: 'row-tool-results' })
    // A list just opened: its first row asks for the focus.
    expect(await ringed(ui), surface).toEqual([(await items())[0]])

    // Next page: a desktop moves the focus to an element whose autoFocus key
    // is new, so a second Enter on "Next page" would open the first item.
    // Off the terminal no row asks for it, and the focus stays on the control.
    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /page 2 of 3$/ }), surface).toBeDefined()
    expect(await ringed(ui), surface).toEqual(surface === 'terminal' ? [(await items())[0]] : [])
    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /page 3 of 3$/ }), surface).toBeDefined()
    await ui.press({ key: 'sort' })
    expect(await ringed(ui), surface).toEqual(surface === 'terminal' ? [(await items())[0]] : [])

    // A new level names its element again: the item's first control, and
    // after b the row the person came from.
    const opened = (await items())[1]!
    await ui.press({ key: opened })
    expect((await ringed(ui)).length, surface).toBe(1)
    await ui.press({ key: 'back' })
    expect(await ringed(ui), surface).toEqual([opened])

    // The same list opened afresh by `/ctx`, after a page change: its first row asks again.
    await ui.press({ key: 'next' })
    await $.command.run({ command: 'ctx', args: 'tool', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
    expect(await ui.find({ type: 'Text', text: /page 1 of 3$/ }), surface).toBeDefined()
    expect(await ringed(ui), surface).toEqual([(await items())[0]])
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a step to another item keeps the autoFocus key of level 3, so off the terminal the focus stays on the pressed control', async ($, on) => {
  const w = world(on)
  w.usage = richUsage()
  w.messages = CHAT
  w.files = { [NOTES]: 'alpha\nbeta\n' }
  await $.session.start(START)
  await w.clock.advance(0)

  for (const surface of ['desktop', 'vscode', 'mobile', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    const ringed = async () => (await ui.findAll({ type: 'Button' })).filter(button => button.props.autoFocus === true).map(button => button.key)
    // The terminal's first control is j's; elsewhere it is Back.
    const first = surface === 'terminal' ? 'scroll-down' : 'back'
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:tu2' })
    expect(await ringed(), surface).toEqual([first])
    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /^item 2 of 2 · / }), surface).toBeDefined()
    expect(await ringed(), surface).toEqual([first])
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a desktop control that does not apply is drawn dimmer than a live one, with no child', async ($, on) => {
  const w = world(on)
  w.usage = richUsage()
  w.messages = CHAT
  await $.session.start(START)
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  await ui.press({ key: 'row-tool-results' })
  await ui.press({ key: 'item-r:tu2' })
  // The first of two items, of one page: Back is live, Prev item is off (no item before it).
  const back = await ui.find({ key: 'back' })
  const prev = await ui.find({ key: 'prev' })
  // The native button shows its label only and drops a child: `dimColor` on
  // the Button is the one way to draw it dimmer.
  expect({ dim: back?.props.dimColor === true, children: back?.children }).toEqual({ dim: false, children: [] })
  expect({ dim: prev?.props.dimColor === true, children: prev?.children }).toEqual({ dim: true, children: [] })
  await ui.press({ key: 'back' })
  await ui.press({ key: 'back' })
  await ui.unmount()

  // The terminal draws as before: every control dim, an off one in the faint colour.
  const terminal = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  await terminal.press({ key: 'row-tool-results' })
  await terminal.press({ key: 'item-r:tu2' })
  expect((await terminal.find({ key: 'back' }))?.props.dimColor).toBe(true)
  const off = await terminal.find({ key: 'prev' })
  expect(off?.props.dimColor).toBeUndefined()
  expect((off?.children ?? []).filter(isNode).map(child => child.props?.color)).toEqual(['subtle'])
  await terminal.unmount()
})

/** Waits `ms` on the host's clock (the types of this mod declare no timers). */
function wait(ms: number): Promise<void> {
  const host = globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown }

  return new Promise(resolve => void host.setTimeout(resolve, ms))
}

// The kit refuses the mod's own `$.ui.scroll`, so no measure is ever seen and
// no place follows. A measure waits in the lane of the j and k presses,
// though: a j press held open beneath the mod keeps it from running, and the
// open waits behind it. Off the terminal `/ctx` asks for no measure, so the
// open comes at once.
test('/ctx on an open level-3 pane off the terminal pushes no measure or place token and writes no ring key', async ($, on) => {
  const ring: unknown[] = []
  on('state.set', async (_, e, next) => {
    const change = e as unknown as { key?: string; value?: { value?: unknown } }
    if (change.key === 'ring') {
      ring.push(change.value?.value)
    }

    return next(e)
  })
  let letGo = () => {}
  const held = new Promise<void>(resolve => {
    letGo = resolve
  })
  on('ui.press', { plugin: '*' }, async (_, e, next) => {
    if (e.element === 'scroll-down') {
      await held
    }

    return next(e)
  })
  const w = world(on)
  w.usage = richUsage()
  w.messages = CHAT
  w.files = { [NOTES]: 'alpha\nbeta\n', [PROJECT_MD]: `${PROJECT_TEXT}\n` }
  await $.session.start(START)
  await w.clock.advance(0)
  const run = (args: string) =>
    $.command.run({ command: 'ctx', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  await run('tool')
  // The terminal draws j at level 3; the desktop draws the pane last.
  const terminal = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  await terminal.press({ key: 'item-r:tu1' })
  const desktop = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  expect(await desktop.find({ type: 'Code' })).toBeDefined()
  ring.length = 0

  const press = terminal.press({ key: 'scroll-down' })
  const ctx = run('')
  await wait(20)
  // The pane got the keyboard at once: no measure waited in the lane.
  expect(w.focused).toEqual([true, true])
  letGo()
  await press
  await ctx
  expect(w.focused).toEqual([true, true])
  expect(ring).toEqual([])
  expect(await desktop.find({ type: 'Code' })).toBeDefined()
  await desktop.unmount()
  await terminal.unmount()
})

// The mobile app has no keyboard: like the terminal, it offers keys only
// while the pane holds them. The desktop and VS Code draw a hotkey as a key
// cap and keep the caps and the key words in both states.
test('the mobile app draws key words and key caps only while the pane holds the keys; VS Code keeps them', async ($, on) => {
  await measured($, on)
  for (const surface of ['mobile', 'vscode'] as const) {
    for (const isFocused of [false, true]) {
      const state = `${surface}, ${isFocused ? 'with' : 'without'} the keys`
      const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, isFocused } })
      const caps = async () =>
        (await ui.findAll({ type: 'Button' })).map(button => button.props.hotkey).filter(key => typeof key === 'string')
      const words = async () => (await ui.findAll({ type: 'Text', text: /: (Move|Open)$/ })).map(text => text.text)
      const offers = isFocused || surface === 'vscode'
      for (const level of [1, 2, 3]) {
        if (level === 2) {
          await ui.press({ key: 'row-tool-results' })
        }
        if (level === 3) {
          await ui.press({ key: (await ui.findAll({ type: 'Button' })).find(button => button.key?.startsWith('item-'))!.key! })
        }
        const want = level === 3 ? ['x', 'b'] : ['1', 'x']
        if (offers) {
          expect(await caps(), `${state}, level ${level}`).toEqual(expect.arrayContaining(want))
        } else {
          expect(await caps(), `${state}, level ${level}`).toEqual([])
        }
        // One word group: Enter and the digits.
        expect((await words()).length, `${state}, level ${level}`).toBe(offers && level !== 3 ? 1 : 0)
      }
      await ui.press({ key: 'back' })
      await ui.press({ key: 'back' })
      await ui.unmount()
    }
  }
})
