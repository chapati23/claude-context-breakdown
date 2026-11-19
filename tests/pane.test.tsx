import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { ContextBreakdownList, ContextBreakdownSnapshot } from '../types'
import { CLICK_HINT, KEYS_HINT, keyWords, keysHint, ringKey } from '../hooks/pane'
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
      'back',
      'close',
      'refresh',
    ])
    // Shares are of what is used (66k), not of the window.
    if (surface === 'terminal') {
      // A desktop's row Button holds the name alone: see desktop.test.tsx.
      expect((await ui.find({ key: 'row-tool-results' }))?.text).toMatch(/Tool results +█+ +30k +45%$/)
      expect((await ui.find({ key: 'row-task-reports' }))?.text).toMatch(/Task reports +▏ +100 +0\.2%$/)
    }
    expect(await ui.find({ type: 'Text', text: /Baseline +26k +39%$/ })).toBeDefined()
    // 26k and 40k of 66k: 39.4% and 60.6%, rounded to the nearest they add up.
    expect(await ui.find({ type: 'Text', text: /Conversation +40k +61%$/ })).toBeDefined()
    // Free space and Reserve have no share of what is used.
    expect(await ui.find({ type: 'Text', text: /Free space +·· +101k$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Reserve +▒▒ +33k$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ *Not loaded$/ })).toBeDefined()
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
    expect(await ui.find({ type: 'Text', text: /^ +Baseline +48k +17%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ +Conversation +235k +83%$/ })).toBeDefined()

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
      const heading = (await ui.find({ type: 'Text', text: /Not loaded$/ }))!.text
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

test('Not loaded lists the MCP servers under MCP tools, aligned, cut to the table, and none takes focus', async ($, on) => {
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
    await ui.unmount()
  }
  w.usage = withServers(TEN_SERVERS)
  const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await first.press({ key: 'refresh' })
  await w.clock.advance(0)
  await first.unmount()

  // A desktop's rows are a Button with the name beside Texts of figures: see desktop.test.tsx.
  for (const surface of ['terminal'] as const) {
    for (const bodyColumns of [45, 68, 100]) {
      const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns } })
      const segment = (await ui.find({ key: 'row-tool-results' }))!.text
      const nameAt = segment.indexOf('Tool results')
      const tokensEnd = segment.indexOf('30k') + 3
      // Rows only: the figures' own nested Texts hold no word.
      const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text).filter(text => /[A-Za-z]{2}/.test(text))
      const mcpAt = texts.findIndex(text => /^ *MCP tools +9k$/.test(text))
      expect(mcpAt).toBeGreaterThan(-1)
      // Eight servers, then one row for the other two; each under MCP tools.
      const serverRows = texts.slice(mcpAt + 1, mcpAt + 10)
      expect(serverRows[0]).toMatch(/^ +tickets +40 tools +40k$/)
      expect(serverRows[2]).toMatch(/^ +red team +20 tools +20k$/)
      expect(serverRows[8]).toMatch(/^ +2 more servers +3 tools +3k$/)
      expect(texts[mcpAt + 10]).toMatch(/^Per MCP server: the tools not loaded yet, and the tokens/)
      for (const row of serverRows) {
        // Indented under the category's name, the tokens in every row's column, no wrap.
        expect(row.indexOf(row.trim())).toBe(nameAt + 2)
        expect(row.length).toBe(tokensEnd)
        expect(cellWidth(row)).toBeLessThan(bodyColumns)
      }
      expect(serverRows[1]).toMatch(/a-server-name.*… +30 tools +30k$/)
      expect(texts.join('\n')).not.toMatch(/\x1b|\t|\x9b|​|‮|1m/)
      expect(texts.some(text => text.includes('loaded-only'))).toBe(false)
      // The rows above keep their place: the table is as it was without servers.
      if (surface === 'terminal') {
        for (const key of ROWS) {
          expect((await ui.find({ key }))!.text).toBe(before[`${bodyColumns} ${key}`]!)
        }
      }
      // Not Buttons: the rows stay out of the ring's way.
      const buttons = (await ui.findAll({ type: 'Button' })).map(button => button.text)
      expect(buttons.some(text => /tickets|more servers/.test(text))).toBe(false)
      await ui.unmount()
    }
  }
})

test('with no token figure for the servers, Not loaded shows their tool counts and an empty token cell', async ($, on) => {
  const w = world(on)
  const zero = withServers([
    ['tickets', 4, 0],
    ['notes', 2, 0],
  ])
  const categories = zero.context.breakdown.categories.map(category =>
    category.kind === 'deferred' ? { ...category, tokens: 0 } : category,
  )
  w.usage = { ...zero, context: { ...zero.context, breakdown: { ...zero.context.breakdown, categories } } }
  await $.session.start(START)
  await w.clock.advance(0)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 68 } })
  // Rows only: the figures' own nested Texts hold no word.
  const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text).filter(text => /[A-Za-z]{2}/.test(text))
  const mcpAt = texts.findIndex(text => /^ *MCP tools *$/.test(text))
  expect(mcpAt).toBeGreaterThan(-1)
  expect(texts[mcpAt + 1]).toMatch(/^ +tickets +4 tools$/)
  expect(texts[mcpAt + 2]).toMatch(/^ +notes +2 tools$/)
  expect(texts[mcpAt + 3]).toBe('Per MCP server: the tools not loaded yet. Claude Code gives no token figure for them.')
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
    expect((await ui.find({ type: 'Text', text: /tab: Move|1-9/ })) === undefined).toBe(surface === 'terminal')
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
    // Off the terminal the arrows scroll the pane: Tab alone moves the ring.
    expect(await ui.find({ type: 'Text', text: surface === 'terminal' ? '↑↓ tab: Move' : 'tab: Move' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '⏎ or 1-9: Open' })).toBeDefined()
    expect((await ui.find({ key: 'row-system' }))?.props.hotkey).toBe('1')
    expect((await ui.find({ key: 'row-system' }))?.text.startsWith('1: ')).toBe(false)
    // Both surfaces leave the digit to the Button.
    expect(await ui.findAll({ type: 'Text', text: '1: ' })).toEqual([])
    expect((await ui.find({ key: 'close' }))?.props.hotkey).toBe('x')
    await ui.unmount()
  }
})

test('the key words for each state', () => {
  // Without the keyboard the hint stands on its own line, apart from the controls.
  expect(keyWords(true, 88, false)).toEqual([])
  expect(keyWords(false, 88, false)).toEqual([])
  expect(keysHint('terminal')).toBe('For keys: click the pane, or run /ctx')
  expect(keysHint('desktop')).toBe('Click the pane for keys')
  // The arrows and Tab move the ring along the rows; j and k are controls of their own.
  expect(keyWords(true, 88, true)).toEqual(['↑↓ tab: Move', '⏎ or 1-9: Open'])
  expect(keyWords(true, 24, true)).toEqual(['↑↓ tab: Move', '⏎: Open'])
  expect(keyWords(false, 88, true)).toEqual([])
  // Off the terminal the mod leaves the arrows to the app: Tab alone moves the ring.
  expect(keyWords(true, 88, true, 'desktop')).toEqual(['tab: Move', '⏎ or 1-9: Open'])
  expect(keyWords(true, 88, true, 'terminal')).toEqual(['↑↓ tab: Move', '⏎ or 1-9: Open'])
})

test('rows after the ninth: Tab reaches them from the first row, which takes the ring', async ($, on) => {
  await realWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns: 88 } })
    const rows = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('row-'))
    expect(rows.map(row => row.props.hotkey ?? null)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', null])
    expect(rows.filter(row => row.props.autoFocus === true).map(row => row.key)).toEqual(['row-system'])
    // The tenth row is a Button: Tab walks onto it and Enter presses it.
    await ui.press({ key: 'row-claude-output' })
    expect(await ui.find({ type: 'Text', text: /Claude output/ })).toBeDefined()
    await ui.press({ key: 'back' })

    await ui.press({ key: 'row-tool-results' })
    const items = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('item-'))
    // The page keeps its twenty rows: all twelve items on one page.
    expect(items).toHaveLength(12)
    expect(items.slice(9).map(item => item.props.hotkey)).toEqual([undefined, undefined, undefined])
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
    expect(await ui.find({ type: 'Text', text: /^ +% of segment$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '12 items · largest first' })).toBeDefined()
    expect((await ui.find({ key: 'sort' }))?.props.label).toBe('Sort by time')
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
    expect((await ui.find({ type: 'Text', text: /^ +% of segment$/ }))?.props.mono).toBe(true)
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
  expect(ringKey(level1, null, false)).toBe('back')

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
})
