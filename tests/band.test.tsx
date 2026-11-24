import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { CHIP_GAP, FREE, SCALE_BREAK } from '../hooks/bar'
import { inkOn } from '../hooks/color'
import { CHIP_HOLD_MS } from '../hooks/focus'
import { DARK, LIGHT, edgeColor } from '../hooks/palette'
import { BAND, PANE, barRowOf, earlySession, SUMMARY, SURFACES, TRANSCRIPT, seePane, usage, world } from './fixtures'

const START = { cwd: '/home/user/project', surface: 'terminal', isInteractive: true } as const

/** A band wide enough that the legend leaves the bar the cells it had before it. */
const WIDE = { ...BAND, props: { ...BAND.props, bodyColumns: 100 } } as const

type Node = { type: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

const isNode = (x: unknown): x is Node => typeof x === 'object' && x !== null && 'type' in x
const textOf = (x: unknown): string =>
  typeof x === 'string' ? x : isNode(x) ? (x.children ?? []).map(textOf).join('') : ''
/** Where a surface's band text lives: the desktop's is drawn inside its Client. */
const inClient = (surface: string) => (surface === 'terminal' ? {} : { in: 'context-bar' })
const isPlaced = (node: Node) => node.type === 'Box' && node.props?.position === 'absolute'

/**
 * The band's row as drawn: what stands in the flow, each with the column it
 * starts at, and the chips laid over it.
 */
async function rowOf(ui: { drawn: () => Promise<unknown> }) {
  const tree = barRowOf(await ui.drawn()) as Node
  const children = (tree.children ?? []).filter(isNode)
  const flow: { node: Node; start: number; text: string }[] = []
  let column = 0
  for (const node of children.filter(child => !isPlaced(child))) {
    const text = textOf(node)
    flow.push({ node, start: column, text })
    column += text.length
  }
  const chips = children.filter(isPlaced).map(box => ({ box, text: textOf(box), label: (box.children ?? []).filter(isNode)[0]! }))

  return { flow, width: column, chips }
}

/** The chip that names a segment, by its hover group or, when shown, by its place. */
function chipOf(row: Awaited<ReturnType<typeof rowOf>>, id: string) {
  return row.chips.find(chip => chip.box.hover?.scope === `seg-${id}`)
}

test('the band draws nothing before the first measurement', async ($, on) => {
  world(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(await ui.keepsBeneath()).toBe(true)
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the band draws the segments and the total after session.start', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  {
    const ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
    const buttons = await ui.findAll({ type: 'Button' })

    expect(buttons.map(button => button.key)).toEqual([
      'seg-system',
      'seg-project-instructions',
      'seg-skills-agents',
      'seg-tool-results',
      'seg-prompts',
      'seg-claude-output',
    ])
    // The task report (100 tokens) is under half a cell: merged, not drawn.
    expect(await ui.find({ key: 'seg-task-reports' })).toBeUndefined()
    // The cell that holds it says so in its name.
    expect((await ui.find({ key: 'seg-tool-results' }))?.props.label).toBe('Tool results and 1 more')
    expect((await ui.find({ key: 'seg-prompts' }))?.props.label).toBe('Your prompts')
    for (const button of buttons) {
      expect(button.props.hotkey).toBeUndefined()
    }
    expect((await ui.find({ type: 'Text', text: /66k\/200k 33%/ }))?.text.trim()).toBe('66k/200k 33%')
    await ui.unmount()
  }
  // The desktop draws the band as one Client, not Buttons: see desktop.test.tsx.
})

test('the row fits its width, and no chip makes it longer', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  for (const surface of SURFACES) {
    for (const bodyColumns of [8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80, 100, 160]) {
      const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, bodyColumns } })
      const row = await rowOf(ui)

      // Only what is drawn in the flow takes room; chips lie over it.
      expect(row.width).toBeLessThan(bodyColumns)
      for (const chip of row.chips) {
        const left = chip.box.props?.left as number
        expect(left).toBeGreaterThanOrEqual(0)
        expect(left + chip.text.length).toBeLessThanOrEqual(row.width)
        // Neither its segment nor the cell on either side of it: there the
        // pointer leaves the segment for its neighbour, not for the chip.
        const seg = row.flow.find(item => item.node.props?.key === chip.box.hover?.scope)!
        const end = seg.start + seg.text.length
        expect(left + chip.text.length <= seg.start - CHIP_GAP || left >= end + CHIP_GAP).toBe(true)
        // Inside the bar, or over the whole total and legend to the row's
        // end: never a piece of a figure left beside it ("39k 1M 10%").
        const bar = row.flow.filter(item => item.node.type === 'Button' || /^[·▒]+$/.test(item.text))
        const barEnd = Math.max(...bar.map(item => item.start + item.text.length))
        expect(left + chip.text.length <= barEnd || left + chip.text.length === row.width).toBe(true)
      }
      await ui.unmount()
    }
  }
})

test('each segment ends in a seven-eighths edge; free space and reserve are quieter glyphs', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  {
    const ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
    const row = await rowOf(ui)
    const segments = row.flow.filter(item => item.node.type === 'Button')

    expect(segments.length).toBe(6)
    for (const { text } of segments) {
      expect(text).toMatch(/^█*▉$/)
    }
    // The one-cell segments are the edge alone.
    expect(segments.find(item => item.node.props?.key === 'seg-prompts')?.text).toBe('▉')
    expect((await ui.find({ key: 'seg-tool-results' }))?.text).toBe('█████████▉')
    // The full blocks on their own colour, so the engine's inversion of a
    // focused or hovered Button leaves them as they are; the edge on a shade
    // of it, so its last eighth still reads as a gap.
    const tools = (await ui.find({ key: 'seg-tool-results' }))?.children as Node[]
    const color = DARK.segments['tool-results']
    expect(tools.map(run => [textOf(run), run.props])).toEqual([
      ['█████████', { color, backgroundColor: color }],
      ['▉', { color, backgroundColor: edgeColor(DARK, 'tool-results') }],
    ])
    // A one-cell segment is its edge alone: inverted, the shade fills most of
    // the cell, so it does not vanish.
    const prompts = (await ui.find({ key: 'seg-prompts' }))?.children as Node[]
    expect(prompts.map(run => run.props)).toEqual([
      { color: DARK.segments.prompts, backgroundColor: edgeColor(DARK, 'prompts') },
    ])
    expect(await ui.find({ type: 'Text', text: /^·+$/ })).toMatchObject({ props: { color: DARK.free } })
    expect(await ui.find({ type: 'Text', text: /^▒+$/ })).toMatchObject({ props: { color: DARK.reserve } })
    await ui.unmount()
  }
})

test('hovering a segment reveals a chip beside it in its colour', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  {
    const ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
    const row = await rowOf(ui)
    const claude = row.flow.find(item => item.node.props?.key === 'seg-claude-output')!
    const chip = chipOf(row, 'claude-output')!
    const color = DARK.segments['claude-output']

    expect(chip.text).toBe(' Claude output 8k ')
    // Hidden at rest, shown by the segment's hover group.
    expect(chip.box.props).toMatchObject({ position: 'absolute', top: 0, display: 'none' })
    expect(chip.box.hover).toEqual({ scope: 'seg-claude-output', display: 'flex' })
    expect(claude.node.hover).toEqual({ scope: 'seg-claude-output' })
    // Right of the segment, over the free dots, after one uncovered cell:
    // there the pointer reaches the next part before it reaches the chip.
    expect(chip.box.props?.left).toBe(claude.start + claude.text.length + CHIP_GAP)
    expect(chip.label.props).toEqual({ color: inkOn(color), backgroundColor: color })
    // Gold takes black ink.
    expect(chip.label.props?.color).toBe('#000000')
    await ui.unmount()
  }
  // The desktop shows the name in the legend's place instead: see desktop.test.tsx.
})

test('a merged cell’s chip lists its members', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  const ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
  // The task report (100 tokens) is merged into the tool results.
  expect(chipOf(await rowOf(ui), 'tool-results')?.text).toBe(' Tool results 30k + Task reports 100 ')
  await ui.unmount()
})

test('a chip with no room on the right flips to the left of its segment', async ($, on) => {
  const w = world(on)
  // Almost full, and Claude output last after a long run of tool results:
  // it ends where the reserve and the total begin.
  w.usage = usage(180_000, 154_000)
  w.messages = [
    { role: 'user', content: [{ type: 'text', text: 'p'.repeat(4000) }] },
    { role: 'assistant', content: [{ type: 'text', text: 'c'.repeat(30_000) }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r'.repeat(120_000) }] },
  ]
  await $.session.start(START)
  await w.clock.advance(0)
  await seePane($, w)

  {
    // Too narrow for the legend: only the total is right of the bar.
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 45 } })
    const row = await rowOf(ui)
    const claude = row.flow.find(item => item.node.props?.key === 'seg-claude-output')!
    const chip = chipOf(row, 'claude-output')!
    const left = chip.box.props?.left as number

    expect(await ui.find({ type: 'Text', text: /%$/ })).toMatchObject({ text: ' 180k/200k 90%' })
    // It ends one cell before the segment starts, over the cells before it.
    expect(left + chip.text.length).toBe(claude.start - CHIP_GAP)
    expect(chip.text).toBe(' Claude output 30k ')
    // The tool results' chip, with room on the right, goes right: over
    // Claude output's cells and beyond, never over its own or the first
    // cell after it, so the pointer can walk on to Claude output.
    const tools = row.flow.find(item => item.node.props?.key === 'seg-tool-results')!
    expect(chipOf(row, 'tool-results')?.box.props?.left).toBe(tools.start + tools.text.length + CHIP_GAP)
    await ui.unmount()
  }
})

test('keyboard focus on a segment shows its chip; focus leaving hides it', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)
  const focus = (element?: string) =>
    $.ui.focus({
      component: 'AbovePrompt',
      requestId: 'context-breakdown',
      ...(element === undefined ? {} : { plugin: 'context-breakdown', element }),
      origin: { kind: 'person' },
    })

  {
    const ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })

    await focus('seg-claude-output')
    let row = await rowOf(ui)
    // Shown from state: no hover needed, no display none.
    const shown = row.chips.filter(chip => chip.box.hover === undefined)
    expect(shown.map(chip => chip.text)).toEqual([' Claude output 8k '])
    expect(shown[0]?.box.props?.display).toBeUndefined()
    expect(chipOf(row, 'claude-output')).toBeUndefined()
    // No hover chip beside it: the pointer on another segment cannot show a
    // second chip while this one is up.
    expect(row.chips).toHaveLength(1)

    // An engine stop (a pane's close mark): no element of ours.
    await focus()
    row = await rowOf(ui)
    expect(row.chips.every(chip => chip.box.props?.display === 'none')).toBe(true)
    expect(chipOf(row, 'claude-output')?.text).toBe(' Claude output 8k ')
    await ui.unmount()
  }

  // The desktop gets no chips, focused or not.
  const desktop = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  await focus('seg-claude-output')
  expect((await rowOf(desktop)).chips).toEqual([])
  await desktop.unmount()
})

test('the focus chip clears when the ring moves to another mod’s element or into a pane', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)
  const focusTools = () =>
    $.ui.focus({
      component: 'AbovePrompt',
      requestId: 'context-breakdown',
      plugin: 'context-breakdown',
      element: 'seg-tool-results',
      origin: { kind: 'person' },
    })
  const shownChips = async () => {
    const ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
    const shown = (await rowOf(ui)).chips.filter(chip => chip.box.props?.display !== 'none').length
    await ui.unmount()

    return shown
  }

  await focusTools()
  expect(await shownChips()).toBe(1)
  // Another mod's row in the band takes the ring.
  await $.ui.focus({
    component: 'AbovePrompt',
    requestId: 'context-breakdown',
    plugin: 'other-mod',
    element: 'other-button',
    origin: { kind: 'person' },
  })
  expect(await shownChips()).toBe(0)

  await focusTools()
  expect(await shownChips()).toBe(1)
  // The ring moves in a pane: the band no longer holds the keyboard.
  await $.ui.focus({
    component: 'Pane',
    requestId: 'some-pane',
    plugin: 'other-mod',
    element: 'row-1',
    origin: { kind: 'person' },
  })
  expect(await shownChips()).toBe(0)

  // Another mod's key that happens to start with "seg-" is not ours.
  await $.ui.focus({
    component: 'AbovePrompt',
    requestId: 'context-breakdown',
    plugin: 'other-mod',
    element: 'seg-tool-results',
    origin: { kind: 'person' },
  })
  expect(await shownChips()).toBe(0)
})

test('a submitted prompt or a /clear drops a focus chip that was left behind', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)
  const focusTools = () =>
    $.ui.focus({
      component: 'AbovePrompt',
      requestId: 'context-breakdown',
      plugin: 'context-breakdown',
      element: 'seg-tool-results',
      origin: { kind: 'person' },
    })
  const shownChips = async () => {
    const ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
    const shown = (await rowOf(ui)).chips.filter(chip => chip.box.props?.display !== 'none').length
    await ui.unmount()

    return shown
  }

  await focusTools()
  expect(await shownChips()).toBe(1)
  // Esc gave the keyboard back to the prompt; the person sends a prompt.
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  await w.clock.settle()
  expect(await shownChips()).toBe(0)

  await focusTools()
  expect(await shownChips()).toBe(1)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  await w.clock.advance(0)
  expect(await shownChips()).toBe(0)
})

/** A band mount's chips: how many are drawn, and how many show without a hover. */
async function chipCounts($: Engine) {
  const ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
  const { chips } = await rowOf(ui)
  await ui.unmount()

  return { drawn: chips.length, shown: chips.filter(chip => chip.box.props?.display !== 'none').length }
}

test('the keyboard chip ends a few seconds after the last focus move, and a new move restarts the wait', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)
  const focus = (element: string) =>
    $.ui.focus({
      component: 'AbovePrompt',
      requestId: 'context-breakdown',
      plugin: 'context-breakdown',
      element,
      origin: { kind: 'person' },
    })

  await focus('seg-tool-results')
  expect((await chipCounts($)).shown).toBe(1)
  // Esc, typing or a click elsewhere raise no event: the chip waits out its time.
  await w.clock.advance(CHIP_HOLD_MS - 1000)
  expect((await chipCounts($)).shown).toBe(1)
  // Tab to the next segment: its chip, and the wait starts again.
  await focus('seg-prompts')
  await w.clock.advance(CHIP_HOLD_MS - 1000)
  // The first move's timer was stopped; it does not end the second's chip.
  expect((await chipCounts($)).shown).toBe(1)
  await w.clock.advance(1000)
  const after = await chipCounts($)
  expect(after.shown).toBe(0)
  // The hover chips are back.
  expect(after.drawn).toBeGreaterThan(1)
})

test('a press on a segment opens the pane and leaves no chip behind', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  // A click moves the ring onto the segment, then presses it.
  await $.ui.focus({
    component: 'AbovePrompt',
    requestId: 'context-breakdown',
    plugin: 'context-breakdown',
    element: 'seg-tool-results',
    origin: { kind: 'person' },
  })
  expect((await chipCounts($)).shown).toBe(1)
  const ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
  await ui.press({ key: 'seg-tool-results' })
  await w.clock.settle()
  await ui.unmount()

  expect(w.opened).toEqual(['context-breakdown'])
  expect((await chipCounts($)).shown).toBe(0)
})

test('the legend names the largest conversation segment after a swatch of its colour, and goes first when narrow', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)
  await seePane($, w)

  // The desktop's legend is data of the Client: see desktop.test.tsx.
  for (const surface of ['terminal'] as const) {
    for (const bodyColumns of [60, 80, 100]) {
      const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, bodyColumns } })
      const row = await rowOf(ui)
      const at = row.flow.findIndex(item => item.text === ' Tool results 30k')
      // 30k of 66k used: its tokens, not a percent. The words are dim text, as the total: a segment
      // colour holds only 3:1, too little for text.
      expect(row.flow[at]?.node.props).toEqual({ dimColor: true })
      // The swatch before them carries the colour.
      expect(row.flow[at - 1]?.text).toBe('▉')
      expect(row.flow[at - 1]?.node.props).toEqual({ color: DARK.segments['tool-results'] })
      expect(row.flow[at - 2]?.text).toBe(' · ')
      await ui.unmount()
    }
    // 12 + 3 + 2 + 16 + 2 + 20 = 55 columns hold the legend; 54 do not.
    for (const [bodyColumns, hasLegend] of [[55, true], [54, false], [24, false]] as const) {
      const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, bodyColumns } })
      expect((await ui.find({ type: 'Text', text: /^ ?Tool results 30k$/ })) !== undefined).toBe(hasLegend)
      expect((await ui.find({ type: 'Text', text: /66k\/200k 33%/ }))?.text.trim()).toBe('66k/200k 33%')
      expect((await ui.findAll({ type: 'Button' })).length).toBeGreaterThan(0)
      await ui.unmount()
    }
  }
})

test('the widget seat’s glance draws the legend as a swatch picture in the segment colour, then dim words in the app’s face', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement: 'widget', bodyColumns: 100 } })
  const words = await ui.find({ type: 'Text', text: 'Tool results 30k' })
  // The total, the dot and the words are text in the app's face, with tabular digits.
  expect(words?.props).toMatchObject({ tabular: true, dimColor: true })
  expect(words?.props.mono).toBeUndefined()
  for (const text of [/^66k\/200k 33%$/, /^·$/]) {
    const found = await ui.find({ type: 'Text', text })
    expect(found?.props).toMatchObject({ tabular: true, dimColor: true })
    expect(found?.props.mono).toBeUndefined()
  }
  const swatch = (await ui.findAll({ type: 'Svg' }))[1]
  // The Claude Code theme's palette, as the bar's: not the page's light or dark scheme.
  expect(String(swatch?.props.source)).toContain(`fill:${DARK.segments['tool-results']}`)
  expect(String(swatch?.props.source)).not.toContain(`fill:${LIGHT.segments['tool-results']}`)
  expect(String(swatch?.props.source)).not.toContain('prefers-color-scheme')
  await ui.unmount()
})

test('a light theme draws the light palette, and a theme change follows', async ($, on) => {
  const w = world(on)
  w.theme = 'light-daltonized'
  await $.session.start(START)
  await w.clock.advance(0)
  expect(w.configLists).toBe(1)

  const colors = async () => {
    const band = await $.ui.mount({ ...WIDE, surface: 'terminal' })
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const out = {
      bar: ((await band.find({ key: 'seg-system' }))?.children[0] as Node).props?.color,
      reserve: (await band.find({ type: 'Text', text: /^▒+$/ }))?.props.color,
      // The row's length bar carries the segment's colour.
      swatch: ((await pane.find({ key: 'row-system' }))?.children.find(
        child => isNode(child) && child.props?.color !== undefined,
      ) as Node).props?.color,
    }
    await band.unmount()
    await pane.unmount()

    return out
  }

  expect(await colors()).toEqual({ bar: LIGHT.segments.system, reserve: LIGHT.reserve, swatch: LIGHT.segments.system })

  await $.config.set({
    key: 'theme',
    value: 'dark',
    previous: 'light-daltonized',
    provider: { plugin: 'engine', tier: 'core' },
    origin: { kind: 'composer' },
  })
  expect(await colors()).toEqual({ bar: DARK.segments.system, reserve: DARK.reserve, swatch: DARK.segments.system })
})

test('an unreadable theme leaves the dark palette', async ($, on) => {
  const w = world(on)
  w.theme = null
  await $.session.start(START)
  await w.clock.advance(0)

  const ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
  expect(((await ui.find({ key: 'seg-system' }))?.children[0] as Node).props?.color).toBe(DARK.segments.system)
  await ui.unmount()
})

test('a band too narrow for any total draws nothing of ours', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, bodyColumns: 3 } })

    expect(await ui.find({ type: 'Text', text: /66k/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('pressing a segment opens the pane', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'seg-tool-results' })
  await ui.unmount()

  // The desktop opens it by a click posted from the Client: see desktop.test.tsx.
  expect(w.opened).toEqual(['context-breakdown'])
})

test('the mobile app, which has no Client, draws the bar as a picture and the total as a Button to level 1', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  const ui = await $.ui.mount({ ...WIDE, surface: 'mobile' })
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThan(0)
  const total = await ui.find({ type: 'Text', text: /\/200k/ })
  expect(total?.text.trim()).toBe('66k/200k 33%')
  // In the app's face, not the code font, with tabular digits.
  expect(total?.props.mono).toBeUndefined()
  expect(total?.props.tabular).toBe(true)
  await ui.press({ key: 'context-total' })
  await ui.unmount()

  expect(w.opened).toEqual(['context-breakdown'])
})

test('a subagent tool call does not measure; a main one does, once per burst', async ($, on) => {
  const w = world(on)

  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' })
  await w.clock.advance(5000)
  expect(w.usageCalls).toBe(0)

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'pwd' })
  await w.clock.advance(1000)
  expect(w.usageCalls).toBe(0)
  await w.clock.advance(2000)
  expect(w.usageCalls).toBe(1)
})

test('a lost tool timer does not stop later refreshes after tool calls', async ($, on) => {
  // Another mod refuses one wait: its function never runs, and no sign comes.
  // Registered before the world's clock, so it stands above it.
  let isRefusing = true
  on('clock.after', { ms: 3000 }, (_, e, next) => (isRefusing ? { deny: 'refused' } : next(e)))
  const w = world(on)

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await w.clock.advance(5000)
  expect(w.usageCalls).toBe(0)

  isRefusing = false
  await w.clock.advance(2000)
  await $.tool.call({ tool: 'Bash', command: 'pwd' })
  await w.clock.advance(3000)
  expect(w.usageCalls).toBe(1)
})

test('a second burst of tool calls measures again', async ($, on) => {
  const w = world(on)

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await w.clock.advance(3000)
  expect(w.usageCalls).toBe(1)

  await $.tool.call({ tool: 'Bash', command: 'pwd' })
  await w.clock.advance(3000)
  expect(w.usageCalls).toBe(2)
})

test('subagent turns and compactions change nothing', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)
  const calls = w.usageCalls

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
  await $.session.compact({ trigger: 'auto', messages: TRANSCRIPT, agentId: 'a1' })
  await w.clock.advance(5000)
  expect(w.usageCalls).toBe(calls)

  // A main turn after it measures, and finds no compaction to estimate.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await w.clock.advance(0)
  expect(w.usageCalls).toBe(calls + 1)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /\/200k/ }))?.text.trim()).toBe('66k/200k 33%')
  await ui.unmount()
})

test('a failed measurement after a compaction keeps the estimate for the next one', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  w.messages = SUMMARY
  await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT })
  w.usageFailures = 1
  await w.clock.advance(0)

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.advance(0)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /\/200k/ }))?.text.trim()).toBe('~28k/200k 14%')
  await ui.unmount()
})

test('a /clear drops the old fill and measures the new conversation', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  w.usage = usage(26_500, 500)
  w.messages = [{ role: 'user', content: [{ type: 'text', text: 'p'.repeat(500) }] }]
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /\/200k/ })).toBeUndefined()
    // The desktop's band is not drawn at all.
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
  }

  await w.clock.advance(0)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /\/200k/, ...inClient(surface) }))?.text.trim()).toBe('27k/200k 13%')
    await ui.unmount()
  }
})

test('after a compaction the band estimates and marks the total with ~', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  // Stale: the usage figures still read the pre-compaction fill.
  w.messages = SUMMARY
  await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT })
  await w.clock.advance(0)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })

    // 26k baseline plus 2,000 characters at one character a token.
    expect((await ui.find({ type: 'Text', text: /\/200k/, ...inClient(surface) }))?.text.trim()).toBe('~28k/200k 14%')
    if (surface === 'terminal') {
      // The texture keeps no background: the terminal's shows through it.
      const summary = (await ui.find({ key: 'seg-compaction-summary' }))?.children as Node[]
      expect(summary.map(run => run.props)).toEqual([{ color: DARK.segments['compaction-summary'] }])
    } else {
      // The same texture, in the Client's data: the colour, no background.
      const texture = (await ui.findAll({ type: 'Text', in: 'context-bar' })).filter(
        run => run.props.color === DARK.segments['compaction-summary'],
      )
      expect(texture.length).toBeGreaterThan(0)
      for (const run of texture) {
        expect(run.props.backgroundColor).toBeUndefined()
      }
    }
    await ui.unmount()
  }

  // The next response moves the figure: a fresh measurement replaces the estimate.
  w.usage = usage(26_600, 600)
  await $.session.measure({ context: w.usage.context, rateLimits: [], changed: ['context'] })
  await w.clock.advance(0)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /\/200k/ }))?.text.trim()).toBe('27k/200k 13%')
  await ui.unmount()
})

test('a precompute compaction changes nothing', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)
  const calls = w.usageCalls

  await $.session.compact({ trigger: 'precompute', messages: TRANSCRIPT })
  await w.clock.advance(0)

  expect(w.usageCalls).toBe(calls)
})

/** A started session that is early in a 1M window, so the bar is compressed. */
async function early($: Engine, on: Parameters<typeof world>[0]) {
  const w = world(on)
  const session = earlySession()
  w.usage = session.usage
  w.messages = session.messages
  await $.session.start(START)
  await w.clock.advance(0)

  return w
}

test('in an early 1M session the terminal draws a scale break: dim slashes, then a free dot, never a Button', async ($, on) => {
  const w = await early($, on)
  await seePane($, w)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 145 } })
  const row = await rowOf(ui)
  const at = row.flow.findIndex(item => item.text === SCALE_BREAK)
  // The host's dim ink, as the total's: no colour of the mod's own.
  expect(row.flow[at]?.node).toMatchObject({ type: 'Text', props: { dimColor: true } })
  expect(row.flow[at]?.node.props?.color).toBeUndefined()
  // Free space before it, one free dot after it, then the reserve.
  expect(row.flow[at - 1]?.text).toMatch(/^·+$/)
  expect(row.flow[at + 1]).toMatchObject({ text: FREE, node: { type: 'Text', props: { color: DARK.free } } })
  expect(row.flow[at + 2]?.text).toMatch(/^▒+$/)
  // It starts at the 103rd cell of the 105-cell bar: 28 segment cells and 61 free ones before it.
  expect(row.flow[at]?.start).toBe(89)
  expect(row.flow.filter(item => item.text.includes('╱'))).toHaveLength(1)
  // The tab order: one Button per segment, in bar order, and no other.
  expect((await ui.findAll({ type: 'Button' })).map(button => button.key)).toEqual([
    'seg-system',
    'seg-mcp',
    'seg-global-instructions',
    'seg-skills-agents',
    'seg-tool-results',
    'seg-injections',
  ])
  // A chip may lie over the break; none belongs to it, and none ends past the row.
  for (const chip of row.chips) {
    expect(chip.box.hover?.scope).toMatch(/^seg-/)
    expect((chip.box.props?.left as number) + chip.text.length).toBeLessThanOrEqual(row.width)
  }
  // The notifications' chip goes right of its cells, one cell away: the break's cells count.
  const notes = row.flow.find(item => item.node.props?.key === 'seg-injections')!
  expect(chipOf(row, 'injections')?.box.props?.left).toBe(notes.start + notes.text.length + CHIP_GAP)
  await ui.unmount()
})

/** The band's row as read, without the chips: the terminal's flow, or the desktop Client's runs. */
async function rowText(ui: { drawn: () => Promise<unknown> }, surface: 'terminal' | 'desktop'): Promise<string> {
  if (surface === 'terminal') {
    return (await rowOf(ui)).flow.map(item => item.text).join('')
  }
  const client = barRowOf(await ui.drawn()) as { props: { props: { runs: { text: string }[] } } }

  return client.props.props.runs.map(run => run.text).join('')
}

test('until the pane is first opened the band leads to /ctx; a click on the bar opens it and brings the legend', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...WIDE, surface })
    expect(await rowText(ui, surface)).toMatch(/ 66k\/200k 33% · \/ctx for details$/)
    await ui.unmount()
  }
  // The terminal draws it as dim text, as the total.
  const before = await $.ui.mount({ ...WIDE, surface: 'terminal' })
  expect((await rowOf(before)).flow.at(-1)?.node.props).toEqual({ dimColor: true })
  await before.press({ key: 'seg-tool-results' })
  await before.unmount()
  expect(w.opened).toEqual(['context-breakdown'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...WIDE, surface })
    const text = await rowText(ui, surface)
    expect(text).toMatch(/ 66k\/200k 33% · ▉ Tool results 30k$/)
    expect(text).not.toContain('/ctx')
    await ui.unmount()
  }

  // A new session leads to /ctx again.
  await $.session.start(START)
  await w.clock.advance(0)
  const again = await $.ui.mount({ ...WIDE, surface: 'terminal' })
  expect(await rowText(again, 'terminal')).toMatch(/ · \/ctx for details$/)
  await again.unmount()
})

test('the mobile app draws the hint after the total, in the app’s face, and the picture’s alt text says when free space is shortened', async ($, on) => {
  await early($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'mobile', props: { ...BAND.props, bodyColumns: 145 } })
  const hint = await ui.find({ type: 'Text', text: '/ctx for details' })
  expect(hint?.props).toMatchObject({ tabular: true, dimColor: true })
  const bar = (await ui.findAll({ type: 'Svg' }))[0]
  expect(bar?.props.alt).toBe('Context window: 69k/1M 7%, free space shortened')
  expect(String(bar?.props.source)).toContain('<title>Scale break: 750k of free space left out</title>')
  await ui.unmount()
})
