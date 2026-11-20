import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { LABEL_PAD_CELLS } from '../hooks/grid'
import { ITEMS_GONE_NOTE } from '../hooks/navigate'
import { cellWidth } from '../hooks/text'
import { flatten } from './e2e/helpers'
import { gridLines } from './grid'
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
    // Off the terminal a row has no hotkey: a click or Enter opens it.
    const digit = (key: string) => (surface === 'terminal' ? key : undefined)
    expect((await ui.find({ key: 'row-system' }))?.props.hotkey).toBe(digit('1'))
    expect(await ui.find({ type: 'Text', text: surface === 'terminal' ? '⏎ 1-9 0: Open' : '⏎: Open' })).toBeDefined()

    await ui.press({ key: 'row-tool-results' })
    expect(await itemKeys(ui)).toEqual(['item-r:tu2', 'item-r:tu1'])
    expect((await ui.find({ key: 'item-r:tu2' }))?.props.hotkey).toBe(digit('1'))
    expect((await ui.find({ key: 'item-r:tu1' }))?.props.hotkey).toBe(digit('2'))
    // The terminal's row Button holds the whole row; a desktop's holds the name
    // alone (grid.test.tsx draws the figures and detail beside it).
    expect((await ui.find({ key: 'item-r:tu1' }))?.text).toMatch(
      surface === 'terminal' ? /Read +~\/project\/notes\.txt/ : /^Read$/,
    )
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Text', text: /^2 items · largest first +% of segment$/ })).toBeDefined()
    } else {
      expect(await ui.find({ type: 'Text', text: '2 items · largest first' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '% of segment' })).toBeDefined()
    }
    expect((await ui.find({ key: 'back' }))?.props.hotkey).toBe('b')
    expect((await ui.find({ key: 'sort' }))?.props.hotkey).toBe('s')
    // Without the keyboard the terminal drops the hotkeys; a desktop keeps
    // its controls' hotkeys, drawn as key caps, and a hotkey presses only with
    // the keyboard.
    await ui.redraw({ ...PANE.props })
    const kept = surface === 'terminal' ? [undefined, undefined, undefined] : [undefined, undefined, 'b']
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
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Text', text: /mcp__notes__search +notes/ })).toBeDefined()
    } else {
      // The title and its dim detail stand in columns of their own.
      expect(gridLines(await ui.drawn()).some(line => line.startsWith('mcp__notes__search notes ▬ '))).toBe(true)
    }
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

test('n and p at the end of an item step to the next and previous item of the list, in its order, across its pages', async ($, on) => {
  await chatWorld($, on, manyResults(45))
  const facts = async (ui: { find: (q: { type: string; text: RegExp }) => Promise<{ text?: string } | undefined> }) =>
    (await ui.find({ type: 'Text', text: / tokens · / }))?.text

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    // The last row of the first page; the item has one page, so n names the next item.
    await ui.press({ key: 'item-r:b20' })
    expect(await facts(ui)).toMatch(/^item 20 of 45 · \S+ tokens · raw · as loaded\b/)
    expect((await ui.find({ key: 'next' }))?.props).toMatchObject({ label: 'Next item', hotkey: 'n' })
    expect(isOff(await ui.find({ key: 'next' }), surface)).toBe(false)
    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /› Bash {2}step 21$/ })).toBeDefined()
    expect(await facts(ui)).toMatch(/^item 21 of 45 · /)
    expect((await ui.find({ key: 'prev' }))?.props.label).toBe('Prev item')
    // b opens the page that holds the item, with the ring on its row.
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: /largest first · page 2 of 3/ })).toBeDefined()
    expect((await ui.find({ key: 'item-r:b21' }))?.props.autoFocus).toBe(true)
    // p goes back across the page: the previous item, at its first page.
    await ui.press({ key: 'item-r:b21' })
    await ui.press({ key: 'prev' })
    expect(await facts(ui)).toMatch(/^item 20 of 45 · /)
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: /largest first · page 1 of 3/ })).toBeDefined()

    // Newest first: the step follows that order. The first item has no item before it.
    await ui.press({ key: 'sort' })
    await ui.press({ key: 'item-r:b45' })
    expect(await facts(ui)).toMatch(/^item 1 of 45 · /)
    expect(isOff(await ui.find({ key: 'prev' }), surface)).toBe(true)
    await ui.press({ key: 'prev' })
    expect(await facts(ui)).toMatch(/^item 1 of 45 · /)
    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /› Bash {2}step 44$/ })).toBeDefined()
    expect(await facts(ui)).toMatch(/^item 2 of 45 · /)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'sort' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('p onto a long item opens it at its first page', async ($, on) => {
  const long = Array.from({ length: 1230 }, (_, i) => `row ${i + 1}`).join('\n')
  await chatWorld($, on, [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'big', name: 'Bash', input: { command: 'seq' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'big', content: long }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'small', name: 'Bash', input: { command: 'date' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'small', content: 'Thu Nov 19' }] },
  ])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    // Largest first: the short item comes second, so p steps back onto the long one.
    await ui.press({ key: 'item-r:small' })
    expect(await ui.find({ type: 'Text', text: /^item 2 of 2 · / })).toBeDefined()
    await ui.press({ key: 'prev' })
    expect(await ui.find({ type: 'Text', text: /^item 1 of 2 · .* · lines 1-500 of 1,230$/ })).toBeDefined()
    expect((await ui.find({ type: 'Code' }))?.props.startLine).toBe(1)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('n onto another item opens it in its own default view, as loaded, not in the view shown', async ($, on) => {
  await chatWorld($, on, [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'one', name: 'Bash', input: { command: 'ls' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'one', content: 'a.txt\nb.txt\nc.txt\nd.txt' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'two', name: 'Bash', input: { command: 'date' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'two', content: 'Thu Nov 19' }] },
  ])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:one' })
    expect(await ui.find({ type: 'Text', text: /^item 1 of 2 · .* · raw · as loaded/ })).toBeDefined()
    // f switches this item to formatted; the next item opens raw, its own default.
    await ui.press({ key: 'format' })
    expect(await ui.find({ type: 'Text', text: /^item 1 of 2 · .* · formatted · as loaded/ })).toBeDefined()
    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /^item 2 of 2 · .* · raw · as loaded/ })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

/** A Bash call and its result of `size` characters. */
function bashStep(id: string, size: number): unknown[] {
  return [
    { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: `step ${id}` } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'o'.repeat(size) }] },
  ]
}

test('n steps in the list as it is now: an item that joined since, with no rebuild, is the next one', async ($, on) => {
  const before = [...bashStep('big', 3000), ...bashStep('small', 1000)]
  const w = await chatWorld($, on, before)

  for (const surface of SURFACES) {
    w.messages = before
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:big' })
    expect(await ui.find({ type: 'Text', text: /^item 1 of 2 · / })).toBeDefined()
    // A result between the two in size joins; no measurement rebuilt the
    // stored view, whose place still names the small one as next.
    w.messages = [...before, ...bashStep('mid', 2000)]
    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /› Bash {2}step mid$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^item 2 of 3 · / })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('n onto another file opens it as loaded, though the item before was shown on disk', async ($, on) => {
  const TODO = '/home/user/project/todo.txt'
  const readOf = (id: string, path: string, lines: string[]) => [
    { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: path } }] },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content: `${lines.map((line, i) => `     ${i + 1}\t${line}`).join('\n')}\n` }],
    },
  ]
  const w = await chatWorld($, on, [...readOf('first', NOTES, ['alpha', 'beta', 'gamma', 'delta']), ...readOf('second', TODO, ['one'])])
  w.files[TODO] = 'one\n'

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:first' })
    await ui.press({ key: 'view' })
    expect(await ui.find({ type: 'Text', text: /^item 1 of 2 · .* · on disk$/ })).toBeDefined()
    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /› Read {2}~\/project\/todo\.txt$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^item 2 of 2 · .* · as loaded$/ })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a page or view change of the open item counts its place and its list page as they are now', async ($, on) => {
  const long = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'long', name: 'Bash', input: { command: 'seq' } }] },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'long', content: Array.from({ length: 1230 }, (_, i) => `row ${i + 1}`).join('\n') }],
    },
  ]
  /** `n` results larger than the long one, which go before it, largest first. */
  const larger = (n: number) => Array.from({ length: n }, (_, k) => bashStep(`l${k}`, 12_000)).flat()
  const w = await chatWorld($, on, long)

  for (const surface of SURFACES) {
    w.messages = long
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:long' })
    expect(await ui.find({ type: 'Text', text: /^item 1 of 1 · / })).toBeDefined()
    // 25 larger results join, with no rebuild: the item moves to the 26th
    // place, on the second page of the list. The next page of its text says so.
    w.messages = [...larger(25), ...long]
    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /^item 26 of 26 · .* · lines 501-1,000 of 1,230$/ })).toBeDefined()
    // b opens the page that holds it, with the ring on its row.
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: /largest first · page 2 of 2/ })).toBeDefined()
    expect((await ui.find({ key: 'item-r:long' }))?.props.autoFocus).toBe(true)
    // One more joins: a switch of view counts it.
    await ui.press({ key: 'item-r:long' })
    w.messages = [...larger(26), ...long]
    await ui.press({ key: 'format' })
    expect(await ui.find({ type: 'Text', text: /^item 27 of 27 · .* · formatted · / })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('an item of one page that is the only one of its list that opens: p and n leave the line', async ($, on) => {
  await chatWorld($, on, [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'one', name: 'Bash', input: { command: 'date' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'one', content: 'Thu Nov 19' }] },
  ])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:one' })
    expect(await ui.find({ type: 'Text', text: /^item 1 of 1 · / })).toBeDefined()
    expect(await ui.find({ key: 'prev' })).toBeUndefined()
    expect(await ui.find({ key: 'next' })).toBeUndefined()
    // The terminal still takes the two letters, drawing nothing.
    const taken = (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith('taken-'))
    expect(taken.filter(key => key === 'taken-p' || key === 'taken-n')).toEqual(surface === 'terminal' ? ['taken-p', 'taken-n'] : [])
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

/**
 * Off the terminal the words of a group stand in a Box with the native
 * button's padding, so that they start where a Button's label starts: that
 * Box's one Text. The terminal draws no such Box.
 */
function wordsIn(part: Part): Part {
  const inner = part.children ?? []

  return part.type === 'Box' && part.props?.paddingLeft === LABEL_PAD_CELLS && inner.length === 1 && (inner[0] as Part)?.type === 'Text' ? (inner[0] as Part) : part
}

/** The parts of one group, as the engine draws them: the words, and each plain control as `hotkey: label`. */
function groupParts(group: Part): string[] {
  return (group.children ?? []).flatMap(child => {
    const part = wordsIn(child as Part)
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
      inner.every(one => (one as Part)?.type === 'Button' || wordsIn(one as Part).type === 'Text')
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
    // Off the terminal the rows take no digit: the words name Enter alone.
    const open = surface === 'terminal' ? '⏎ 1-9 0: Open' : '⏎: Open'
    const words = (await ui.findAll({ type: 'Text', text: /: Open$/ })).map(text => text.text)
    expect(words).toEqual([open])
    expect(await ui.find({ type: 'Text', text: /Move/ })).toBeUndefined()
    const groups1 = keyGroupsOf(await ui.drawn())!
    expect(groups1).toEqual([
      [open, ...steps('j: ↓', 'k: ↑')],
      ['r: Refresh', 'x: Close'],
    ])
    // The drawn line, as the groups wrap at the pane's 45 columns: on the
    // desktop both groups fit on one row.
    const lines1 = flatten(await ui.drawn(), { surface, columns: 45 })
    const keys1 = lines1.slice(lines1.findIndex(line => line.startsWith('⏎ ')))
    expect(keys1).toEqual(
      surface === 'terminal' ? ['⏎ 1-9 0: Open  j: ↓  k: ↑', 'r: Refresh  x: Close'] : ['⏎: Open  r: Refresh  x: Close'],
    )
    expect(keys1.every(line => cellWidth(line) <= 45)).toBe(true)
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

    // Level 3 of a Bash result: no file, so v, c and m leave the line. It
    // has one page, and the list has another item that opens: p and n step
    // between the items.
    await ui.press({ key: 'item-r:tu2' })
    expect(await keyLine(ui)).toEqual([...steps('scroll-down', 'scroll-up'), 'back', 'prev', 'next', 'format', 'refresh', 'close'])
    expect(await taken(ui)).toEqual(keeps('v', 'c', 'm'))
    expect(keyGroupsOf(await ui.drawn())).toEqual([
      [...steps('j: ↓', 'k: ↑'), 'b: Back', 'p: Prev item', 'n: Next item'],
      ['f: Formatted'],
      ['r: Refresh', 'x: Close'],
    ])
    // On the terminal the move group is wider than 45 columns: it wraps
    // inside itself, and the next groups start a row of their own.
    const lines3 = flatten(await ui.drawn(), { surface, columns: 45 })
    const at3 = lines3.findIndex(line => /^[jb]: /.test(line))
    const keys3 =
      surface === 'terminal'
        ? ['j: ↓  k: ↑  b: Back  p: Prev item', 'n: Next item', 'f: Formatted  r: Refresh  x: Close']
        : ['b: Back  p: Prev item  n: Next item', 'f: Formatted  r: Refresh  x: Close']
    const drawn3 = lines3.slice(at3, at3 + keys3.length + 1)
    expect(drawn3).toEqual([...keys3, ''])
    expect(drawn3.every(line => cellWidth(line) <= 45)).toBe(true)
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
  expect(lines.slice(at, at + 3)).toEqual(['j: ↓  k: ↑  b: Back  p: Prev item', 'n: Next item', 'f: Formatted  r: Refresh  x: Close'])
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
