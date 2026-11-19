import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { ContextBreakdownList, ContextBreakdownSnapshot, ContextBreakdownView } from '../types'
import { CLICK_HINT, KEYS_HINT, describedText, keysHint, openWords, pastHidden, ringKey } from '../hooks/pane'
import { flatten } from './e2e/helpers'
import { DARK } from '../hooks/palette'
import { TABLE_MAX_COLUMNS } from '../hooks/table'
import { cellWidth } from '../hooks/text'
import { FOCUSED_PANE, PANE, SUMMARY, SURFACES, TRANSCRIPT, realSession, usage, world } from './fixtures'

const START = { cwd: '/home/user/project', surface: 'terminal', isInteractive: true } as const

test('/ctx opens the pane and prints no text', async ($, on) => {
  const w = world(on)
  await $.session.start(START)

  const result = await $.command.run({
    command: 'ctx',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })

  expect(result.text).toBeUndefined()
  expect(w.opened).toEqual(['context-breakdown'])
})

test('before a measurement the pane says so and keeps its controls', async ($, on) => {
  world(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })

    expect(await ui.find({ type: 'Text', text: /Measuring/ })).toBeDefined()
    expect((await ui.find({ key: 'close' }))?.props.hotkey).toBe('x')
    expect((await ui.find({ key: 'refresh' }))?.props.hotkey).toBe('r')
    await ui.unmount()

    // Without the keyboard the controls stay to click. The terminal offers no
    // key; a desktop keeps the hotkey, which it draws as a key cap and which
    // presses only while the pane holds the keys.
    const unfocused = await $.ui.mount({ ...PANE, surface })
    expect((await unfocused.find({ key: 'close' }))?.props.hotkey).toBe(surface === 'terminal' ? undefined : 'x')
    expect((await unfocused.find({ key: 'close' }))?.props.label).toBe('Close')
    await unfocused.unmount()
  }
})

test('the pane lists every segment by group, merged ones too', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const rows = await ui.findAll({ type: 'Button' })

    expect(rows.map(row => row.key)).toEqual([
      'row-system',
      'row-project-instructions',
      'row-skills-agents',
      'row-tool-results',
      'row-task-reports',
      'row-prompts',
      'row-claude-output',
      // No Back: the segments have no level to go back to. Close is last.
      'refresh',
      'close',
    ])
    // Shares are of what is used (66k), not of the window.
    if (surface === 'terminal') {
      // A desktop's row Button holds the name alone: see desktop.test.tsx.
      expect((await ui.find({ key: 'row-tool-results' }))?.text).toMatch(/Tool results +█+ +30k +45%$/)
      expect((await ui.find({ key: 'row-task-reports' }))?.text).toMatch(/Task reports +▏ +100 +0\.2%$/)
    }
    // Where the table has room the headings say what each group holds.
    expect(await ui.find({ type: 'Text', text: /Baseline · before your first prompt +26k +39%$/ })).toBeDefined()
    // 26k and 40k of 66k: 39.4% and 60.6%, rounded to the nearest they add up.
    expect(await ui.find({ type: 'Text', text: /Conversation · since the session started +40k +61%$/ })).toBeDefined()
    // Free space and Reserve have no share of what is used.
    expect(await ui.find({ type: 'Text', text: /Free space +·· +101k$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Reserve for compaction +▒▒ +33k$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ *Not loaded · outside the window$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /deferred/i })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'All numbers are estimates.' })).toBeDefined()
    await ui.unmount()
  }
})

test('the pane fits 24 and 80 columns', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  for (const surface of SURFACES) {
    for (const bodyColumns of [24, 80]) {
      const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns } })
      for (const row of await ui.findAll({ type: 'Button', text: /\d/ })) {
        expect(row.text.length).toBeLessThan(bodyColumns)
      }
      const free = await ui.find({ type: 'Text', text: /Free/ })
      expect(free?.text.length).toBeLessThan(bodyColumns)
      await ui.unmount()
    }
  }
})

test('at 24 columns every name reads whole, in its short form where needed', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns: 24 } })
    for (const text of await ui.findAll({ type: 'Text' })) {
      if (/\d/.test(text.text)) {
        expect(text.text).not.toMatch(/…/)
      }
    }
    if (surface === 'terminal') {
      expect((await ui.find({ key: 'row-system' }))?.text).toMatch(/System +20k$/)
      expect((await ui.find({ key: 'row-skills-agents' }))?.text).toMatch(/Skills\/agents +2k$/)
    }
    // On the terminal the full name names the control. A desktop's Button is
    // labelled with the short name it shows, and the figures stand beside it.
    const system = await ui.find({ key: 'row-system' })
    expect(system?.props.label).toBe(surface === 'terminal' ? 'System prompt and built-in tools' : 'System')
    expect((await ui.find({ key: 'row-skills-agents' }))?.props.label).toBe(surface === 'terminal' ? 'Skills list and custom agents' : 'Skills/agents')
    expect(await ui.find({ type: 'Text', text: /Conversation +40k$/ })).toBeDefined()
    // The key hint is wider than 24 cells: it wraps rather than losing its end.
    expect((await ui.find({ type: 'Text', text: keysHint(surface) }))?.props.wrap).toBe('wrap')
    await ui.unmount()
  }
})

test('the widget seat shows a glance with nothing to press', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, placement: 'widget', bodyColumns: 40 } })

    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /66k\/200k 33%/ })).toBeDefined()
    await ui.unmount()
  }
})

test('x closes the pane and r measures again', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)
  const calls = w.usageCalls

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })
    await ui.press({ key: 'close' })
    await ui.unmount()
  }

  expect(w.usageCalls).toBe(calls + 2)
  expect(w.closed).toEqual(['context-breakdown', 'context-breakdown'])
})

test('unreadable messages show one Conversation segment', async ($, on) => {
  const w = world(on)
  w.messages = null
  await $.session.start(START)
  await w.clock.advance(0)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    const row = await ui.find({ key: 'row-conversation' })
    if (surface === 'terminal') {
      expect(row?.text).toMatch(/Conversation +█+ +40k +61%$/)
    } else {
      expect(row?.props.label).toBe('Conversation')
    }
    expect(await ui.find({ key: 'row-tool-results' })).toBeUndefined()
    await ui.unmount()
  }
})

/** A measured session with the critique's numbers: 283k of 1M used. */
async function realWorld($: Engine, on: On) {
  const w = world(on)
  const real = realSession()
  w.usage = real.usage
  w.messages = real.messages
  await $.session.start(START)
  await w.clock.advance(0)

  return w
}

/** The cells a Button takes: its text, after the mark the engine draws for a hotkey. */
function buttonCells(button: { text: string; props: Record<string, unknown> }): number {
  return cellWidth(button.text) + (typeof button.props.hotkey === 'string' ? 3 : 0)
}

test('level 1 answers what fills the window: heading, shares of used, the largest row bold', async ($, on) => {
  await realWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
    expect(await ui.find({ type: 'Text', text: '283k used · 684k free before compaction' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ +1M window +% of used$/ })).toBeDefined()
    if (surface === 'terminal') {
      // A desktop's row Button holds the name alone: see desktop.test.tsx.
      expect((await ui.find({ key: 'row-tool-results' }))?.text).toMatch(/^Tool results +████████████ +114k +40%$/)
      expect((await ui.find({ key: 'row-auto-memory' }))?.text).toMatch(/^Auto-memory +▏ +976 +0\.3%$/)
      // Under one cell of 12 the summary draws an eighth, as Global instructions' 7.9k does.
      expect((await ui.find({ key: 'row-compaction-summary' }))?.text).toMatch(/^Compaction summary +▉ +7\.8k +2\.8%$/)
      expect((await ui.find({ key: 'row-global-instructions' }))?.text).toMatch(/ ▉ +7\.9k +2\.8%$/)
      // A whole-number share keeps its decimal, so the column lines up.
      expect((await ui.find({ key: 'row-prompts' }))?.text).toMatch(/ 2\.9k +1\.0%$/)
    }
    // 48k and 235k of 283k: 16.9% and 83.1%, which add up once rounded to the nearest.
    expect(await ui.find({ type: 'Text', text: /^ +Baseline · before your first prompt +48k +17%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ +Conversation · since the session started +235k +83%$/ })).toBeDefined()

    // The largest segment's name alone is bold; the group headings are dim.
    const bold = (await ui.findAll({ type: 'Text' })).filter(text => text.props.weight === 'bold')
    // A desktop's name is a Button label, which takes no weight: only the heading is bold there.
    expect(bold.map(text => text.text.trim())).toEqual(
      surface === 'terminal' ? ['283k used · 684k free before compaction', 'Tool results'] : ['283k used · 684k free before compaction'],
    )
    expect((await ui.find({ type: 'Text', text: /^ +Baseline/ }))?.props.dimColor).toBe(true)
    // One estimate note.
    expect(await ui.findAll({ type: 'Text', text: /estimate/ })).toHaveLength(1)
    await ui.unmount()
  }
})

test('the rows fit 24, 45, 64, 88 and 140 columns, and the table stops at its cap', async ($, on) => {
  await realWorld($, on)

  // A desktop's rows are a Button with the name beside Texts of figures: see desktop.test.tsx.
  for (const surface of ['terminal'] as const) {
    for (const bodyColumns of [24, 45, 64, 88, 140]) {
      const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns } })
      const rows = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('row-'))
      expect(rows).toHaveLength(10)
      for (const row of rows) {
        expect(buttonCells(row)).toBeLessThan(bodyColumns)
        expect(buttonCells(row)).toBeLessThanOrEqual(TABLE_MAX_COLUMNS)
      }
      for (const text of await ui.findAll({ type: 'Text', text: /\d$/ })) {
        expect(cellWidth(text.text)).toBeLessThan(bodyColumns)
      }
      // Every row in one width: the figures form one column.
      expect(new Set(rows.map(buttonCells)).size).toBe(1)
      // A length bar from 34 columns; below, a swatch leads the row instead.
      expect((await ui.find({ key: 'row-tool-results' }))?.text.includes('████')).toBe(bodyColumns >= 34)
      await ui.unmount()
    }
    // Wide panes draw the same table as a 64-column one.
    const wide = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns: 140 } })
    expect(buttonCells((await wide.find({ key: 'row-tool-results' }))!)).toBe(60)
    await wide.unmount()
  }
})

test('Free space, Reserve and Not loaded line up with the segment rows', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  // A desktop's rows are a Button with the name beside Texts of figures: see desktop.test.tsx.
  for (const surface of ['terminal'] as const) {
    for (const bodyColumns of [24, 45, 80]) {
      const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns } })
      // Without the keyboard the row draws its own mark, so its text starts where the row does.
      const segment = (await ui.find({ key: 'row-tool-results' }))!.text
      const free = (await ui.find({ type: 'Text', text: /Free space/ }))!.text
      const reserve = (await ui.find({ type: 'Text', text: /Reserve/ }))!.text
      const heading = (await ui.find({ type: 'Text', text: /Not loaded( · outside the window)?$/ }))!.text
      const deferred = (await ui.find({ type: 'Text', text: /MCP tools/ }))!.text
      const nameAt = segment.indexOf('Tool results')
      const tokensEnd = segment.indexOf('30k') + 3
      expect(free.indexOf('Free space')).toBe(nameAt)
      expect(reserve.indexOf('Reserve')).toBe(nameAt)
      expect(heading.indexOf('Not loaded')).toBe(nameAt)
      expect(deferred.indexOf('MCP tools')).toBe(nameAt)
      expect(free.indexOf('101k') + 4).toBe(tokensEnd)
      expect(reserve.indexOf('33k') + 3).toBe(tokensEnd)
      expect(deferred.indexOf('9k') + 2).toBe(tokensEnd)
      await ui.unmount()
    }
  }
})

/** A usage whose MCP tools of `servers` are not loaded: `[name, tools, tokens per tool]`. */
function withServers(servers: readonly (readonly [string, number, number])[]) {
  const base = usage(66_000)
  const mcpTools = servers.flatMap(([serverName, tools, tokens]) =>
    Array.from({ length: tools }, (_, i) => ({ name: `mcp__x__t${i}`, serverName, tokens, isLoaded: false })),
  )
  // One loaded tool: it is in the window, never in Not loaded.
  mcpTools.push({ name: 'mcp__loaded__one', serverName: 'loaded-only', tokens: 500, isLoaded: true })

  return { ...base, context: { ...base.context, breakdown: { ...base.context.breakdown!, mcpTools } } }
}

/**
 * Ten servers, one with a long name and one with control, zero-width, bidi
 * and 8-bit CSI characters in it.
 */
const TEN_SERVERS = [
  ['tickets', 40, 1000],
  ['a-server-name-far-too-long-for-any-pane-to-show-whole', 30, 1000],
  ['\x1b[31mre​d\x1b[0m‮\t\x9b1mteam', 20, 1000],
  ['notes', 10, 1000],
  ['maps', 9, 1000],
  ['calendar', 8, 1000],
  ['weather', 7, 1000],
  ['search', 6, 1000],
  ['files', 2, 1000],
  ['clock', 1, 1000],
] as const

test('Not loaded is one MCP tools row that counts the servers, opens their list, and comes after the segments in the ring', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)
  const ROWS = ['row-system', 'row-tool-results', 'row-claude-output']
  const before: Record<string, string> = {}
  for (const bodyColumns of [45, 68, 100]) {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns } })
    for (const key of ROWS) {
      before[`${bodyColumns} ${key}`] = (await ui.find({ key }))!.text
    }
    // No server: MCP tools is a plain line, no control.
    expect(await ui.find({ key: 'row-not-loaded' })).toBeUndefined()
    await ui.unmount()
  }
  w.usage = withServers(TEN_SERVERS)
  const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await first.press({ key: 'refresh' })
  await w.clock.advance(0)
  await first.unmount()

  // A desktop's rows are a Button with the name beside Texts of figures: see desktop.test.tsx.
  for (const bodyColumns of [45, 68, 100]) {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns } })
    const segment = (await ui.find({ key: 'row-tool-results' }))!.text
    const tokensEnd = segment.indexOf('30k') + 3
    const row = (await ui.find({ key: 'row-not-loaded' }))!
    expect(row.props.label).toBe('MCP tools')
    // All ten servers and their 133 tools; a narrower table drops the tools.
    expect(row.text).toMatch(bodyColumns >= 68 ? /MCP tools · 10 servers, 133 tools +9k *$/ : /MCP tools · 10 servers +9k *$/)
    // The eighth row that opens: its digit, as the segments before it.
    expect(row.text.startsWith('8: ')).toBe(true)
    expect(row.text.indexOf('9k') + 2).toBe(tokensEnd)
    // No line per server and no sentence about them at level 1.
    const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)
    expect(texts.some(text => /tickets|Per MCP server/.test(text))).toBe(false)
    // The rows above keep their place: the table is as it was without servers.
    for (const key of ROWS) {
      expect((await ui.find({ key }))!.text).toBe(before[`${bodyColumns} ${key}`]!)
    }
    // After the segment rows, before the controls.
    const keys = (await ui.findAll({ type: 'Button' })).map(button => button.key)
    expect(keys.slice(keys.indexOf('row-claude-output'), keys.indexOf('row-claude-output') + 3)).toEqual([
      'row-claude-output',
      'row-not-loaded',
      'refresh',
    ])
    await ui.unmount()
  }
})

test('the list of servers: one row per server, largest first, s for most tools first, and b back onto its row', async ($, on) => {
  const w = world(on)
  const servers = withServers([...TEN_SERVERS, ['many', 50, 100]])
  // The servers' tools add up to 138k; the category's own figure is 160k.
  // The list shows the category's figure, as level 1's row does.
  const categories = servers.context.breakdown!.categories.map(category =>
    category.name === 'MCP tools (deferred)' ? { ...category, tokens: 160_000 } : category,
  )
  w.usage = { ...servers, context: { ...servers.context, breakdown: { ...servers.context.breakdown!, categories } } }
  await $.session.start(START)
  await w.clock.advance(0)

  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal', props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
  expect((await ui.find({ key: 'row-not-loaded' }))?.text).toMatch(/ 160k *$/)
  await ui.press({ key: 'row-not-loaded' })
  expect((await ui.find({ type: 'Text', text: /^Context › / }))?.text).toBe('Context › Not loaded › MCP tools  160k once loaded')
  expect(await ui.find({ type: 'Text', text: 'Tool schemas that Claude Code loads on demand. Not in the window.' })).toBeDefined()
  // The facts and the column name share a row; the shares are of the category's figure.
  expect(await ui.find({ type: 'Text', text: /^11 servers · 183 tools · largest first +% of 160k$/ })).toBeDefined()
  // Rows do not open: no Button, no ring on a row. No row opens, so a dim
  // title would mark nothing: the names are at full strength.
  expect((await ui.findAll({ type: 'Button' })).filter(button => /^item-/.test(button.key ?? ''))).toEqual([])
  const tickets = (await ui.findAll({ type: 'Text' })).find(text => text.text.trim().startsWith('tickets') && !/tools/.test(text.text))
  expect(tickets).toBeDefined()
  expect(tickets?.props.dimColor).toBeUndefined()
  const BAR = /tools? +[█▉▊▋▌▍▎▏]/
  const rows = (await ui.findAll({ type: 'Text' })).map(text => text.text).filter(text => BAR.test(text))
  expect(rows).toHaveLength(11)
  expect(rows[0]).toMatch(/^ +tickets +40 tools +█+ +40k +25%$/)
  expect(rows[2]).toMatch(/^ +red team +20 tools /)
  expect(rows[1]).toMatch(/a-server-name.*… +30 tools /)
  expect(rows.find(row => /^ +many /.test(row))).toMatch(/^ +many +50 tools +[█▌]+ +5k +3\.1%$/)
  expect(rows[10]).toMatch(/^ +clock +1 tool +▎ +1k +0\.6%$/)
  expect(rows.join('\n')).not.toMatch(/\x1b|\t|\x9b|​|‮|1m|loaded-only/)
  // The bar is the neutral grey, no segment's colour.
  const bar = (await ui.findAll({ type: 'Text' })).find(text => /^█+$/.test(text.text))
  expect(bar?.props.color).toBe(DARK.notLoaded)

  // s names the order it switches to.
  expect((await ui.find({ key: 'sort' }))?.props.label).toBe('Most tools first')
  await ui.press({ key: 'sort' })
  expect(await ui.find({ type: 'Text', text: /^11 servers · 183 tools · most tools first/ })).toBeDefined()
  expect((await ui.find({ key: 'sort' }))?.props.label).toBe('Largest first')
  const sorted = (await ui.findAll({ type: 'Text' })).map(text => text.text).filter(text => BAR.test(text))
  expect(sorted[0]).toMatch(/^ +many +50 tools /)
  // One page: p and n leave the line.
  expect(await ui.find({ key: 'prev' })).toBeUndefined()
  expect(await ui.find({ key: 'next' })).toBeUndefined()

  // b goes back to the segments with the ring on the MCP tools row.
  await ui.press({ key: 'back' })
  expect((await ui.findAll({ type: 'Button' })).filter(button => button.props.autoFocus === true).map(button => button.key)).toEqual([
    'row-not-loaded',
  ])

  // A measurement rebuilds the list; with no server left, the segments show.
  await ui.press({ key: 'row-not-loaded' })
  w.usage = usage(66_000)
  await ui.press({ key: 'refresh' })
  await w.clock.advance(0)
  expect(await ui.find({ key: 'row-system' })).toBeDefined()
  expect(await ui.find({ key: 'row-not-loaded' })).toBeUndefined()
  await ui.unmount()
})

test('/ctx not, not-loaded and the starts of "not loaded" open the servers; the words that named a segment before still do', async ($, on) => {
  const w = world(on)
  w.usage = withServers([['tickets', 4, 1000]])
  await $.session.start(START)
  await w.clock.advance(0)
  const run = (args: string) =>
    $.command.run({ command: 'ctx', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

  // "not" is a name of the list: an exact name wins over a start of "Notifications".
  for (const args of ['not', 'NOT', 'not l', 'not loaded', 'NOT L', 'not-loaded', 'not-']) {
    await run(args)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect({ args, crumb: (await ui.find({ type: 'Text', text: /^Context › / }))?.text }).toEqual({
      args,
      crumb: expect.stringMatching(/^Context › Not loaded › MCP tools/),
    })
    await ui.unmount()
  }
  // The segments keep their matches and their order, and the list comes last:
  // a start that named System notifications before the list existed still does.
  for (const args of ['n', 'no', 'N', 'noti', 'notif']) {
    await run(args)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect({ args, crumb: (await ui.find({ type: 'Text', text: /^Context › / }))?.text }).toEqual({
      args,
      crumb: expect.stringMatching(/System notifications/),
    })
    await ui.unmount()
  }

  w.usage = usage(66_000)
  await run('')
  await w.clock.advance(0)
  await run('not')
  const none = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await none.find({ type: 'Text', text: 'No segment matches "not".' })).toBeDefined()
  expect(await none.find({ key: 'row-system' })).toBeDefined()
  await none.unmount()
})

test('with no token figure for the servers, the list orders by tools, draws no bar or share, and has no s', async ($, on) => {
  const w = world(on)
  const zero = withServers([
    ['notes', 2, 0],
    ['tickets', 4, 0],
  ])
  const categories = zero.context.breakdown.categories.map(category =>
    category.kind === 'deferred' ? { ...category, tokens: 0 } : category,
  )
  w.usage = { ...zero, context: { ...zero.context, breakdown: { ...zero.context.breakdown, categories } } }
  await $.session.start(START)
  await w.clock.advance(0)

  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal', props: { ...FOCUSED_PANE.props, bodyColumns: 68 } })
  // The row stays a control with no figure: the token cell is empty.
  expect((await ui.find({ key: 'row-not-loaded' }))?.text).toMatch(/MCP tools · 2 servers, 6 tools *$/)
  await ui.press({ key: 'row-not-loaded' })
  expect((await ui.find({ type: 'Text', text: /^Context › / }))?.text).toBe('Context › Not loaded › MCP tools')
  expect(await ui.find({ type: 'Text', text: '2 servers · 6 tools · most tools first' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /% of/ })).toBeUndefined()
  const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)
  const at = texts.findIndex(text => /^ +tickets +4 tools$/.test(text))
  expect(at).toBeGreaterThan(-1)
  expect(texts.slice(at).find(text => /^ +notes/.test(text))).toMatch(/^ +notes +2 tools$/)
  // One order only: s leaves the line, and on the terminal the pane still takes its key.
  expect(await ui.find({ key: 'sort' })).toBeUndefined()
  expect((await ui.find({ key: 'taken-s' }))?.props.hotkey).toBe('s')
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('after a compaction the heading marks its figures with ~, and one note says why', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)
  w.messages = SUMMARY
  await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT })
  await w.clock.advance(0)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '~28k used · ~139k free before compaction' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /~% of used$/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /estimate/ })).toHaveLength(1)
    await ui.unmount()
  }
})

test('without the keyboard the key line says how to get it; the terminal dims the marks, a desktop keeps its key caps', async ($, on) => {
  await realWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // ctrl+x tab reaches the bar only: the terminal names a click and /ctx.
    const hint = (await ui.find({ type: 'Text', text: keysHint(surface) }))!
    expect(hint.text).toBe(surface === 'terminal' ? KEYS_HINT : CLICK_HINT)
    expect(hint.props.dimColor).toBe(true)
    expect(hint.props.wrap).toBe('wrap')
    // The terminal drops the key words; a desktop keeps them, so Esc adds only the hint's row there.
    expect((await ui.find({ type: 'Text', text: /1-9/ })) === undefined).toBe(surface === 'terminal')
    const row = (await ui.find({ key: 'row-system' }))!
    // The terminal's Button draws a dim mark in its text and has no hotkey. A
    // desktop's Button keeps its hotkey, drawn as a key cap, and the mod draws
    // no mark of its own.
    expect(row.props.hotkey).toBe(surface === 'terminal' ? undefined : '1')
    expect(row.text.startsWith('1: ')).toBe(surface === 'terminal')
    const marks = await ui.findAll({ type: 'Text', text: '1: ' })
    expect(marks.length > 0).toBe(surface === 'terminal')
    expect(marks.every(mark => mark.props.dimColor === true)).toBe(true)
    // The controls stay to click; on the terminal they offer no key.
    expect((await ui.find({ key: 'close' }))?.props.hotkey).toBe(surface === 'terminal' ? undefined : 'x')

    // The pane takes the keyboard: the keys show.
    await ui.redraw({ ...PANE.props, isFocused: true })
    expect(await ui.find({ type: 'Text', text: keysHint(surface) })).toBeUndefined()
    // The words name Enter and the digits, 0 for the tenth row; the arrows and Tab go unnamed.
    expect(await ui.find({ type: 'Text', text: /Move/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '⏎ 1-9 0: Open' })).toBeDefined()
    expect((await ui.find({ key: 'row-system' }))?.props.hotkey).toBe('1')
    expect((await ui.find({ key: 'row-system' }))?.text.startsWith('1: ')).toBe(false)
    // Both surfaces leave the digit to the Button.
    expect(await ui.findAll({ type: 'Text', text: '1: ' })).toEqual([])
    expect((await ui.find({ key: 'close' }))?.props.hotkey).toBe('x')
    await ui.unmount()
  }
})

test('on the terminal a dim line describes the row with the ring, in two rows that never move; other surfaces draw none', async ($, on) => {
  await realWorld($, on)
  const ring = (element: string) =>
    $.ui.focus({ component: 'Pane', requestId: 'context-breakdown', plugin: 'context-breakdown', element, origin: { kind: 'person' } })
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal', props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
  /** The two rows above "All numbers are estimates.", and where they stand. */
  const described = async () => {
    const lines = flatten(await ui.drawn(), { columns: 88 })
    const at = lines.indexOf('All numbers are estimates.')

    return { at, rows: lines.slice(at - 3, at - 1), around: [lines[at - 4], lines[at - 1]] }
  }
  // The first row holds the ring: its name, then its definition, no wider than the table.
  const first = await described()
  expect(first.rows).toEqual(['System prompt and built-in tools: Claude Code’s own', 'instructions and tool schemas.'])
  expect(first.around).toEqual(['', ''])
  const table = cellWidth((await ui.find({ key: 'row-system' }))!.text) + 3
  expect(first.rows.every(row => cellWidth(row) <= table)).toBe(true)
  // The ring moves: the line follows it, and nothing below it moves.
  await ring('row-tool-results')
  const tools = await described()
  expect(tools.rows).toEqual(['Tool results: the output of tool calls, such as file reads', 'and command output.'])
  expect(tools.at).toBe(first.at)
  // One row of text still takes two rows.
  await ring('row-claude-output')
  expect((await described()).rows).toEqual(['Claude output: replies, thinking and tool-call inputs.', ''])
  // On a control: blank, in the same two rows.
  await ring('refresh')
  const blank = await described()
  expect([blank.rows, blank.at]).toEqual([['', ''], first.at])
  // Without the keyboard: blank too.
  await ui.redraw({ ...PANE.props, bodyColumns: 88 })
  const idle = await described()
  expect([idle.rows, idle.at]).toEqual([['', ''], first.at])
  await ring('row-system')
  await ui.unmount()

  // The desktop does not report where the focus is: no such line.
  const desktop = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
  expect(await desktop.find({ type: 'Text', text: /^System prompt and built-in tools: / })).toBeUndefined()
  await desktop.unmount()
})

test('describedText names the row and says what it holds; nothing for a control', () => {
  expect(describedText('row-tool-results')).toBe('Tool results: the output of tool calls, such as file reads and command output.')
  expect(describedText('row-not-loaded')).toBe('MCP tools: tool schemas that Claude Code loads on demand. Not in the window.')
  expect(describedText('refresh')).toBe('')
  expect(describedText('')).toBe('')
  expect(describedText(null)).toBe('')
})

test('the open words for each state', () => {
  // Without the keyboard the hint stands on its own line, apart from the controls.
  expect(openWords(9, 88, false)).toEqual([])
  expect(openWords(0, 88, false)).toEqual([])
  expect(keysHint('terminal')).toBe('For keys: click the pane, or run /ctx')
  expect(keysHint('desktop')).toBe('Click the pane for keys')
  // The arrows and Tab still move the ring, unnamed: only Enter and the digits are named.
  expect(openWords(9, 88, true)).toEqual(['⏎ 1-9: Open'])
  // A tenth row that opens takes 0.
  expect(openWords(10, 88, true)).toEqual(['⏎ 1-9 0: Open'])
  expect(openWords(20, 88, true)).toEqual(['⏎ 1-9 0: Open'])
  // Too narrow for digits: Enter alone.
  expect(openWords(10, 24, true)).toEqual(['⏎: Open'])
  // No row that opens: nothing to open.
  expect(openWords(0, 88, true)).toEqual([])
})

test('the tenth row takes 0; rows after it: Tab reaches them from the first row, which takes the ring', async ($, on) => {
  await realWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
    const rows = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('row-'))
    expect(rows.map(row => row.props.hotkey ?? null)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
    expect(rows.filter(row => row.props.autoFocus === true).map(row => row.key)).toEqual(['row-system'])
    // The tenth row is a Button: Tab walks onto it and Enter presses it.
    await ui.press({ key: 'row-claude-output' })
    expect(await ui.find({ type: 'Text', text: /Claude output/ })).toBeDefined()
    await ui.press({ key: 'back' })

    await ui.press({ key: 'row-tool-results' })
    const items = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('item-'))
    // The page keeps its twenty rows: all twelve items on one page.
    expect(items).toHaveLength(12)
    expect(items.slice(9).map(item => item.props.hotkey)).toEqual(['0', undefined, undefined])
    expect(items.filter(item => item.props.autoFocus === true).map(item => item.key)).toEqual(['item-r:real0'])
    await ui.press({ key: 'back' })
    // b put the ring back on Tool results; leave the view as the next surface expects it.
    expect((await ui.findAll({ type: 'Button' })).filter(row => row.props.autoFocus === true).map(row => row.key)).toEqual(['row-tool-results'])
    await ui.press({ key: 'row-system' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('b puts the ring back on the row it came from, on its page; a new list rings its first row', async ($, on) => {
  await realWorld($, on)
  const ringed = async (ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined; props: Record<string, unknown> }[]> }) =>
    (await ui.findAll({ type: 'Button' })).filter(button => button.props.autoFocus === true).map(button => button.key)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
    await ui.press({ key: 'row-tool-results' })
    expect(await ringed(ui)).toEqual(['item-r:real0'])
    await ui.press({ key: 'item-r:real3' })
    // Level 3: the first control takes the ring, and it stands above the text.
    // Off the terminal that is Back: level 3 there draws no Down and Up.
    expect(await ringed(ui)).toEqual([surface === 'terminal' ? 'scroll-down' : 'back'])
    await ui.press({ key: 'back' })
    expect(await ringed(ui)).toEqual(['item-r:real3'])
    await ui.press({ key: 'back' })
    expect(await ringed(ui)).toEqual(['row-tool-results'])
    // Any other move starts on the first row again. Off the terminal a sort
    // keeps the level, so no row asks for the ring: a desktop would move the
    // focus off the Sort control to it.
    await ui.press({ key: 'row-claude-output' })
    expect((await ringed(ui))[0]?.startsWith('item-')).toBe(true)
    await ui.press({ key: 'sort' })
    if (surface === 'terminal') {
      expect((await ringed(ui))[0]?.startsWith('item-')).toBe(true)
    } else {
      expect(await ringed(ui)).toEqual([])
    }
    await ui.press({ key: 'back' })
    expect(await ringed(ui)).toEqual(['row-claude-output'])
    await ui.press({ key: 'row-system' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('level 2: a breadcrumb with totals, bars to the largest item, shares of the segment', async ($, on) => {
  await realWorld($, on)

  // A desktop's rows are a Button with the name beside Texts of figures: see desktop.test.tsx.
  for (const surface of ['terminal'] as const) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
    await ui.press({ key: 'row-tool-results' })
    const crumb = (await ui.find({ type: 'Text', text: /^Context › / }))!
    expect(crumb.text).toBe('Context › ██ Tool results  114k · 40% of used')
    // The facts and the column name share one row, the name ending at the share column.
    const header = (await ui.find({ type: 'Text', text: /^12 items · largest first +% of segment$/ }))!
    const first = (await ui.find({ key: 'item-r:real0' }))!.text
    expect(cellWidth(header.text)).toBe(cellWidth(first) + 3)
    // Under the title, the segment's definition as a sentence, in lines no wider than the table.
    const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)
    const at = texts.indexOf('The output of tool calls, such as file reads and command')
    expect(at).toBeGreaterThan(-1)
    expect(texts[at + 1]).toBe('output.')
    expect(cellWidth(texts[at]!)).toBeLessThanOrEqual(cellWidth(header.text))
    expect((await ui.find({ key: 'sort' }))?.props.label).toBe('Newest first')
    expect((await ui.find({ key: 'item-r:real0' }))?.text).toMatch(/^Read  ~\/project\/src\/module-1\.ts +████████████ +31k +27%$/)
    expect((await ui.find({ key: 'item-r:real11' }))?.text).toMatch(/^ +Bash  npm run step-12 +▎ +600 +0\.5%$/)
    // The colour shows once, in the breadcrumb: no per-row swatch.
    const items = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('item-'))
    for (const item of items) {
      expect(item.text).not.toMatch(/^ *██ /)
      expect(buttonCells(item)).toBeLessThanOrEqual(TABLE_MAX_COLUMNS)
    }
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

type Found = { type: string; text: string; props: Record<string, unknown>; children: readonly unknown[] }
const isFound = (x: unknown): x is Found => typeof x === 'object' && x !== null && 'type' in x

test('every part of a table row asks for the monospaced face, so the columns line up off the terminal', async ($, on) => {
  await realWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns: 88 } })
    const parts = async (key: string) => ((await ui.find({ key }))?.children ?? []).filter(child => child !== '')
    for (const key of ['row-tool-results', 'row-system', 'row-claude-output']) {
      const children = await parts(key)
      // No bare string: each part is a Text drawn mono.
      expect(children.every(child => isFound(child) && child.type === 'Text' && child.props.mono === true)).toBe(true)
    }
    const figures = (await ui.find({ type: 'Text', text: /^ +114k +40%$/ }))!
    expect(figures.props.tabular).toBe(true)
    for (const line of [/^ +1M window/, /^ +Baseline/, /Free space/, /Reserve/]) {
      expect((await ui.find({ type: 'Text', text: line }))?.props.mono).toBe(true)
    }

    await ui.press({ key: 'row-tool-results' })
    for (const child of await parts('item-r:real0')) {
      expect(isFound(child) && child.props.mono === true).toBe(true)
    }
    expect((await ui.find({ type: 'Text', text: / +% of segment$/ }))?.props.mono).toBe(true)
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a row’s length bar reads the same when the focus ring or the pointer inverts the row', async ($, on) => {
  await realWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal', props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
  const textOf = (x: unknown): string =>
    typeof x === 'string' ? x : isFound(x) ? (x.children ?? []).map(textOf).join('') : ''
  const runs = async (key: string) =>
    ((await ui.find({ key }))?.children ?? []).filter(isFound).map(part => ({ text: textOf(part), props: part.props }))
  const check = (parts: { text: string; props: Record<string, unknown> }[], color: string, bar: RegExp) => {
    // Whole blocks on their own colour: inverted, the same cells.
    const whole = parts.filter(part => /^█+$/.test(part.text))
    for (const part of whole) {
      expect(part.props).toMatchObject({ color, backgroundColor: color })
    }
    // No coloured run of spaces: inverted, padding would take the colour.
    for (const part of parts.filter(one => one.props.color !== undefined)) {
      expect(part.text.trim()).not.toBe('')
    }
    expect(parts.map(part => part.text).join('')).toMatch(bar)
  }

  // Level 1: the largest row fills the bar; a small one is an eighth block
  // (drawn the other way round under the ring or the pointer; see the next
  // test) and uncoloured padding.
  check(await runs('row-tool-results'), DARK.segments['tool-results'], / ████████████ /)
  const memory = await runs('row-auto-memory')
  check(memory, DARK.segments['auto-memory'], / ▏ +976/)
  expect(memory.find(part => part.text === '▏')?.props).toMatchObject({ color: DARK.segments['auto-memory'] })
  expect(memory.find(part => part.text === '▏')?.props.backgroundColor).toBeUndefined()

  // Level 2: the same, in the segment's colour.
  await ui.press({ key: 'row-tool-results' })
  check(await runs('item-r:real0'), DARK.segments['tool-results'], / ████████████ /)
  check(await runs('item-r:real11'), DARK.segments['tool-results'], / ▎ +600/)
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('the row under the ring is one highlight: its figures at full strength, its part-filled cell the other way round', async ($, on) => {
  await realWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal', props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
  const textOf = (x: unknown): string =>
    typeof x === 'string' ? x : isFound(x) ? (x.children ?? []).map(textOf).join('') : ''
  // The kit gives a part's hover overrides beside its props.
  type Part = { text: string; props: Record<string, unknown>; hover: Record<string, unknown> | undefined }
  const partsOf = (found: { children?: readonly unknown[] } | undefined): Part[] =>
    (found?.children ?? [])
      .filter(isFound)
      .map(part => ({ text: textOf(part), props: part.props, hover: (part as { hover?: Record<string, unknown> }).hover }))
  const runs = async (key: string) => partsOf(await ui.find({ key }))
  const color = DARK.segments['auto-memory']
  // The last part: a pane without the keyboard draws a dim "N: " mark first.
  const figures = (parts: Part[]) => parts[parts.length - 1]!
  const partCell = (parts: Part[]) => parts.find(part => part.text === '▏')!
  const ring = (element: string) =>
    $.ui.focus({ component: 'Pane', requestId: 'context-breakdown', plugin: 'context-breakdown', element, origin: { kind: 'person' } })

  // At rest: dim figures and the glyph in the segment's colour. The hover
  // group of the row's own key gives both the lit style under the pointer.
  let memory = await runs('row-auto-memory')
  expect(figures(memory).props.dimColor).toBe(true)
  expect(figures(memory).hover).toEqual({ scope: 'row-auto-memory', dimColor: false })
  expect(partCell(memory).props.color).toBe(color)
  expect(partCell(memory).hover).toEqual({ scope: 'row-auto-memory', color: 'text', backgroundColor: color })
  expect(partCell(memory).props.backgroundColor).toBeUndefined()
  // The Button heats the group: without that, no part would follow the pointer.
  const walk = (node: unknown): unknown[] => (isFound(node) ? [node, ...(node.children ?? []).flatMap(walk)] : [])
  const button = walk(await ui.drawn()).find(node => isFound(node) && node.props.key === 'row-auto-memory')
  expect((button as { hover?: unknown } | undefined)?.hover).toEqual({ scope: 'row-auto-memory' })
  // Before any focus event the ring is where the tree asks for it: the first row.
  expect(figures(await runs('row-system')).props.dimColor).toBe(false)

  // The person moves the ring: that row is lit, the first row is at rest again.
  await ring('row-auto-memory')
  memory = await runs('row-auto-memory')
  expect(figures(memory).props.dimColor).toBe(false)
  // Inverted by the engine, the segment's colour fills the glyph and the highlight the rest.
  expect(partCell(memory).props.backgroundColor).toBe(color)
  expect(partCell(memory).props.color).toBeUndefined()
  expect(figures(await runs('row-system')).props.dimColor).toBe(true)
  // The row that asks for the ring is still the first one: a new tree starts there.
  expect((await ui.findAll({ type: 'Button' })).filter(row => row.props.autoFocus === true).map(row => row.key)).toEqual(['row-system'])

  // The ring on a control: no row is lit. Another mod's element says nothing about our pane.
  await ring('list-down')
  expect(figures(await runs('row-auto-memory')).props.dimColor).toBe(true)
  expect(figures(await runs('row-system')).props.dimColor).toBe(true)
  await ring('row-system')
  await $.ui.focus({ component: 'Pane', requestId: 'some-pane', plugin: 'other-mod', element: 'row-auto-memory', origin: { kind: 'person' } })
  expect(figures(await runs('row-system')).props.dimColor).toBe(false)
  // The ring on the pane's close mark, a stop of the engine's with no element: no row is lit.
  await $.ui.focus({ component: 'Pane', requestId: 'context-breakdown', origin: { kind: 'person' } })
  expect(figures(await runs('row-system')).props.dimColor).toBe(true)
  await ring('row-system')

  // Level 2: a new tree lights the row that asks for the ring, and its dim path with it.
  await ui.press({ key: 'row-tool-results' })
  const first = await runs('item-r:real0')
  expect(first.every(part => part.props.dimColor !== true)).toBe(true)
  const last = await runs('item-r:real11')
  expect(figures(last).props.dimColor).toBe(true)
  expect(last.filter(part => part.props.dimColor === true).every(part => part.hover?.dimColor === false)).toBe(true)
  await ui.press({ key: 'back' })
  await ui.unmount()

  // A pane without the keyboard shows no ring: the row the ring was noted on,
  // and the row that would ask for it, are at rest.
  await ring('row-auto-memory')
  const idle = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 88 } })
  const idleRuns = async (key: string) => partsOf(await idle.find({ key }))
  expect(figures(await idleRuns('row-system')).props.dimColor).toBe(true)
  const idleMemory = await idleRuns('row-auto-memory')
  expect(figures(idleMemory).props.dimColor).toBe(true)
  expect(partCell(idleMemory).props.color).toBe(color)
  expect(partCell(idleMemory).props.backgroundColor).toBeUndefined()
  await idle.unmount()
  // A desktop swaps nothing and keeps its figures outside the Button: see desktop.test.tsx.
})

test('level 2 at 24 columns: no swatch on the rows, and the facts line fits', async ($, on) => {
  await realWorld($, on)

  // A desktop's rows are a Button with the name beside Texts of figures: see desktop.test.tsx.
  for (const surface of ['terminal'] as const) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns: 24 } })
    await ui.press({ key: 'row-tool-results' })
    const items = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('item-'))
    expect(items).toHaveLength(12)
    for (const item of items) {
      expect(item.text).not.toMatch(/██/)
      expect(cellWidth(item.text)).toBeLessThan(24)
    }
    // The cells the swatch took go to the name: 17 cells, its tokens after.
    expect((await ui.find({ key: 'item-r:real2' }))?.text).toMatch(/^Bash  npm run st… +\d/)
    // The breadcrumb still shows the colour once.
    expect(await ui.find({ type: 'Text', text: /^██ Tool results/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '12 items · largest first' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '12 items' })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

/** 2,048 Bash calls: 4,097 messages, past what can be read, so the oldest results are not listed. */
function cutConversation(): unknown[] {
  const out: unknown[] = [{ role: 'user', content: [{ type: 'text', text: 'Run them all.' }] }]
  for (let k = 1; k <= 2048; k += 1) {
    out.push({ role: 'assistant', content: [{ type: 'tool_use', id: `c${k}`, name: 'Bash', input: { command: `s${k}` } }] })
    out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `c${k}`, content: 'o'.repeat(k === 2048 ? 20_000 : 10) }] })
  }

  return out
}

/** "28k" or "950" as a number of tokens. */
function tokensOf(text: string): number {
  const n = Number.parseFloat(text)

  return text.endsWith('k') ? n * 1000 : n
}

test('level 2 shares are of the segment figure the breadcrumb shows, also for a cut list', async ($, on) => {
  const w = world(on)
  w.messages = cutConversation()
  await $.session.start(START)
  await w.clock.advance(0)

  // A desktop's rows are a Button with the name beside Texts of figures: see desktop.test.tsx.
  for (const surface of ['terminal'] as const) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
    await ui.press({ key: 'row-tool-results' })
    expect(await ui.find({ type: 'Text', text: /older items are not listed/ })).toBeDefined()
    const crumb = (await ui.find({ type: 'Text', text: /^Context › / }))!.text
    const segment = tokensOf(/Tool results {2}([\d.]+k?)/.exec(crumb)![1]!)
    const row = (await ui.find({ key: 'item-r:c2048' }))!.text
    const [, amount, share] = / ([\d.]+k?) +([\d.]+)%$/.exec(row)!
    // The largest item is most of the listed items, but well under half of the segment.
    expect(Math.abs(Number(share) - (tokensOf(amount!) / segment) * 100)).toBeLessThan(3)
    expect(Number(share)).toBeLessThan(50)
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('ringKey: the row b came back from when it is shown, else the first; at level 3 the first control or the one under the text', async () => {
  const snapshot = {
    window: 200_000,
    reserve: 33_000,
    baseline: [
      { id: 'system', tokens: 20_000 },
      { id: 'mcp', tokens: 0 },
    ],
    conversation: [{ id: 'tool-results', tokens: 30_000 }],
    deferred: [],
    notLoadedServers: [],
    isEstimate: false,
    staleTokens: null,
    charsPerToken: 4,
    measuredAt: 0,
  } as const satisfies ContextBreakdownSnapshot
  const level1 = { seq: 1, gen: 0, level: 1 } as const
  expect(ringKey(level1, snapshot, true)).toBe('row-system')
  expect(ringKey({ ...level1, from: 'tool-results' }, snapshot, true)).toBe('row-tool-results')
  // A segment that holds nothing now has no row: the first row instead.
  expect(ringKey({ ...level1, from: 'mcp' }, snapshot, true)).toBe('row-system')
  // j's Button at levels 1 and 2 has a key of its own: level 3's never stands
  // in the tree a press leaves, so `$.ui.focus` waits for the new tree.
  expect(ringKey(level1, null, true)).toBe('list-down')
  // Level 1 draws no Back: its first control is Refresh.
  expect(ringKey(level1, null, false)).toBe('refresh')
  expect(ringKey({ seq: 1, gen: 0, level: 1 }, null, false, 'desktop')).toBe('refresh')
  // The MCP tools row of Not loaded opens a list too: b comes back onto it.
  const withServers = { ...snapshot, notLoadedServers: [{ name: 'tickets', tools: 2, tokens: 10 }] }
  expect(ringKey({ ...level1, from: 'not-loaded' }, withServers, true)).toBe('row-not-loaded')
  expect(ringKey({ ...level1, from: 'not-loaded' }, snapshot, true)).toBe('row-system')

  const row = (id: string, isOpenable = true) => ({ id, title: id, detail: '', pathIn: null, tokens: 1, isOpenable })
  const list = {
    segment: 'tool-results',
    sort: 'size',
    canSort: true,
    page: 0,
    pages: 2,
    rows: [row('a', false), row('b'), row('c')],
    items: 30,
    tokens: 30,
    hiddenItems: 27,
    hiddenTokens: 27,
    note: null,
  } as const satisfies ContextBreakdownList
  expect(ringKey({ seq: 1, gen: 0, level: 2, list }, snapshot, true)).toBe('item-b')
  expect(ringKey({ seq: 1, gen: 0, level: 2, list, from: 'c' }, snapshot, true)).toBe('item-c')
  // On another page now: the first row of this one.
  expect(ringKey({ seq: 1, gen: 0, level: 2, list, from: 'z' }, snapshot, true)).toBe('item-b')
  expect(ringKey({ seq: 1, gen: 0, level: 2, list: { ...list, rows: [row('a', false)] } }, snapshot, true)).toBe('list-down')

  // pastHidden: a Tab onto a hidden Button from Close goes on to the first
  // element; from anywhere else, back to Close. Other elements stay.
  const level2 = { seq: 1, gen: 0, level: 2, list, from: 'c' } as const
  expect(pastHidden('taken-b', 'close', level1, snapshot)).toBe('row-system')
  expect(pastHidden('taken-p', 'close', level2, snapshot)).toBe('item-b')
  expect(pastHidden('taken-p', 'close', { ...level2, list: { ...list, rows: [row('a', false)] } }, snapshot)).toBe('list-down')
  for (const before of [null, '', 'row-system', 'refresh', 'list-down']) {
    expect(pastHidden('taken-b', before, level1, snapshot)).toBe('close')
  }
  for (const element of [undefined, 'close', 'row-system', 'list-down']) {
    expect(pastHidden(element, 'close', level1, snapshot)).toBeNull()
  }
})

test('pastHidden at level 3: from Close on to the Next page button below the text where it is drawn, else to j', () => {
  const list = {
    segment: 'tool-results',
    sort: 'size',
    canSort: true,
    page: 0,
    pages: 1,
    rows: [],
    items: 1,
    tokens: 1,
    hiddenItems: 0,
    hiddenTokens: 0,
    note: null,
  } as const satisfies ContextBreakdownList
  const item = { page: 0, pages: 1 } as unknown as Extract<ContextBreakdownView, { level: 3 }>['item']
  const level3 = { seq: 1, gen: 0, level: 3, list, item } as const
  expect(pastHidden('taken-v', 'close', level3, null)).toBe('scroll-down')
  expect(pastHidden('taken-v', 'close', { ...level3, item: { ...item, pages: 2 } }, null)).toBe('next-below')
  // The last page has no button below its text.
  expect(pastHidden('taken-v', 'close', { ...level3, item: { ...item, page: 1, pages: 2 } }, null)).toBe('scroll-down')
  expect(pastHidden('taken-m', 'next-below', { ...level3, item: { ...item, pages: 2 } }, null)).toBe('close')
})
