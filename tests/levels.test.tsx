import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ITEMS_GONE_NOTE } from '../hooks/navigate'
import { cellWidth } from '../hooks/text'
import { flatten } from './e2e/helpers'
import { BAND, CHAT, FOCUSED_PANE, NOTES, OPENING, PANE, PROJECT_MD, PROJECT_TEXT, SUMMARY, SURFACES, TRANSCRIPT, isOff, manyResults, richUsage, world } from './fixtures'

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
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    expect((await ui.find({ key: 'row-system' }))?.props.hotkey).toBe('1')
    expect(await ui.find({ type: 'Text', text: '⏎ 1-9 0: Open' })).toBeDefined()

    await ui.press({ key: 'row-tool-results' })
    expect(await itemKeys(ui)).toEqual(['item-r:tu2', 'item-r:tu1'])
    expect((await ui.find({ key: 'item-r:tu2' }))?.props.hotkey).toBe('1')
    expect((await ui.find({ key: 'item-r:tu1' }))?.props.hotkey).toBe('2')
    // The terminal's row Button holds the whole row; a desktop's holds the name
    // alone (desktop.test.tsx draws the figures and detail beside it).
    expect((await ui.find({ key: 'item-r:tu1' }))?.text).toMatch(
      surface === 'terminal' ? /Read +~\/project\/notes\.txt/ : /^Read$/,
    )
    expect(await ui.find({ type: 'Text', text: /^2 items · largest first +% of segment$/ })).toBeDefined()
    expect((await ui.find({ key: 'back' }))?.props.hotkey).toBe('b')
    expect((await ui.find({ key: 'sort' }))?.props.hotkey).toBe('s')
    // Without the keyboard the terminal drops the hotkeys; a desktop keeps
    // them, drawn as key caps, and a hotkey presses only with the keyboard.
    await ui.redraw({ ...PANE.props })
    const kept = surface === 'terminal' ? [undefined, undefined, undefined] : ['1', '2', 'b']
    expect(await Promise.all(['item-r:tu2', 'item-r:tu1', 'back'].map(async key => (await ui.find({ key }))?.props.hotkey))).toEqual(kept)
    await ui.redraw({ ...FOCUSED_PANE.props })

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

test('a baseline segment lists its items; it has one order, so s leaves the line', async ($, on) => {
  await chatWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-mcp' })
    expect(await ui.find({ key: 'sort' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /largest first|newest first/ })).toBeUndefined()
    // Tool schemas have no text: rows, not buttons. The conversation holds no
    // reminder, so no row opens, and the titles stay at full strength: a dim
    // title would mark nothing.
    expect(await itemKeys(ui)).toEqual([])
    const title = (await ui.findAll({ type: 'Text' })).find(text => text.text === 'mcp__notes__search')
    expect(title).toBeDefined()
    expect(title?.props.dimColor).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /mcp__notes__search +notes/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /MCP server instructions/ })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('beside a row that opens, a row that does not open has a dim title', async ($, on) => {
  await chatWorld($, on, OPENING)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-mcp' })
    // The conversation holds the MCP reminder: its instructions open.
    const opens = await itemKeys(ui)
    expect(opens).toHaveLength(1)
    expect((await ui.find({ key: opens[0]! }))?.props.label).toBe('MCP server instructions')
    const title = (await ui.findAll({ type: 'Text' })).find(text => text.text === 'mcp__notes__search')
    expect(title?.props.dimColor).toBe(true)
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the sort toggle and the pages', async ($, on) => {
  await chatWorld($, on, manyResults(45))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    let keys = await itemKeys(ui)
    expect(keys).toHaveLength(20)
    expect(keys[0]).toBe('item-r:b1')
    expect(await ui.find({ type: 'Text', text: /^25 more items, .*, on other pages$/ })).toBeDefined()
    // p on the first page is still a control, so the key stays in the pane; it does nothing.
    expect(isOff(await ui.find({ key: 'prev' }), surface)).toBe(true)
    expect((await ui.find({ key: 'prev' }))?.props.hotkey).toBe('p')
    await ui.press({ key: 'prev' })
    expect((await itemKeys(ui))[0]).toBe('item-r:b1')
    expect(isOff(await ui.find({ key: 'next' }), surface)).toBe(false)

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
    expect(isOff(await ui.find({ key: 'next' }), surface)).toBe(true)
    await ui.press({ key: 'next' })
    expect(await itemKeys(ui)).toHaveLength(5)
    expect(await ui.find({ type: 'Text', text: /^40 more items/ })).toBeDefined()
    await ui.press({ key: 'prev' })
    expect((await itemKeys(ui))[0]).toBe('item-r:b25')

    await ui.press({ key: 'sort' })
    expect((await itemKeys(ui))[0]).toBe('item-r:b1')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a long item pages with n and p, and the facts line says which lines it shows', async ($, on) => {
  const long = Array.from({ length: 1230 }, (_, i) => `row ${i + 1}`).join('\n')
  await chatWorld($, on, [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'big', name: 'Bash', input: { command: 'seq' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'big', content: long }] },
  ])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:big' })
    expect(await ui.find({ type: 'Text', text: /· raw · as loaded · lines 1-500 of 1,230$/ })).toBeDefined()
    await ui.press({ key: 'next' })
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.startLine).toBe(501)
    expect(String(code?.props.source).split('\n')[0]).toBe('row 501')
    expect(await ui.find({ type: 'Text', text: /· lines 501-1,000 of 1,230$/ })).toBeDefined()
    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /· lines 1,001-1,230 of 1,230$/ })).toBeDefined()
    // The formatted view counts the same lines (its fence lines map onto them).
    await ui.press({ key: 'format' })
    expect(await ui.find({ type: 'Text', text: /· formatted · as loaded · lines [\d,]+-1,230 of 1,230$/ })).toBeDefined()
    await ui.press({ key: 'format' })
    while (!isOff(await ui.find({ key: 'prev' }), surface)) {
      await ui.press({ key: 'prev' })
    }
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
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
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
    // A Markdown instruction file opens formatted.
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe(PROJECT_TEXT)
    expect(await ui.find({ type: 'Text', text: /changed on disk/ })).toBeUndefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })

    await ui.press({ key: 'row-global-instructions' })
    const [global] = await itemKeys(ui)
    await ui.press({ key: global! })
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('Be brief.')
    expect(await ui.find({ type: 'Text', text: /shown from disk/ })).toBeDefined()
    // No as-loaded text to switch to: v leaves the line.
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

test('c copies the path and m mentions it; for an item without a path they do nothing', async ($, on) => {
  const w = await chatWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
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
    // No file: v, c and m leave the line. The terminal still takes their
    // keys with nothing drawn, and a press of one does nothing.
    for (const [key, letter] of [['copy', 'c'], ['mention', 'm'], ['view', 'v']] as const) {
      expect(await ui.find({ key })).toBeUndefined()
      const hidden = await ui.find({ key: `taken-${letter}` })
      expect(hidden?.props.hotkey).toBe(surface === 'terminal' ? letter : undefined)
      if (hidden !== undefined) {
        await ui.press({ key: `taken-${letter}` })
      }
    }
    // No copy, no mention: no answer line.
    expect(await ui.find({ type: 'Text', text: /the path|Copied/ })).toBeUndefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
  expect(w.copied).toEqual([NOTES, NOTES])
  expect(w.filled).toEqual([`@${NOTES} `, `@${NOTES} `])
})

test('/ctx tool opens the tool results with focus; an unknown word opens level 1 with a note', async ($, on) => {
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

  await run('nothing-like-this')
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'row-system' })).toBeDefined()
  const note = (await ui.find({ type: 'Text', text: 'No segment matches "nothing-like-this".' }))!
  expect(note.props.dimColor).toBe(true)
  // The next move clears it.
  await ui.press({ key: 'row-system' })
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: /No segment matches/ })).toBeUndefined()
  await ui.unmount()

  // A word that matches also clears a note; an ambiguous start keeps its rule (the earlier segment).
  await run('skill')
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Skills list/ })).toBeDefined()
  await ui.unmount()
})

test('/ctx alone keeps what an open pane shows and gives it the keyboard; on a closed pane it opens level 1', async ($, on) => {
  const w = await chatWorld($, on)
  const run = (args: string) =>
    $.command.run({ command: 'ctx', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

  await run('tool')
  let ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  await ui.press({ key: 'item-r:tu1' })
  expect(await ui.find({ type: 'Code' })).toBeDefined()
  await ui.unmount()

  const ringed = async () =>
    (await ui.findAll({ type: 'Button' })).filter(button => button.props.autoFocus === true).map(button => button.key)

  // The pane lost the keyboard; /ctx gives it back on the same item. No
  // control takes the ring then: the engine would bring it into view and
  // move the window off the place the person left it.
  await run('')
  expect(w.focused).toEqual([true, true])
  ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Tool results › Read/ })).toBeDefined()
  expect(await ringed()).toEqual([])
  // The next move gives the ring back.
  await ui.press({ key: 'back' })
  expect(await ringed()).toEqual(['item-r:tu1'])
  await ui.press({ key: 'close' })
  await ui.unmount()

  // Closed by hand (no x, so the view stays at the items): /ctx opens the segments, as before.
  await run('tool')
  w.open.delete('context-breakdown')
  await run('')
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'row-system' })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  expect(await ringed()).toEqual(['row-system'])
  await ui.unmount()
})

test('a bar segment opens its items; a merged cell opens level 1', async ($, on) => {
  await chatWorld($, on)

  // Wide enough that the legend leaves the bar room for Claude output's cell.
  const wide = { ...BAND, props: { ...BAND.props, bodyColumns: 100 } }
  // On the desktop the bar is one picture; its total opens level 1 (band.test.tsx).
  for (const surface of ['terminal'] as const) {
    const band = await $.ui.mount({ ...wide, surface })
    await band.press({ key: 'seg-claude-output' })
    await band.unmount()
    let ui = await $.ui.mount({ ...PANE, surface })
    expect((await itemKeys(ui)).length).toBe(3)
    await ui.unmount()

    const merged = await $.ui.mount({ ...wide, surface })
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

test('after a compaction removes every item of an open list, level 1 says so', async ($, on) => {
  const w = await chatWorld($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'row-tool-results' })
  expect(await itemKeys(ui)).toHaveLength(2)

  w.messages = SUMMARY
  await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT })
  await w.clock.advance(0)
  expect(await itemKeys(ui)).toEqual([])
  expect(await ui.find({ type: 'Text', text: 'No items.' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: ITEMS_GONE_NOTE })).toBeDefined()
  expect(await ui.find({ key: 'row-system' })).toBeDefined()
  // The next move clears the line.
  await ui.press({ key: 'row-system' })
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: ITEMS_GONE_NOTE })).toBeUndefined()
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
    // The open list left with the conversation: the pane says so.
    expect(await ui.find({ type: 'Text', text: ITEMS_GONE_NOTE })).toBeDefined()
    await ui.press({ key: 'row-system' })
    await ui.press({ key: 'back' })
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

/** The keyed and typed parts of a drawn tree, in the order they are drawn. */
function drawnOrder(node: unknown, out: string[] = []): string[] {
  if (node === null || typeof node !== 'object') {
    return out
  }
  const { type, props = {}, children = [] } = node as { type?: string; props?: { key?: string }; children?: unknown[] }
  const { key } = props
  const text = children.filter(child => typeof child === 'string').join('')
  if (type === 'Code' || type === 'Markdown') {
    out.push(type)
  } else if (type === 'Button' && key !== undefined) {
    out.push(key)
  } else if (type === 'Text' && /tokens ·|For keys|Click the pane/.test(text)) {
    out.push(/tokens ·/.test(text) ? 'facts' : 'hint')
  }
  for (const child of children) {
    drawnOrder(child, out)
  }

  return out
}

const BIG_RESULT = Array.from({ length: 1230 }, (_, i) => `row ${i + 1}`).join('\n')
const BIG = [
  { role: 'assistant', content: [{ type: 'tool_use', id: 'big', name: 'Bash', input: { command: 'seq' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'big', content: BIG_RESULT }] },
]

test('level 3: the controls stand between the facts line and the text, and the first one takes the ring', async ($, on) => {
  await chatWorld($, on, BIG)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:big' })
    const order = drawnOrder(await ui.drawn())
    // The first control: Down on the terminal; elsewhere Back, as level 3
    // there draws no Down and Up (the app scrolls the text).
    const first = surface === 'terminal' ? 'scroll-down' : 'back'
    expect(order.indexOf('facts')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('facts')).toBeLessThan(order.indexOf(first))
    expect(order.indexOf('refresh')).toBeLessThan(order.indexOf('Code'))
    // A page with a next one ends with a control to it, under the text.
    expect(order.at(-1)).toBe('next-below')
    const ringed = (await ui.findAll({ type: 'Button' })).filter(button => button.props.autoFocus === true)
    expect(ringed.map(button => button.key)).toEqual([first])
    await ui.press({ key: 'next-below' })
    expect(await ui.find({ type: 'Text', text: /lines 501-1,000 of 1,230$/ })).toBeDefined()

    // Without the keyboard the hint stands above the text too, and Back takes the ring.
    await ui.redraw({ ...PANE.props })
    const unfocused = drawnOrder(await ui.drawn())
    expect(unfocused.indexOf('hint')).toBeLessThan(unfocused.indexOf('Code'))
    expect((await ui.find({ key: 'back' }))?.props.autoFocus).toBe(true)
    await ui.redraw({ ...FOCUSED_PANE.props })
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

type Part = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** The parts of one group, as the engine draws them: the words, and each plain control as `hotkey: label`. */
function groupParts(group: Part): string[] {
  return (group.children ?? []).flatMap(child => {
    const part = child as Part
    if (part.type === 'Text') {
      return [(part.children ?? []).filter(text => typeof text === 'string').join('')]
    }
    if (part.type === 'Button') {
      const label = String(part.props?.label ?? '')

      return [part.props?.hotkey === undefined ? label : `${String(part.props.hotkey)}: ${label}`]
    }

    return []
  })
}

/**
 * The groups of the drawn key line: the wrapping row whose children are all
 * wrapping rows of words and controls (a group can hold words only).
 */
function keyGroupsOf(node: unknown): string[][] | null {
  if (node === null || typeof node !== 'object') {
    return null
  }
  const { type, props = {}, children = [] } = node as Part & { props?: Record<string, unknown>; children?: unknown[] }
  const isGroup = (child: unknown) => {
    const part = child as Part
    const inner = part?.children ?? []

    return (
      part?.type === 'Box' &&
      part.props?.flexWrap === 'wrap' &&
      inner.length > 0 &&
      inner.every(one => (one as Part)?.type === 'Button' || (one as Part)?.type === 'Text')
    )
  }
  if (type === 'Box' && props.flexWrap === 'wrap' && children.length > 0 && children.every(isGroup)) {
    return children.map(child => groupParts(child as Part))
  }
  for (const child of children) {
    const found = keyGroupsOf(child)
    if (found !== null) {
      return found
    }
  }

  return null
}

/**
 * The drawn key line laid out in rows of `columns` cells, by its rule: a gap
 * of 2 between parts; a row breaks only between groups; a group wider than
 * the row wraps inside itself, between its parts.
 */
function keyRows(node: unknown, columns: number): string[][] {
  const rows: string[][] = []
  let shared = false
  for (const group of keyGroupsOf(node) ?? []) {
    const row = rows.at(-1)
    if (row !== undefined && shared && cellWidth([...row, ...group].join('  ')) <= columns) {
      row.push(...group)
      continue
    }
    // A new row for the group; it wraps inside itself when it is wider.
    const own: string[][] = []
    for (const part of group) {
      const last = own.at(-1)
      if (last !== undefined && cellWidth([...last, part].join('  ')) <= columns) {
        last.push(part)
      } else {
        own.push([part])
      }
    }
    rows.push(...own)
    // Only a group that took one row leaves room beside it for the next.
    shared = own.length === 1
  }

  return rows
}

test('the keys stand in fixed groups, in one order; a control that cannot apply here leaves the line', async ($, on) => {
  await chatWorld($, on)
  type Buttons = { findAll: (q: { type: string }) => Promise<{ key: string | undefined; props: Record<string, unknown> }[]> }
  const controls = async (ui: Buttons) =>
    (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => !/^(row|item)-/.test(key) && key !== 'next-below')
  // The controls drawn in the line, and the keys the pane takes with nothing drawn.
  const keyLine = async (ui: Buttons) => (await controls(ui)).filter(key => !key.startsWith('taken-'))
  const taken = async (ui: Buttons) =>
    (await ui.findAll({ type: 'Button' })).filter(button => (button.key ?? '').startsWith('taken-')).map(button => button.props.hotkey)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, bodyColumns: 45 } })
    // Only the terminal draws Down and Up (j and k): elsewhere Tab moves the
    // ring along the rows and the app scrolls the text.
    const steps = (down: string, up: string) => (surface === 'terminal' ? [down, up] : [])
    // Only the terminal was seen to keep the key of a hidden Button.
    const keeps = (...keys: string[]) => (surface === 'terminal' ? keys : [])
    // Level 1: move [open words, j, k], pane [r, x]. No Back: there is no
    // level to go back to. The terminal takes b all the same, drawing nothing.
    expect(await keyLine(ui)).toEqual([...steps('list-down', 'list-up'), 'refresh', 'close'])
    expect(await taken(ui)).toEqual(keeps('b'))
    // The words name Enter and the digits; the arrows and Tab go unnamed.
    const words = (await ui.findAll({ type: 'Text', text: /: Open$/ })).map(text => text.text)
    expect(words).toEqual(['⏎ 1-9 0: Open'])
    expect(await ui.find({ type: 'Text', text: /Move/ })).toBeUndefined()
    const groups1 = keyGroupsOf(await ui.drawn())!
    expect(groups1).toEqual([
      ['⏎ 1-9 0: Open', ...steps('j: ↓', 'k: ↑')],
      ['r: Refresh', 'x: Close'],
    ])
    // Every row of the line, as its rule lays it, fits the pane's 45 columns.
    expect(keyRows(await ui.drawn(), 45).every(row => cellWidth(row.join('  ')) <= 45)).toBe(true)
    if (surface === 'terminal') {
      expect((await ui.find({ key: 'list-down' }))?.props).toMatchObject({ hotkey: 'j', label: '↓' })
      expect((await ui.find({ key: 'list-up' }))?.props).toMatchObject({ hotkey: 'k', label: '↑' })
      // A press of the taken b does nothing: level 1 stays.
      await ui.press({ key: 'taken-b' })
      expect(await ui.find({ key: 'row-system' })).toBeDefined()
    }

    // Level 2 of one page: move [open words, j, k, b], pane [s, r, x]. p and n leave together.
    await ui.press({ key: 'row-tool-results' })
    expect(await keyLine(ui)).toEqual([...steps('list-down', 'list-up'), 'back', 'sort', 'refresh', 'close'])
    expect(await taken(ui)).toEqual(keeps('p', 'n'))
    expect(keyGroupsOf(await ui.drawn())!.at(-1)).toEqual(['s: Newest first', 'r: Refresh', 'x: Close'])

    // Level 3 of a Bash result: no file, so v, c and m leave the line; p and n stay, fainter.
    await ui.press({ key: 'item-r:tu2' })
    expect(await keyLine(ui)).toEqual([...steps('scroll-down', 'scroll-up'), 'back', 'prev', 'next', 'format', 'refresh', 'close'])
    expect(await taken(ui)).toEqual(keeps('v', 'c', 'm'))
    expect(keyGroupsOf(await ui.drawn())).toEqual([
      [...steps('j: ↓', 'k: ↑'), 'b: Back', 'p: Prev page', 'n: Next page'],
      ['f: Formatted'],
      ['r: Refresh', 'x: Close'],
    ])
    const rows3 = keyRows(await ui.drawn(), 45)
    expect(rows3.every(row => cellWidth(row.join('  ')) <= 45)).toBe(true)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the key line breaks only between groups; a group wider than the pane wraps inside itself', async ($, on) => {
  await chatWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal', props: { ...FOCUSED_PANE.props, bodyColumns: 40 } })
  const tail = async (n: number) => flatten(await ui.drawn(), { columns: 40 }).slice(-n)
  // "r: Refresh" would fit beside k at 40 columns, but it is of the next group.
  expect(await tail(2)).toEqual(['⏎ 1-9 0: Open  j: ↓  k: ↑', 'r: Refresh  x: Close'])
  // Level 3: the move group is wider than 40 columns and wraps inside
  // itself; the next groups start a row of their own, and share it where
  // they fit there whole.
  await ui.press({ key: 'row-tool-results' })
  await ui.press({ key: 'item-r:tu2' })
  const lines = flatten(await ui.drawn(), { columns: 40 })
  const at = lines.findIndex(line => line.startsWith('j: ↓'))
  expect(lines.slice(at, at + 3)).toEqual(['j: ↓  k: ↑  b: Back  p: Prev page', 'n: Next page', 'f: Formatted  r: Refresh  x: Close'])
  await ui.press({ key: 'back' })
  await ui.press({ key: 'back' })
  await ui.unmount()
})


test('the raw view hides no character of a long line: it is split, numbers kept, and the facts line says so', async ($, on) => {
  const text = ['first', 'x'.repeat(2500), 'third'].join('\n')
  await chatWorld($, on, [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'wide', name: 'Bash', input: { command: 'cat' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'wide', content: text }] },
  ])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:wide' })
    const codes = await ui.findAll({ type: 'Code' })
    expect(codes.map(code => [String(code.props.source).length, code.props.startLine])).toEqual([
      [5, 1],
      [1000, 2],
      [1000, 2],
      [500, 2],
      [5, 3],
    ])
    expect(await ui.find({ type: 'Text', text: /· raw · as loaded · long lines split$/ })).toBeDefined()
    // The formatted view is drawn by Markdown, whole: no note there.
    await ui.press({ key: 'format' })
    expect(await ui.find({ type: 'Text', text: /long lines split/ })).toBeUndefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})
