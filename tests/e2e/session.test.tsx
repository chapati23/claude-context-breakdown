// Journey 7, life of a session: start, measure, a burst of tool calls, a
// compaction (figures marked with ~), /clear, a theme change to light, the
// widget placement, and the bar at 80 and 100 columns on the terminal and on
// the desktop. Each step looks at the bar and at the pane together.

import type { RenderNode } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { BarClientProps } from '../../hooks/barclient'
import { DARK, LIGHT } from '../../hooks/palette'
import { BAND, MESSAGES, PANE, SUMMARY, TRANSCRIPT, usage, world } from '../fixtures'
import type { World } from '../fixtures'
import { START, flatten, mountPane } from './helpers'
import { colorsIn, figuresOf, level2, widest } from './journeys'

const CLIENT = 'context-bar'

type Surface = 'terminal' | 'desktop'

/** The band's flattened text at a width, and the colours it names. Mounted and unmounted. */
async function bandAt($: Engine, surface: Surface, columns: number) {
  const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, bodyColumns: columns } })
  const tree = await ui.drawn()
  const out = { lines: flatten(tree as RenderNode, { surface, columns }), colors: colorsIn(tree as RenderNode) }
  await ui.unmount()

  return out
}

/** The pane's flattened level 1 and the colours it names. */
async function paneNow($: Engine, surface: Surface, extra: Record<string, unknown> = {}) {
  const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns: 88, ...extra } } as never)
  const tree = await ui.drawn()
  const out = { lines: flatten(tree as RenderNode, { surface, columns: 88 }), colors: colorsIn(tree as RenderNode) }
  await ui.unmount()

  return out
}

/** The total the band states: "66k/200k 33%", with its ~ when it is an estimate. */
function totalOf(lines: readonly string[]): string | undefined {
  return /(~?\d[\d.]*k?\/\d[\d.]*k? \d+%)/.exec(lines.join(' '))?.[1]
}

/** A token figure as drawn ("30k", "1.9k", "100") as a number. */
function tokensIn(figure: string): number {
  const value = Number.parseFloat(figure.replace(/,/g, ''))

  return figure.endsWith('k') ? Math.round(value * 1000) : value
}

/** More messages, as after a burst of tool calls: one Bash result of 14,000 characters. */
const BURST = [
  ...MESSAGES,
  { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'o'.repeat(14_000) }] },
]

async function lightTheme($: Engine, w: World) {
  w.theme = 'light'
  await $.config.set({
    key: 'theme',
    value: 'light',
    previous: 'dark',
    provider: { plugin: 'engine', tier: 'core' },
    origin: { kind: 'composer' },
  })
}

test('J7 terminal: start, measure, tool calls, compaction, /clear, light theme, widths', async ($, on) => {
  const w = world(on)

  // Before the session starts nothing is measured: the bar draws nothing of ours and the pane says so.
  expect(totalOf((await bandAt($, 'terminal', 100)).lines)).toBeUndefined()
  expect((await paneNow($, 'terminal')).lines[0]).toMatch(/^Measuring the context window/)

  // Start and measure.
  await $.session.start(START)
  await w.clock.advance(0)
  expect(w.usageCalls).toBe(1)
  for (const columns of [80, 100]) {
    const band = (await bandAt($, 'terminal', columns)).lines
    expect(band).toHaveLength(1)
    expect(widest(band)).toBeLessThanOrEqual(columns)
    expect(totalOf(band)).toBe('66k/200k 33%')
    // The legend names the largest conversation segment.
    expect(band[0]).toMatch(/ · ▉ Tool results 45%$/)
  }
  // The bar is longer at 100 columns than at 80, and states the same figures.
  const narrow = (await bandAt($, 'terminal', 80)).lines[0]!
  const wide = (await bandAt($, 'terminal', 100)).lines[0]!
  expect(narrow.slice(narrow.indexOf(' 66k'))).toBe(wide.slice(wide.indexOf(' 66k')))
  expect(wide.indexOf(' 66k')).toBeGreaterThan(narrow.indexOf(' 66k'))

  const first = (await paneNow($, 'terminal')).lines
  expect(first[0]).toMatch(/^66k used · /)
  expect(first.join('\n')).toContain('Tool results')

  // A burst of tool calls: one measurement, three seconds after the last call, not one per call.
  const calls = w.usageCalls
  w.usage = usage(80_000, 54_000)
  w.messages = BURST
  for (const command of ['ls', 'pwd', 'date']) {
    await $.tool.call({ tool: 'Bash', command })
    await w.clock.advance(500)
  }
  expect(w.usageCalls).toBe(calls)
  await w.clock.advance(3000)
  expect(w.usageCalls).toBe(calls + 1)
  expect(totalOf((await bandAt($, 'terminal', 100)).lines)).toBe('80k/200k 40%')
  const grown = (await paneNow($, 'terminal')).lines
  expect(grown[0]).toMatch(/^80k used · /)
  // The 14,000 characters are in the Tool results: its figure grows by about
  // their size (the fixture's usage counts about one token a character), and
  // level 2 lists the new Bash result at that size.
  const toolTokens = (lines: string[]) => tokensIn(figuresOf(lines.find(line => line.includes('Tool results'))!)!.tokens)
  expect(Math.abs(toolTokens(grown) - toolTokens(first) - 14_000)).toBeLessThanOrEqual(1_000)
  const listUi = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 88, isFocused: true } } as never)
  await listUi.press({ key: 'row-tool-results' })
  const items = level2(flatten(await listUi.drawn(), { columns: 88 }))
  // Back to level 1: the pane keeps its level for the next mount.
  await listUi.press({ key: 'back' })
  await listUi.unmount()
  const burst = items.rows.find(row => /Bash {2}ls\b/.test(row))
  expect(burst).toBeDefined()
  expect(Math.abs(tokensIn(figuresOf(burst!)!.tokens) - 14_000)).toBeLessThanOrEqual(1_000)

  // A compaction: the figures are estimates until the next response, and say so with ~.
  w.messages = SUMMARY
  await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT })
  await w.clock.advance(0)
  const bandAfter = (await bandAt($, 'terminal', 100)).lines
  expect(totalOf(bandAfter)).toBe('~28k/200k 14%')
  expect(bandAfter[0]).toContain('Compaction summary ~')
  const paneAfter = (await paneNow($, 'terminal')).lines
  expect(paneAfter[0]).toMatch(/^~28k used · ~\d+k free before compaction$/)
  expect(paneAfter.some(line => /~% of used/.test(line))).toBe(true)
  expect(paneAfter.some(line => /^All numbers are estimates\. ~:/.test(line))).toBe(true)
  // The estimate is the baseline plus the summary: no other conversation segment is left.
  expect(paneAfter.some(line => line.includes('Tool results'))).toBe(false)
  expect(paneAfter.some(line => line.includes('Compaction summary'))).toBe(true)

  // The next response measures for real: the marks go.
  w.usage = usage(26_600, 600)
  await $.session.measure({ context: w.usage.context, rateLimits: [], changed: ['context'] })
  await w.clock.advance(0)
  expect(totalOf((await bandAt($, 'terminal', 100)).lines)).toBe('27k/200k 13%')
  expect((await paneNow($, 'terminal')).lines.join('\n')).not.toContain('~')

  // /clear: the old fill goes at once; the new conversation is measured on the next tick.
  w.usage = usage(26_500, 500)
  w.messages = [{ role: 'user', content: [{ type: 'text', text: 'p'.repeat(500) }] }]
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(totalOf((await bandAt($, 'terminal', 100)).lines)).toBeUndefined()
  expect((await paneNow($, 'terminal')).lines[0]).toMatch(/^Measuring the context window/)
  await w.clock.advance(0)
  expect(totalOf((await bandAt($, 'terminal', 100)).lines)).toBe('27k/200k 13%')
  expect((await paneNow($, 'terminal')).lines[0]).toMatch(/^27k used · /)

  // Light theme: bar and pane switch to the light palette, none of the dark one left.
  const dark = { bar: (await bandAt($, 'terminal', 100)).colors, pane: (await paneNow($, 'terminal')).colors }
  expect(dark.bar.has(DARK.segments.system)).toBe(true)
  expect(dark.pane.has(DARK.segments.system)).toBe(true)
  await lightTheme($, w)
  for (const colors of [(await bandAt($, 'terminal', 100)).colors, (await paneNow($, 'terminal')).colors]) {
    expect(colors.has(LIGHT.segments.system)).toBe(true)
    expect(colors.has(LIGHT.reserve)).toBe(true)
    expect([...colors].filter(color => Object.values(DARK.segments).includes(color) || color === DARK.reserve || color === DARK.free)).toEqual([])
  }

  // The widget seat on the terminal draws the bar at its width.
  const widget = await paneNow($, 'terminal', { placement: 'widget', bodyColumns: 100 })
  expect(widget.lines).toEqual((await bandAt($, 'terminal', 100)).lines)
})

test('J7 desktop: the bar is one Client; a click opens the pane; the widget and the pane follow the theme', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  // The Client carries the terminal row's text, at both widths.
  for (const columns of [80, 100]) {
    const desktop = await bandAt($, 'desktop', columns)
    const terminal = await bandAt($, 'terminal', columns)
    expect(desktop.lines).toEqual(terminal.lines)
    expect(totalOf(desktop.lines)).toBe('66k/200k 33%')
    expect(widest(desktop.lines)).toBeLessThanOrEqual(columns)
  }

  // A click on Claude output's cell, posted from the Client, opens the pane on that segment.
  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns: 100 } })
  const client = (await band.drawn()) as { props: { props: BarClientProps } }
  const { runs, parts } = client.props.props
  const claude = runs.find(run => run.color === DARK.segments['claude-output'] && typeof run.target === 'number')?.target
  const identity = typeof claude === 'number' ? parts[String(claude)] : undefined
  if (typeof claude !== 'number' || identity === undefined) {
    throw new Error('no run targets Claude output')
  }
  expect(w.opened).toEqual([])
  await band.post({ open: claude, ...identity }, { in: CLIENT })
  expect(w.opened).toEqual(['context-breakdown'])
  const pane = await mountPane($, 'desktop', { columns: 88, isFocused: true })
  expect(level2(flatten(await pane.drawn(), { surface: 'desktop', columns: 88 })).name).toBe('Claude output')
  await pane.unmount()

  // The total opens the overview instead.
  await band.post({ open: 'total' }, { in: CLIENT })
  expect(w.opened).toEqual(['context-breakdown', 'context-breakdown'])
  const overview = await mountPane($, 'desktop', { columns: 88, isFocused: true })
  expect(flatten(await overview.drawn(), { surface: 'desktop', columns: 88 })[0]).toMatch(/^66k used · /)
  await overview.unmount()
  await band.unmount()

  // The widget seat: a glance of swatches, the total and the largest segment, no rows.
  const glance = await paneNow($, 'desktop', { placement: 'widget', bodyColumns: 100 })
  expect(glance.lines).toEqual(['<svg> 66k/200k 33% · <svg> Tool results 45%'])

  // A compaction marks the Client's total too.
  w.messages = SUMMARY
  await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT })
  await w.clock.advance(0)
  expect(totalOf((await bandAt($, 'desktop', 100)).lines)).toBe('~28k/200k 14%')
  expect((await paneNow($, 'desktop')).lines[0]).toMatch(/^~28k used · /)

  // The light theme reaches the Client's runs, the pane's rows and the widget's pictures.
  await lightTheme($, w)
  const isDark = (color: string) => Object.values(DARK.segments).includes(color) || color === DARK.reserve || color === DARK.free
  for (const colors of [(await bandAt($, 'desktop', 100)).colors, (await paneNow($, 'desktop')).colors]) {
    expect(colors.has(LIGHT.segments['compaction-summary'])).toBe(true)
    expect([...colors].filter(isDark)).toEqual([])
  }
  const widget = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement: 'widget', bodyColumns: 100 } })
  const pictures = (await widget.findAll({ type: 'Svg' })).map(svg => String(svg.props.source)).join('')
  const fills = [...pictures.matchAll(/fill:(#[0-9A-Fa-f]{6})/g)].map(match => match[1]!)
  expect(fills).toContain(LIGHT.segments['compaction-summary'])
  expect(fills.filter(isDark)).toEqual([])
  await widget.unmount()

  // /clear: the Client is gone until the next measurement.
  w.usage = usage(26_500, 500)
  w.messages = [{ role: 'user', content: [{ type: 'text', text: 'p'.repeat(500) }] }]
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(totalOf((await bandAt($, 'desktop', 100)).lines)).toBeUndefined()
  await w.clock.advance(0)
  expect(totalOf((await bandAt($, 'desktop', 100)).lines)).toBe('27k/200k 13%')
})
