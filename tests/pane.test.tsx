import { expect, test } from 'claude-code/testing'

import { PANE, SURFACES, world } from './fixtures'

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
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: /Measuring/ })).toBeDefined()
    expect((await ui.find({ key: 'close' }))?.props.hotkey).toBe('x')
    expect((await ui.find({ key: 'refresh' }))?.props.hotkey).toBe('r')
    await ui.unmount()
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
      'close',
      'refresh',
    ])
    expect((await ui.find({ key: 'row-tool-results' }))?.text).toMatch(/Tool results +30k +15%/)
    expect((await ui.find({ key: 'row-task-reports' }))?.text).toMatch(/Task reports +100 +<0\.1%/)
    expect(await ui.find({ type: 'Text', text: /Baseline +26k +13%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Conversation +40k +20%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Free space +101k +50%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Reserve +33k +16%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Not loaded (deferred)' })).toBeDefined()
    // The heading says "deferred"; the row does not repeat it, and its tokens
    // line up with the rows above.
    const deferred = await ui.find({ type: 'Text', text: /MCP tools +9k/ })
    const free = await ui.find({ type: 'Text', text: /Free space/ })
    expect(deferred?.text).not.toMatch(/\(deferred\)/)
    expect(deferred!.text.indexOf('9k') + 2).toBe(free!.text.indexOf('101k') + 4)
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
    expect((await ui.find({ key: 'row-system' }))?.text).toMatch(/System +20k$/)
    expect((await ui.find({ key: 'row-skills-agents' }))?.text).toMatch(/Skills\/agents +2k$/)
    // The full name still names the control.
    expect((await ui.find({ key: 'row-system' }))?.props.label).toBe('System prompt and built-in tools')
    expect(await ui.find({ type: 'Text', text: /Conversation +40k$/ })).toBeDefined()
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

    expect((await ui.find({ key: 'row-conversation' }))?.text).toMatch(/Conversation +40k/)
    expect(await ui.find({ key: 'row-tool-results' })).toBeUndefined()
    await ui.unmount()
  }
})
