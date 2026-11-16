import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BAND, CHAT, NOTES, PANE, PROJECT_MD, PROJECT_TEXT, SUMMARY, SURFACES, TRANSCRIPT, manyResults, richUsage, world } from './fixtures'

const START = { cwd: '/home/user/project', surface: 'terminal', isInteractive: true } as const
const GLOBAL_MD = '/home/user/.claude/CLAUDE.md'

type Mounted = { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }

/** The keys of the item rows a level-2 drawing shows, in order. */
async function itemKeys(ui: Mounted): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' }))
    .map(button => button.key ?? '')
    .filter(key => key.startsWith('item-'))
}

/** A measured session over the invented chat, with the files on "disk". */
async function chatWorld($: Engine, on: On, messages: readonly unknown[] = CHAT) {
  const w = world(on)
  w.usage = richUsage()
  w.messages = messages
  w.files = { [NOTES]: 'alpha\nbeta\n', [PROJECT_MD]: `${PROJECT_TEXT}\n`, [GLOBAL_MD]: 'Be brief.\n' }
  await $.session.start(START)
  await w.clock.advance(0)

  return w
}

test('level 1 to 2 to 3 and back, with hotkeys on the rows', async ($, on) => {
  await chatWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'row-system' }))?.props.hotkey).toBe('1')
    expect(await ui.find({ type: 'Text', text: '1-9 open' })).toBeDefined()

    await ui.press({ key: 'row-tool-results' })
    expect(await itemKeys(ui)).toEqual(['item-r:tu2', 'item-r:tu1'])
    expect((await ui.find({ key: 'item-r:tu2' }))?.props.hotkey).toBe('1')
    expect((await ui.find({ key: 'item-r:tu1' }))?.props.hotkey).toBe('2')
    expect((await ui.find({ key: 'item-r:tu1' }))?.text).toMatch(/Read +~\/project\/notes\.txt/)
    expect(await ui.find({ type: 'Text', text: /^2 items · .* · largest first$/ })).toBeDefined()
    expect((await ui.find({ key: 'back' }))?.props.hotkey).toBe('b')
    expect((await ui.find({ key: 'sort' }))?.props.hotkey).toBe('s')

    await ui.press({ key: 'item-r:tu1' })
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.source).toBe('     1\talpha\n     2\tbeta')
    // The Read result numbers its own lines: no second gutter.
    expect(code?.props.startLine).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /· as loaded$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /changed on disk/ })).toBeUndefined()

    await ui.press({ key: 'back' })
    expect(await itemKeys(ui)).toEqual(['item-r:tu2', 'item-r:tu1'])
    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'row-system' })).toBeDefined()
    expect(await itemKeys(ui)).toEqual([])
    await ui.unmount()
  }
})

test('a baseline segment lists its items with no sort key', async ($, on) => {
  await chatWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-mcp' })
    expect(await ui.find({ key: 'sort' })).toBeUndefined()
    // Tool schemas have no text: rows, not buttons.
    expect(await itemKeys(ui)).toEqual([])
    expect(await ui.find({ type: 'Text', text: /mcp__notes__search +notes/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /MCP server instructions/ })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the sort toggle and the pages', async ($, on) => {
  await chatWorld($, on, manyResults(45))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    let keys = await itemKeys(ui)
    expect(keys).toHaveLength(20)
    expect(keys[0]).toBe('item-r:b1')
    expect(await ui.find({ type: 'Text', text: /^25 more items, .*, on other pages$/ })).toBeDefined()
    expect(await ui.find({ key: 'prev' })).toBeUndefined()

    await ui.press({ key: 'sort' })
    expect((await itemKeys(ui))[0]).toBe('item-r:b45')
    expect(await ui.find({ type: 'Text', text: /newest first · page 1 of 3$/ })).toBeDefined()
    expect((await ui.find({ key: 'sort' }))?.props.label).toBe('Largest first')

    await ui.press({ key: 'next' })
    expect((await itemKeys(ui))[0]).toBe('item-r:b25')
    expect((await ui.find({ key: 'prev' }))?.props.hotkey).toBe('p')
    await ui.press({ key: 'next' })
    keys = await itemKeys(ui)
    expect(keys).toHaveLength(5)
    expect(await ui.find({ key: 'next' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^40 more items/ })).toBeDefined()
    await ui.press({ key: 'prev' })
    expect((await itemKeys(ui))[0]).toBe('item-r:b25')

    await ui.press({ key: 'sort' })
    expect((await itemKeys(ui))[0]).toBe('item-r:b1')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a long item pages with n and p', async ($, on) => {
  const long = Array.from({ length: 120 }, (_, i) => `row ${i + 1}`).join('\n')
  await chatWorld($, on, [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'big', name: 'Bash', input: { command: 'seq' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'big', content: long }] },
  ])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:big' })
    expect(await ui.find({ type: 'Text', text: /as loaded · page 1 of 3$/ })).toBeDefined()
    await ui.press({ key: 'next' })
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.startLine).toBe(51)
    expect(String(code?.props.source).split('\n')[0]).toBe('row 51')
    await ui.press({ key: 'prev' })
    expect((await ui.find({ type: 'Code' }))?.props.startLine).toBe(1)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('v switches a Read result between as loaded and on disk, and marks a change', async ($, on) => {
  const w = await chatWorld($, on)

  for (const surface of SURFACES) {
    w.files[NOTES] = 'alpha\nBETA\n'
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:tu1' })
    expect(await ui.find({ type: 'Text', text: /changed on disk since it was loaded/ })).toBeDefined()
    expect((await ui.find({ key: 'view' }))?.props.hotkey).toBe('v')

    await ui.press({ key: 'view' })
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.source).toBe('alpha\nBETA')
    expect(code?.props.startLine).toBe(1)
    expect(await ui.find({ type: 'Text', text: /· on disk$/ })).toBeDefined()

    await ui.press({ key: 'view' })
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe('     1\talpha\n     2\tbeta')
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
  // Only the opened item's file was read.
  expect(new Set(w.reads)).toEqual(new Set([NOTES]))
})

test('an instruction file shows its as-loaded text, and the file when the reminder lacks it', async ($, on) => {
  const w = await chatWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-project-instructions' })
    const [project] = await itemKeys(ui)
    await ui.press({ key: project! })
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe(PROJECT_TEXT)
    expect(await ui.find({ type: 'Text', text: /changed on disk/ })).toBeUndefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })

    await ui.press({ key: 'row-global-instructions' })
    const [global] = await itemKeys(ui)
    await ui.press({ key: global! })
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe('Be brief.')
    expect(await ui.find({ type: 'Text', text: /shown from disk/ })).toBeDefined()
    expect(await ui.find({ key: 'view' })).toBeUndefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
  w.files[PROJECT_MD] = 'Use spaces.\n'
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'row-project-instructions' })
  await ui.press({ key: (await itemKeys(ui))[0]! })
  expect(await ui.find({ type: 'Text', text: /changed on disk/ })).toBeDefined()
  await ui.unmount()
})

test('c copies the path and m mentions it; an item without a path has neither', async ($, on) => {
  const w = await chatWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:tu1' })
    expect((await ui.find({ key: 'copy' }))?.props.hotkey).toBe('c')
    expect((await ui.find({ key: 'mention' }))?.props.hotkey).toBe('m')
    await ui.press({ key: 'copy' })
    expect(await ui.find({ type: 'Text', text: 'Copied the path.' })).toBeDefined()
    await ui.press({ key: 'mention' })
    expect(await ui.find({ type: 'Text', text: 'Put the path in the prompt.' })).toBeDefined()
    await ui.press({ key: 'back' })

    await ui.press({ key: 'item-r:tu2' })
    expect(await ui.find({ key: 'copy' })).toBeUndefined()
    expect(await ui.find({ key: 'mention' })).toBeUndefined()
    expect(await ui.find({ key: 'view' })).toBeUndefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
  expect(w.copied).toEqual([NOTES, NOTES])
  expect(w.filled).toEqual([`@${NOTES} `, `@${NOTES} `])
})

test('/ctx tool opens the tool results with focus; /ctx and an unknown word open level 1', async ($, on) => {
  const w = await chatWorld($, on)
  const run = (args: string) =>
    $.command.run({ command: 'ctx', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

  await run('tool')
  expect(w.focused).toEqual([true])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await itemKeys(ui)).toEqual(['item-r:tu2', 'item-r:tu1'])
    await ui.unmount()
  }

  for (const args of ['', 'nothing-like-this']) {
    await run(args)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ key: 'row-system' })).toBeDefined()
    await ui.unmount()
  }
})

test('a bar segment opens its items; a merged cell opens level 1', async ($, on) => {
  await chatWorld($, on)

  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    await band.press({ key: 'seg-claude-output' })
    await band.unmount()
    let ui = await $.ui.mount({ ...PANE, surface })
    expect((await itemKeys(ui)).length).toBe(3)
    await ui.unmount()

    const merged = await $.ui.mount({ ...BAND, surface })
    const cell = (await merged.findAll({ type: 'Button' })).find(button => /and \d+ more/.test(String(button.props.label)))
    await merged.press({ key: cell!.key! })
    await merged.unmount()
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'row-system' })).toBeDefined()
    await ui.unmount()
  }
})

test('after a compaction an open item that is gone falls back to level 1', async ($, on) => {
  const w = await chatWorld($, on)

  for (const surface of SURFACES) {
    w.messages = CHAT
    await $.session.measure({ context: w.usage.context, rateLimits: [], changed: ['context'] })
    await w.clock.advance(0)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:tu1' })
    expect(await ui.find({ type: 'Code' })).toBeDefined()

    w.messages = SUMMARY
    await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT })
    await w.clock.advance(0)
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect(await ui.find({ key: 'row-system' })).toBeDefined()
    await ui.unmount()
  }
})

test('after a compaction an open list is rebuilt without the items that are gone', async ($, on) => {
  const w = await chatWorld($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'row-tool-results' })
  expect(await itemKeys(ui)).toHaveLength(2)

  w.messages = SUMMARY
  await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT })
  await w.clock.advance(0)
  expect(await itemKeys(ui)).toEqual([])
  expect(await ui.find({ type: 'Text', text: 'No items.' })).toBeDefined()
  await ui.unmount()
})

test('a /clear and x both go back to level 1', async ($, on) => {
  const w = await chatWorld($, on)

  for (const surface of SURFACES) {
    let ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-prompts' })
    await ui.press({ key: 'close' })
    await ui.unmount()
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'row-system' })).toBeDefined()

    await ui.press({ key: 'row-prompts' })
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    await w.clock.advance(0)
    expect(await itemKeys(ui)).toEqual([])
    expect(await ui.find({ key: 'row-system' })).toBeDefined()
    await ui.unmount()
  }
})

test('r rebuilds an open list, and at level 3 compares the file again', async ($, on) => {
  const w = await chatWorld($, on)
  const more = [
    ...CHAT,
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tu3', name: 'Bash', input: { command: 'date' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu3', content: 'today' }] },
  ]

  for (const surface of SURFACES) {
    w.messages = CHAT
    w.files[NOTES] = 'alpha\nbeta\n'
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    w.messages = more
    await ui.press({ key: 'refresh' })
    await w.clock.advance(0)
    expect(await itemKeys(ui)).toContain('item-r:tu3')

    await ui.press({ key: 'item-r:tu1' })
    expect(await ui.find({ type: 'Text', text: /Tool results › Read/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /changed on disk/ })).toBeUndefined()
    w.files[NOTES] = 'alpha\nBETA\n'
    await ui.press({ key: 'refresh' })
    await w.clock.advance(0)
    expect(await ui.find({ type: 'Code' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /changed on disk since it was loaded/ })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('an open item that left the context drops to level 1 with a line that says so', async ($, on) => {
  const w = await chatWorld($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'row-tool-results' })
  await ui.press({ key: 'item-r:tu1' })
  w.messages = SUMMARY
  await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT })
  await w.clock.advance(0)
  expect(await ui.find({ type: 'Text', text: /no longer in the context/ })).toBeDefined()
  // The next move clears the line.
  await ui.press({ key: 'row-system' })
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: /no longer in the context/ })).toBeUndefined()
  await ui.unmount()
})
