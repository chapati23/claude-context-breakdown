// The desktop surface: the band is one Client (barclient.tsx), and a pane row
// is a Button holding the name, with its pictures and figures in columns
// beside it (grid.tsx).

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { bandTree } from '../hooks/band'
import { hoveredPart, isFaded, targetAt } from '../hooks/barclient'
import type { BarClientPost, BarClientProps, BarRun } from '../hooks/barclient'
import { BAR_CELLS, FIGURE_CELLS, GRID_MAX_CELLS, LEAD_CELLS } from '../hooks/grid'
import { DARK } from '../hooks/palette'
import { cellWidth } from '../hooks/text'
import type { BandModel } from '../hooks/view'
import { BAND, CHAT, FOCUSED_PANE, MESSAGES, NOTES, PANE, PROJECT_MD, PROJECT_TEXT, manyResults, richUsage, realSession, usage, world } from './fixtures'
import type { World } from './fixtures'
import { flatten, mountPane } from './e2e/helpers'
import { gridRowWith, gridRowsOf, isNode, nodesOf, rightColumns, rowLine } from './grid'
import { level2 } from './e2e/journeys'

const START = { cwd: '/home/user/project', surface: 'terminal', isInteractive: true } as const
const WIDE = { ...BAND, props: { ...BAND.props, bodyColumns: 100 } } as const
const CLIENT = 'context-bar'

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
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
  // The space after the bar and the total open level 1; the total's text is
  // the terminal's total, dim.
  const total = runs.filter(run => run.target === 'total')
  expect(total.map(run => run.text)).toEqual([' ', '66k/200k 33%'])
  expect(total[1]?.dimColor).toBe(true)
  // The bar's cells, the space after them and the legend's swatch are cells
  // of the code font; the total, the join and the legend's words are text in
  // the app's face.
  const isBarCell = (run: BarRun) => typeof run.target === 'number' || run.color === DARK.free || run.color === DARK.reserve
  expect(runs.filter(isBarCell).every(run => run.mono === true)).toBe(true)
  expect(total.map(run => run.mono === true)).toEqual([true, false])
  expect(runs.filter(run => run.mono !== true).map(run => run.text)).toEqual(['66k/200k 33%', ' · ', ' Tool results 45%'])
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
    // The text takes the legend's place, in the app's face, where a count of
    // cells does not bound the drawn width: it gets no more cells than the
    // legend's words, and the swatch and the space stay as a margin.
    const words = legend.find(run => run.mono !== true)
    const room = cellWidth(words?.text.trim() ?? '')

    expect(legend.length).toBeGreaterThan(0)
    expect(Object.keys(hovers).length).toBeGreaterThan(0)
    for (const [index, text] of Object.entries(hovers)) {
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
  // A code-font run is drawn mono; any other run in the app's face, with tabular digits.
  const faces = (await ui.findAll({ type: 'Text', in: CLIENT })).map(text => ({ mono: text.props.mono, tabular: text.props.tabular }))
  expect(faces).toEqual(runs.map(run => (run.mono === true ? { mono: true, tabular: undefined } : { mono: undefined, tabular: true })))

  await ui.pointer({ type: 'move', x: column(claude), y: 0 })
  const hovered = await drawnText()
  // The name is in the app's face, as the words it replaces.
  const name = await ui.find({ type: 'Text', in: CLIENT, text: hovers[String(claude)]! })
  expect({ mono: name?.props.mono, tabular: name?.props.tabular }).toEqual({ mono: undefined, tabular: true })
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

test('targetAt maps a bar column to its run, and every column from the total on to the total', () => {
  const runs: BarRun[] = [
    { text: '███', target: 0, mono: true },
    { text: '▉', target: 0, mono: true },
    { text: '▉', target: 1, mono: true },
    { text: '··', target: null, mono: true },
    { text: ' ', target: 'total', mono: true },
    { text: '9k/20k', target: 'total' },
    { text: ' · ', target: null },
    { text: '▉', target: null, isLegend: true, mono: true },
    { text: ' System 45%', target: null, isLegend: true },
  ]

  expect([0, 2, 3].map(x => targetAt(runs, x))).toEqual([0, 0, 0])
  expect(targetAt(runs, 4)).toBe(1)
  expect(targetAt(runs, 5)).toBeNull()
  expect(targetAt(runs, 6)).toBeNull()
  // The space after the bar at column 7, the total's text from column 8.
  expect(targetAt(runs, 7)).toBe('total')
  expect(targetAt(runs, 8)).toBe('total')
  expect(targetAt(runs, 13)).toBe('total')
  // The join, the swatch and the words follow text in the app's face, of a
  // width no column measures: they open the total too, as a column past them does.
  expect([14, 17, 18, 28, 200].map(x => targetAt(runs, x))).toEqual(['total', 'total', 'total', 'total', 'total'])
  // Before the first run, and with no runs, nothing.
  expect(targetAt(runs, -1)).toBeNull()
  expect(targetAt([], 0)).toBeNull()
  // With no bar, the total starts at column 0.
  expect(targetAt([{ text: '9k', target: 'total' }], 0)).toBe('total')
  expect(targetAt([{ text: '9k', target: 'total' }], 40)).toBe('total')
  // A character of the bar is a cell, a surrogate pair too.
  expect(targetAt([{ text: '😀a', target: 3 }, { text: 'b', target: 4 }], 1)).toBe(3)
})

/** The column where run `index` starts: every run before it one cell a character. */
function startOf(runs: readonly BarRun[], index: number): number {
  return runs.slice(0, index).reduce((sum, run) => sum + [...run.text].length, 0)
}

test('a click on the total’s last character or on the legend opens level 1; a click on a bar cell does as before', async ($, on) => {
  const w = await measured($, on)
  const band = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  const { runs } = (await clientOf(band)).props
  const keysOf = async (ui: { findAll: (q: { type: string }) => Promise<{ key?: string }[]> }, prefix: string) =>
    (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith(prefix))
  /** A left press at column `x`: whether it opened the pane, and the level shown after it. */
  const clickAt = async (x: number) => {
    const before = w.opened.length
    await band.pointer({ type: 'down', x, y: 0, button: 'left' })
    await band.pointer({ type: 'up', x, y: 0, button: 'left' })
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
    const level = (await keysOf(ui, 'item-')).length > 0 ? 2 : (await keysOf(ui, 'row-')).length > 0 ? 1 : 0
    await ui.unmount()

    return { opened: w.opened.length > before, level }
  }
  const label = runs.findIndex(run => run.target === 'total' && run.mono !== true)
  const words = runs.findIndex(run => run.isLegend === true && run.mono !== true)
  const end = startOf(runs, runs.length)
  const segment = (id: keyof typeof DARK.segments) => columnOf(runs, targetOfColor(runs, DARK.segments[id]))
  const free = startOf(runs, runs.findIndex(run => run.color === DARK.free))
  const reserve = startOf(runs, runs.findIndex(run => run.color === DARK.reserve))

  // A segment of its own opens its items; then the total's last character opens level 1.
  expect(await clickAt(segment('claude-output'))).toEqual({ opened: true, level: 2 })
  expect(await clickAt(startOf(runs, label) + runs[label]!.text.length - 1)).toEqual({ opened: true, level: 1 })
  // The legend's words, and a column past the drawn text, open level 1 too.
  expect(await clickAt(segment('claude-output'))).toEqual({ opened: true, level: 2 })
  expect(await clickAt(startOf(runs, words) + 3)).toEqual({ opened: true, level: 1 })
  expect(await clickAt(segment('claude-output'))).toEqual({ opened: true, level: 2 })
  expect(await clickAt(end + 10)).toEqual({ opened: true, level: 1 })
  // A merged cell opens level 1; free space and reserve open nothing.
  expect(await clickAt(segment('claude-output'))).toEqual({ opened: true, level: 2 })
  expect(await clickAt(segment('tool-results'))).toEqual({ opened: true, level: 1 })
  expect(await clickAt(free)).toEqual({ opened: false, level: 1 })
  expect(await clickAt(reserve)).toEqual({ opened: false, level: 1 })
  await band.unmount()
})

test('the pointer on the total or the legend fades no segment and names none', async ($, on) => {
  await measured($, on)
  const ui = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  const { runs } = (await clientOf(ui)).props
  const words = runs.findIndex(run => run.isLegend === true && run.mono !== true)

  for (const x of [startOf(runs, runs.findIndex(run => run.target === 'total')), startOf(runs, words) + 3]) {
    await ui.pointer({ type: 'move', x, y: 0 })
    const drawn = await ui.findAll({ type: 'Text', in: CLIENT })
    expect(drawn.map(text => text.text)).toEqual(runs.map(run => run.text))
    expect(drawn.some(text => text.props.dimColor === true && typeof runs[drawn.indexOf(text)]?.target === 'number')).toBe(false)
  }
  await ui.unmount()
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

/** Whether `node` or anything under it asks for the monospaced face. */
const anyMono = (tree: unknown) => nodesOf(tree).some(node => node.props?.mono === true)

test('a desktop pane row: a swatch, the name in a Button with no hotkey, a length bar picture, figures in columns of their own', async ($, on) => {
  await measured($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  const tree = await ui.drawn()

  const button = await ui.find({ key: 'row-tool-results' })
  // The Button carries the name and nothing else: no hotkey, so the native
  // button draws no key cap, and no child.
  expect(button?.props.label).toBe('Tool results')
  expect(button?.props.hotkey).toBeUndefined()
  expect(button?.props.plain).toBe(true)
  expect(button?.children).toEqual([])

  const row = gridRowWith(tree, 'row-tool-results')!
  expect(rowLine(row)).toBe('Tool results ▬ 30k 45%')
  // Left: the lead holds the swatch picture, then the name's Box holds the Button alone.
  const [leadBox, nameBox] = ((row.children ?? []).filter(isNode)[0]!.children ?? []).filter(isNode)
  expect(leadBox?.props).toMatchObject({ width: LEAD_CELLS, flexShrink: 0 })
  expect((leadBox?.children ?? []).filter(isNode).map(part => part.type)).toEqual(['Svg'])
  expect((nameBox?.children ?? []).filter(isNode).map(part => part.type)).toEqual(['Button'])
  // Right: the length bar in a Box of whole cells, then the tokens and the share, right-aligned.
  const [bar, tokens, share] = rightColumns(row)
  expect(bar?.props).toMatchObject({ width: BAR_CELLS, flexShrink: 0 })
  const picture = (bar?.children ?? []).filter(isNode)[0]!
  // No width of its own: it takes the markup's width up to its Box (grid.tsx).
  expect(picture.props).toMatchObject({ alt: 'Tool results: 30k', height: 6 })
  expect(picture.props?.width).toBeUndefined()
  expect(String(picture.props?.source)).toContain(DARK.segments['tool-results'])
  for (const column of [tokens, share]) {
    expect(column?.props).toMatchObject({ width: FIGURE_CELLS, flexShrink: 0, justifyContent: 'flex-end' })
  }
  expect((tokens?.children ?? []).filter(isNode)[0]?.props).toEqual({ tabular: true })
  expect((share?.children ?? []).filter(isNode)[0]?.props).toEqual({ tabular: true, dimColor: true })
  // No part of the pane asks for the monospaced face, and no text holds a run of spaces.
  expect(anyMono(tree)).toBe(false)
  expect(nodesOf(tree).filter(node => node.type === 'Text').some(text => / {2}/.test(textOf(text)))).toBe(false)

  // The key words name Enter alone.
  expect(await ui.find({ type: 'Text', text: '⏎: Open' })).toBeDefined()
  const focusedRow = withoutHandles(row)
  await ui.unmount()

  // Without the keyboard the row is the same, the ring apart.
  const idle = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await idle.find({ key: 'row-tool-results' }))?.props.hotkey).toBeUndefined()
  expect(withoutHandles(gridRowWith(await idle.drawn(), 'row-tool-results')!)).toEqual(focusedRow)
  await idle.unmount()
})

test('desktop segment rows keep their names whole in a narrow pane, figures beside them', async ($, on) => {
  await measured($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 24 } })

  expect((await ui.find({ key: 'row-system' }))?.props.label).toBe('System')
  expect((await ui.find({ key: 'row-skills-agents' }))?.props.label).toBe('Skills/agents')
  // Too narrow for a length bar and a share: the swatch, the name and the tokens.
  const row = gridRowWith(await ui.drawn(), 'row-system')!
  expect(rowLine(row)).toBe('System 20k')
  expect(rightColumns(row).map(part => part.props?.width)).toEqual([FIGURE_CELLS])
  expect((await ui.find({ key: 'row-system' }))?.props.hotkey).toBeUndefined()
  await ui.unmount()
})

test('desktop item rows: the Button holds the title in a column as wide as the longest; the detail, bar and figures follow', async ($, on) => {
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
  expect(item?.props.hotkey).toBeUndefined()
  expect(item?.children).toEqual([])

  const tree = await ui.drawn()
  const row = gridRowWith(tree, 'item-r:real0')!
  expect(rowLine(row)).toBe('Read ~/project/src/module-1.ts ▬ 31k 27%')
  const [titleBox, detailBox] = ((row.children ?? []).filter(isNode)[0]!.children ?? []).filter(isNode)
  // "Read" and "Bash": four cells, and one for the native button's padding.
  expect(titleBox?.props).toMatchObject({ width: cellWidth('Read') + 1, flexShrink: 0 })
  const detail = (detailBox?.children ?? []).filter(isNode)[0]!
  expect(detail.props?.dimColor).toBe(true)
  expect(textOf(detail)).toBe('~/project/src/module-1.ts')

  // The tenth and the eleventh rows are drawn like the first: no hotkey, the title column as wide.
  for (const key of ['item-r:real9', 'item-r:real10']) {
    expect((await ui.find({ key }))?.props.hotkey).toBeUndefined()
    const other = gridRowWith(tree, key)!
    expect(((other.children ?? []).filter(isNode)[0]!.children ?? []).filter(isNode)[0]?.props?.width).toBe(cellWidth('Read') + 1)
    expect(rightColumns(other).map(part => part.props?.width)).toEqual(rightColumns(row).map(part => part.props?.width))
  }

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

/** A drawn tree without the press handles, which each drawing numbers anew. */
function withoutHandles(tree: unknown): unknown {
  return JSON.parse(JSON.stringify(tree, (key, value: unknown) => (key === 'press' ? undefined : value)))
}

/** A drawn tree without the press handles and the focus ring. */
function withoutRing(tree: unknown): unknown {
  return JSON.parse(JSON.stringify(tree, (key, value: unknown) => (key === 'press' || key === 'autoFocus' ? undefined : value)))
}

/** The widths of a grid row's fixed columns, right of its names. */
const widthsOf = (row: { children?: unknown[] }) => rightColumns(row as never).map(part => part.props?.width)

test('desktop rows keep their parts and columns when Esc takes the keys and a click gives them back', async ($, on) => {
  const w = world(on)
  const real = realSession()
  w.usage = real.usage
  w.messages = real.messages
  await $.session.start(START)
  await w.clock.advance(0)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
  const states = async (keys: readonly string[]) => {
    const firstTree = await ui.drawn()
    const focusedRows = keys.map(key => withoutRing(gridRowWith(firstTree, key)!))
    await ui.redraw({ ...PANE.props, bodyColumns: 88 })
    // Each row's drawn tree is the same in both states, the ring apart.
    const idleTree = await ui.drawn()
    expect(keys.map(key => withoutRing(gridRowWith(idleTree, key)!))).toEqual(focusedRows)
    await ui.redraw({ ...FOCUSED_PANE.props, bodyColumns: 88 })
    // The same tree after a click.
    expect(withoutHandles(await ui.drawn())).toEqual(withoutHandles(firstTree))

    return keys.map(key => gridRowWith(firstTree, key)!)
  }

  // Level 1: every segment row has the same columns: the bar, the tokens, the share.
  const segments = await states(['row-system', 'row-tool-results', 'row-claude-output'])
  expect(new Set(segments.map(row => JSON.stringify(widthsOf(row)))).size).toBe(1)
  expect(widthsOf(segments[0]!)).toEqual([BAR_CELLS, FIGURE_CELLS, FIGURE_CELLS])

  // Level 2: the first, the tenth and the eleventh row keep one title column and the same columns after it.
  await ui.press({ key: 'row-tool-results' })
  const items = await states(['item-r:real0', 'item-r:real9', 'item-r:real10'])
  const titleWidth = (row: { children?: unknown[] }) =>
    (((row.children ?? []).filter(isNode)[0]!.children ?? []).filter(isNode)[0]?.props?.width as number | undefined) ?? -1
  expect(new Set(items.map(titleWidth)).size).toBe(1)
  expect(new Set(items.map(row => JSON.stringify(widthsOf(row)))).size).toBe(1)
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('a desktop row in a narrow pane keeps its swatch first, in one place in both states', async ($, on) => {
  await measured($, on)
  // 32 columns: the swatch leads, and the grid has no room for a length bar.
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 32 } })
  const row = gridRowWith(await ui.drawn(), 'row-system')!
  const left = ((row.children ?? []).filter(isNode)[0]!.children ?? []).filter(isNode)
  expect(left.map(part => part.props?.width ?? null)).toEqual([LEAD_CELLS, null])
  expect((await ui.find({ key: 'row-system' }))?.props.hotkey).toBeUndefined()
  const focused = withoutRing(row)
  await ui.redraw({ ...PANE.props, bodyColumns: 32 })
  expect(withoutRing(gridRowWith(await ui.drawn(), 'row-system')!)).toEqual(focused)
  await ui.unmount()
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
  // The rows take no digit: the words name Enter alone.
  expect(await words()).toEqual(['⏎: Open'])
  await ui.press({ key: 'row-tool-results' })
  // One page: p and n leave together.
  expect(await check()).toEqual(['back', 'sort', 'refresh', 'close'])
  expect(await words()).toEqual(['⏎: Open'])
  // A Bash result has no file: v, c and m leave; p and n stay at level 3.
  await ui.press({ key: 'item-r:tu2' })
  expect(await check()).toEqual(['back', 'prev', 'next', 'format', 'refresh', 'close'])
  await ui.unmount()
})

test('desktop plain lines stand in the rows’ columns, and the grid stops at its cap', async ($, on) => {
  const w = await measured($, on)
  // One MCP server whose tool is not loaded: a server line under MCP tools.
  const base = usage(66_000)
  const mcpTools = [{ name: 'mcp__tickets__find', serverName: 'tickets', tokens: 4000, isLoaded: false }]
  w.usage = { ...base, context: { ...base.context, breakdown: { ...base.context.breakdown!, mcpTools } } }
  const first = await mountPane($, 'desktop')
  await first.press({ key: 'refresh' })
  await w.clock.advance(0)
  await first.unmount()
  const trees: Record<number, unknown> = {}
  for (const columns of [32, 45, 64, 88, 140]) {
    const where = `${columns} columns`
    const ui = await mountPane($, 'desktop', { columns })
    const tree = await ui.drawn()
    trees[columns] = withoutHandles(tree)
    const rows = gridRowsOf(tree)
    const lines = rows.map(rowLine)
    // Every row ends in the same figure columns, each of whole cells and
    // right-aligned: headings, segments, Free space, Reserve, Not loaded.
    const figures = (row: (typeof rows)[number]) => rightColumns(row).filter(part => !nodesOf(part).some(node => node.type === 'Svg'))
    const shape = JSON.stringify(figures(rows[0]!).map(part => part.props))
    for (const row of rows) {
      expect({ where, line: rowLine(row), shape: JSON.stringify(figures(row).map(part => part.props)) }).toEqual({ where, line: rowLine(row), shape })
    }
    expect({ where, shape: figures(rows[0]!).every(part => part.props?.width === FIGURE_CELLS && part.props?.justifyContent === 'flex-end') }).toEqual({ where, shape: true })
    for (const [label, figure] of [
      ['Free space', '101k'],
      ['Reserve', '33k'],
      ['MCP tools', '9k'],
    ] as const) {
      const line = lines.find(text => text.startsWith(label)) ?? ''
      expect({ where, label, figure: line.split(' ').includes(figure) }).toEqual({ where, label, figure: true })
    }
    // Free space, Reserve and the Not loaded rows have no length bar.
    expect({ where, bars: lines.filter(text => /^(Free space|Reserve|MCP tools|Baseline|Conversation)/.test(text) && text.includes('▬')) }).toEqual({ where, bars: [] })
    // With a server, MCP tools is a row that opens: a Button with its name and counts, no line per server.
    const label = String((await ui.find({ key: 'row-not-loaded' }))?.props.label)
    expect({ where, label: /^MCP tools( · 1 server(, 1 tool)?)?$/.test(label) }).toEqual({ where, label: true })
    expect({ where, server: lines.filter(text => text.includes('tickets')) }).toEqual({ where, server: [] })
    // The grid is two cells narrower than the pane, at most GRID_MAX_CELLS.
    const grid = nodesOf(tree).find(node => node.type === 'Box' && typeof node.props?.width === 'number' && node.props.width > LEAD_CELLS)
    expect({ where, grid: grid?.props?.width }).toEqual({ where, grid: Math.min(GRID_MAX_CELLS, columns - 2) })
    await ui.unmount()
  }
  // A wide pane draws the same tree as one at the cap.
  expect(trees[140]).toEqual(trees[88])
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

  // The terminal draws every control dim, its key letter too, and an off one's label in the faint colour.
  const terminal = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  await terminal.press({ key: 'row-tool-results' })
  await terminal.press({ key: 'item-r:tu2' })
  expect((await terminal.find({ key: 'back' }))?.props.dimColor).toBe(true)
  const off = await terminal.find({ key: 'prev' })
  expect(off?.props.dimColor).toBe(true)
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
// while the pane holds them. The desktop and VS Code draw a control's hotkey
// as a key cap and keep the caps and the key words in both states.
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
        // The controls' hotkeys; the rows have none on these surfaces.
        const want = level === 3 ? ['x', 'b'] : ['r', 'x']
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
