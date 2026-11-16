import { expect, test } from 'claude-code/testing'

import { BAND, SUMMARY, SURFACES, TRANSCRIPT, usage, world } from './fixtures'

const START = { cwd: '/home/user/project', surface: 'terminal', isInteractive: true } as const

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

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
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
    expect((await ui.find({ type: 'Text', text: /66k\/200k 33%/ }))?.text).toBe(' 66k/200k 33%')
    await ui.unmount()
  }
})

test('the row fits its width', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(0)

  for (const surface of SURFACES) {
    for (const bodyColumns of [8, 10, 12, 16, 20, 24, 40, 80, 160]) {
      const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, bodyColumns } })
      const texts = await ui.findAll({ type: 'Text' })
      const width = texts.reduce((sum, text) => sum + text.text.length, 0)

      expect(width).toBeLessThan(bodyColumns)
      await ui.unmount()
    }
  }
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

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'seg-tool-results' })
    await ui.unmount()
  }

  expect(w.opened).toEqual(['context-breakdown', 'context-breakdown'])
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
  expect((await ui.find({ type: 'Text', text: /\/200k/ }))?.text).toBe(' 66k/200k 33%')
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
  expect((await ui.find({ type: 'Text', text: /\/200k/ }))?.text).toBe(' ~28k/200k 14%')
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
    await ui.unmount()
  }

  await w.clock.advance(0)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /\/200k/ }))?.text).toBe(' 27k/200k 13%')
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
    expect((await ui.find({ type: 'Text', text: /\/200k/ }))?.text).toBe(' ~28k/200k 14%')
    expect(await ui.find({ key: 'seg-compaction-summary' })).toBeDefined()
    await ui.unmount()
  }

  // The next response moves the figure: a fresh measurement replaces the estimate.
  w.usage = usage(26_600, 600)
  await $.session.measure({ context: w.usage.context, rateLimits: [], changed: ['context'] })
  await w.clock.advance(0)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /\/200k/ }))?.text).toBe(' 27k/200k 13%')
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
