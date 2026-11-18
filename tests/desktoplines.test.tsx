import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { CHAT, FOCUSED_PANE, NOTES, PANE, isOff, richUsage, world } from './fixtures'

// Off the terminal, j and k at level 3 ask for no scroll: each press moves
// the first line the text shows (lines.ts), and the head stays on top. The
// engine there clamps a plugin's scroll to a height it recorded when the
// pane opened, so a scroll step was cut back to row 0 after a long item
// opened.

const START = { cwd: '/home/user/project', surface: 'terminal', isInteractive: true } as const
/** 1,200 lines: pages 1-500, 501-1,000 and 1,001-1,200. */
const LONG = Array.from({ length: 1200 }, (_, i) => `row ${i + 1}`).join('\n')
const BIG = [
  { role: 'assistant', content: [{ type: 'tool_use', id: 'big', name: 'Bash', input: { command: 'seq 1200' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'big', content: LONG }] },
]

type Seen = { offset: number; origin: string }

/**
 * A measured session holding CHAT and BIG. Beneath the mod's press hook the
 * world raises the scroll the engine would raise for a j or k step, over a
 * window standing at row 5: a step token of the mod's would move it to 4 or
 * 6; with none it lands where `start` resolved, row 0.
 */
async function linesWorld($: Engine, on: On, messages: readonly unknown[] = [...CHAT, ...BIG], raisesScroll = true) {
  const w = world(on)
  const seen: Seen[] = []
  on('ui.scroll', (_, e) => {
    seen.push({ offset: e.offset, origin: e.origin.kind })

    return {}
  })
  on('ui.press', { plugin: '*' }, async (_, e, next) => {
    const result = await next(e)
    if (raisesScroll && (e.element === 'scroll-down' || e.element === 'scroll-up')) {
      await $.ui.scroll({
        component: 'Pane',
        requestId: 'context-breakdown',
        offset: 0,
        by: -5,
        bodyRows: 20,
        contentRows: 600,
        origin: { kind: 'plugin', name: 'context-breakdown' },
      })
    }

    return result
  })
  // Every write of the view, as the mod makes it.
  const writes: unknown[] = []
  on('state.set', async (_, e, next) => {
    const change = e as unknown as { key?: string; value?: { value?: unknown } }
    if (change.key === 'view') {
      writes.push(change.value?.value)
    }

    return next(e)
  })
  w.usage = richUsage()
  w.messages = messages
  w.files = { [NOTES]: 'alpha\nbeta\n' }
  await $.session.start(START)
  await w.clock.advance(0)

  return { w, seen, writes }
}

/** What the helpers below need of a mounted pane. */
type Mounted = {
  find: (q: { type: string; text?: RegExp }) => Promise<{ props: Record<string, unknown>; text?: string } | undefined>
  press: (target: { key: string }) => Promise<unknown>
}

/** The gutter's first number: the first line the text shows. */
async function firstShown(ui: Mounted): Promise<unknown> {
  return (await ui.find({ type: 'Code' }))?.props.startLine
}

/** The place part of the level-3 facts line, or undefined. */
async function place(ui: Mounted): Promise<string | undefined> {
  const facts = await ui.find({ type: 'Text', text: / · lines? [\d,]+/ })

  return / · (lines? [\d,]+.*)$/.exec(String(facts?.text))?.[1]
}

async function openBig(ui: Mounted) {
  await ui.press({ key: 'row-tool-results' })
  await ui.press({ key: 'item-r:big' })
}

test('desktop: 10 quick j start the text 10 lines later, one view write each, and k after them goes back one', async ($, on) => {
  const { writes } = await linesWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  await openBig(ui)
  expect(await firstShown(ui)).toBe(1)

  writes.length = 0
  await Promise.all(Array.from({ length: 10 }, () => ui.press({ key: 'scroll-down' })))
  expect(writes.length).toBe(10)
  expect(writes.map(view => (view as { item: { top?: number } }).item.top)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  expect(await firstShown(ui)).toBe(11)
  await ui.press({ key: 'scroll-up' })
  expect(await firstShown(ui)).toBe(10)
  expect(await place(ui)).toBe('lines 10-500 of 1,200')
  await ui.unmount()
})

test('desktop: j and k ask for no scroll and push no step; the terminal still does', async ($, on) => {
  const { seen } = await linesWorld($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await openBig(ui)
    seen.length = 0
    await ui.press({ key: 'scroll-down' })
    await ui.press({ key: 'scroll-down' })
    await ui.press({ key: 'scroll-up' })
    // The terminal's steps move the window row by row from 5 (the engine
    // here reports 5 each time, so they go on from their last target); off
    // it the scroll the world raised passes on as resolved: no step token.
    const offsets = seen.filter(one => one.origin === 'plugin').map(one => one.offset)
    expect(offsets).toEqual(surface === 'terminal' ? [6, 7, 6] : [0, 0, 0])
    expect(await firstShown(ui)).toBe(surface === 'terminal' ? 1 : 2)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('desktop: j crosses to the next page at its last line; k crosses back and shows the end of the page', async ($, on) => {
  await linesWorld($, on)
  // A 20-row window, so the page entered from its end shows few lines.
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop', props: { ...FOCUSED_PANE.props, scroll: { offset: 0, bodyRows: 20 } } })
  await openBig(ui)

  // k at the first line of the first page: nothing.
  await ui.press({ key: 'scroll-up' })
  expect(await place(ui)).toBe('lines 1-500 of 1,200')

  await ui.press({ key: 'next' })
  expect(await firstShown(ui)).toBe(501)
  await ui.press({ key: 'scroll-up' })
  // Back on page 1, at its end: about one window of lines, never more than the rows.
  const first = Number(await firstShown(ui))
  expect(first).toBeGreaterThan(480)
  expect(first).toBeLessThanOrEqual(500)
  expect(await place(ui)).toBe(`lines ${first}-500 of 1,200`)
  // j to the last line, then one more: page 2 at its top.
  for (let n = first; n < 500; n += 1) {
    await ui.press({ key: 'scroll-down' })
  }
  expect(await place(ui)).toBe('line 500 of 1,200, page 1 of 3')
  await ui.press({ key: 'scroll-down' })
  expect(await firstShown(ui)).toBe(501)
  expect(await place(ui)).toBe('lines 501-1,000 of 1,200')
  await ui.unmount()
})

test('desktop: a new page shows its top; f and v keep the line shown first; a refresh keeps the place unless the text changed', async ($, on) => {
  const { w } = await linesWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  await openBig(ui)
  const down = async (n: number) => {
    for (let k = 0; k < n; k += 1) {
      await ui.press({ key: 'scroll-down' })
    }
  }

  await down(5)
  expect(await firstShown(ui)).toBe(6)
  await ui.press({ key: 'refresh' })
  expect(await firstShown(ui)).toBe(6)
  await ui.press({ key: 'next' })
  expect(await firstShown(ui)).toBe(501)
  await down(2)
  await ui.press({ key: 'prev' })
  expect(await firstShown(ui)).toBe(1)

  // The formatted view starts at the line shown first, and so does raw again.
  await down(3)
  await ui.press({ key: 'format' })
  expect(await place(ui)).toBe('lines 4-499 of 1,200')
  await ui.press({ key: 'format' })
  expect(await firstShown(ui)).toBe(4)
  await ui.press({ key: 'back' })

  // The Read of notes.txt: on disk starts at its top; v back and forth keeps
  // line 2, which both texts have. A refresh that finds the file changed
  // starts at the top.
  await ui.press({ key: 'item-r:tu1' })
  await ui.press({ key: 'view' })
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('alpha\nbeta')
  await down(1)
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('beta')
  await ui.press({ key: 'view' })
  await ui.press({ key: 'view' })
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('beta')
  w.files = { [NOTES]: 'gamma\nbeta\n' }
  await ui.press({ key: 'refresh' })
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('gamma\nbeta')
  await ui.unmount()
})

test('desktop: Down and Up are on only while a press would move the text', async ($, on) => {
  await linesWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  await openBig(ui)
  const state = async () => [isOff(await ui.find({ key: 'scroll-down' })), isOff(await ui.find({ key: 'scroll-up' }))]

  // The first line of the first page: Up is off.
  expect(await state()).toEqual([false, true])
  // Up is on once the text moved, on the first page too.
  await ui.press({ key: 'scroll-down' })
  expect(await state()).toEqual([false, false])
  // The last page, at its first line: both on (k opens page 2).
  await ui.press({ key: 'next' })
  await ui.press({ key: 'next' })
  expect(await state()).toEqual([false, false])
  await ui.press({ key: 'back' })

  // A Bash result of one page: "total 0" and a line of 3,000 characters in
  // three pieces. j stops at the last piece, which repeats the line's number.
  await ui.press({ key: 'item-r:tu2' })
  expect(await state()).toEqual([false, true])
  for (let n = 0; n < 3; n += 1) {
    await ui.press({ key: 'scroll-down' })
  }
  const runs = (await ui.findAll({ type: 'Code' })).map(code => [code.props.startLine, String(code.props.source).length])
  expect(runs).toEqual([[2, 1000]])
  expect(await state()).toEqual([true, false])
  // j there does nothing.
  await ui.press({ key: 'scroll-down' })
  expect((await ui.findAll({ type: 'Code' })).length).toBe(1)
  // The terminal keeps both on: there they scroll.
  const terminal = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  expect([isOff(await terminal.find({ key: 'scroll-down' })), isOff(await terminal.find({ key: 'scroll-up' }))]).toEqual([false, false])
  // And draws the text from its top, whatever the desktop left.
  expect((await terminal.findAll({ type: 'Code' })).map(code => code.props.startLine)).toEqual([1, 2, 2, 2])
  await terminal.unmount()
  await ui.unmount()
})

test('desktop: a click on Down or Up without the keys does what j and k do', async ($, on) => {
  await linesWorld($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openBig(ui)
  await ui.press({ key: 'scroll-down' })
  await ui.press({ key: 'scroll-down' })
  expect(await firstShown(ui)).toBe(3)
  await ui.press({ key: 'scroll-up' })
  expect(await firstShown(ui)).toBe(2)
  await ui.unmount()
})

/** A skill body: a heading, a paragraph, a fence with a blank line inside, a table and a list. */
const SKILL = [
  'Base directory for this skill: /home/user/.claude/skills/blocks',
  '',
  '# Blocks',
  '',
  'One paragraph',
  'on two lines.',
  '',
  '```js',
  'const a = 1',
  '',
  'const b = 2',
  '```',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '| 3 | 4 |',
  '',
  '- one',
  '- two',
  '',
  'The end.',
].join('\n')

/** Opens the one skill body of the session. */
async function openSkill(ui: Mounted & { findAll: (q: { type: string }) => Promise<{ key?: string }[]> }) {
  await ui.press({ key: 'row-skill-bodies' })
  const item = (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').find(key => key.startsWith('item-'))!
  await ui.press({ key: item })
}

test('desktop: the formatted view steps one line at a time; a code block and a table keep their frame', async ($, on) => {
  await linesWorld($, on, [{ role: 'user', content: [{ type: 'text', text: SKILL }] }])
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  await openSkill(ui)
  const markdown = async () => String((await ui.find({ type: 'Markdown' }))?.props.text)
  const whole = await markdown()
  const steps: string[] = [whole]
  for (let n = 0; n < 12; n += 1) {
    await ui.press({ key: 'scroll-down' })
    steps.push(await markdown())
  }
  // Each press drops one line with text from the top; blank lines are
  // skipped. Inside the fence the opening line stays in front; inside the
  // table the header row and the separator row do.
  expect(steps.map(text => text.split('\n')[0])).toEqual([
    whole.split('\n')[0],
    '# Blocks',
    'One paragraph',
    'on two lines.',
    '```js',
    '```js',
    '```js',
    '| a | b |',
    '| a | b |',
    '| a | b |',
    '- one',
    '- two',
    'The end.',
  ])
  const after = '\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\n- one\n- two\n\nThe end.'
  expect(steps[3]).toBe(`on two lines.\n\n\`\`\`js\nconst a = 1\n\nconst b = 2${after}`)
  expect(steps[4]).toBe(`\`\`\`js\nconst a = 1\n\nconst b = 2${after}`)
  expect(steps[5]).toBe(`\`\`\`js\n\nconst b = 2${after}`)
  expect(steps[6]).toBe(`\`\`\`js\nconst b = 2${after}`)
  const list = '\n\n- one\n- two\n\nThe end.'
  expect(steps[8]).toBe(`| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |${list}`)
  expect(steps[9]).toBe(`| a | b |\n| - | - |\n| 3 | 4 |${list}`)
  for (const text of steps) {
    const rest = text.startsWith('```js\n')
      ? text.slice('```js\n'.length)
      : text.startsWith('| a | b |\n| - | - |\n| 3')
        ? text.slice('| a | b |\n| - | - |\n'.length)
        : text
    expect(whole.endsWith(rest)).toBe(true)
  }
  // An item of one page: the facts line says where the text starts now.
  expect(await place(ui)).toMatch(/^lines? \d+/)
  expect(isOff(await ui.find({ key: 'scroll-down' }))).toBe(true)
  // k steps back line by line.
  await ui.press({ key: 'scroll-up' })
  expect((await markdown()).split('\n')[0]).toBe('- two')
  await ui.unmount()
})

/** A skill body whose text is one paragraph of 430 lines: a list of names, one per line. */
const NAMES = ['Base directory for this skill: /home/user/.claude/skills/names', '', ...Array.from({ length: 430 }, (_, i) => `name ${i + 1}`)].join('\n')

test('desktop: in a formatted paragraph of 430 lines, three j move the text three lines and k one back', async ($, on) => {
  await linesWorld($, on, [{ role: 'user', content: [{ type: 'text', text: NAMES }] }])
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  await openSkill(ui)
  const firstText = async () => String((await ui.find({ type: 'Markdown' }))?.props.text).split('\n')[0]
  await ui.press({ key: 'scroll-down' })
  expect(await firstText()).toBe('name 1')
  const before = Number(/^lines ([\d,]+)-/.exec(String(await place(ui)))?.[1])
  for (let n = 0; n < 3; n += 1) {
    await ui.press({ key: 'scroll-down' })
  }
  expect(await firstText()).toBe('name 4')
  expect(Number(/^lines ([\d,]+)-/.exec(String(await place(ui)))?.[1])).toBe(before + 3)
  expect(isOff(await ui.find({ key: 'scroll-down' }))).toBe(false)
  await ui.press({ key: 'scroll-up' })
  expect(await firstText()).toBe('name 3')
  await ui.unmount()
})

/** The stored item, as the last write of the view left it. */
function lastItem(writes: readonly unknown[]): { format: string; page: number; top?: number } {
  return (writes[writes.length - 1] as { item: { format: string; page: number; top?: number } }).item
}

/** The Markdown shown, and its second line (the first line inside a fence). */
async function markdownOf(ui: Mounted): Promise<string> {
  return String((await ui.find({ type: 'Markdown' }))?.props.text)
}

// The two tests below raise no scroll for j and k, as the desktop raises
// none: the one the world above raises would read as the end of f's read of
// the window.
test('desktop: j, f, j, j pressed at once apply in that order, as one at a time would, and none is lost', async ($, on) => {
  const { writes } = await linesWorld($, on, [...CHAT, ...BIG], false)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  const keys = ['scroll-down', 'format', 'scroll-down', 'scroll-down']

  // One at a time first: the place each press leaves.
  await openBig(ui)
  for (const key of keys) {
    await ui.press({ key })
  }
  const oneByOne = { ...lastItem(writes) }
  const shown = await markdownOf(ui)
  expect(oneByOne.format).toBe('formatted')
  // f kept line 2, and each j after it stepped one line inside the fence.
  expect(oneByOne.top).toBeGreaterThanOrEqual(2)
  await ui.press({ key: 'back' })

  // All at once, in the same order.
  await ui.press({ key: 'item-r:big' })
  await Promise.all(keys.map(key => ui.press({ key })))
  expect(lastItem(writes)).toMatchObject({ format: 'formatted', page: 0, top: oneByOne.top })
  expect(await markdownOf(ui)).toBe(shown)
  await ui.unmount()
})

test('desktop: f, j and n, j (and the Next page below the text, j) pressed at once apply in that order', async ($, on) => {
  const { writes } = await linesWorld($, on, [...CHAT, ...BIG], false)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  await openBig(ui)
  writes.length = 0
  await Promise.all([ui.press({ key: 'format' }), ui.press({ key: 'scroll-down' })])
  expect(lastItem(writes)).toMatchObject({ format: 'formatted', page: 0, top: 1 })
  expect((await markdownOf(ui)).split('\n').slice(0, 2)).toEqual(['```', 'row 2'])
  await ui.press({ key: 'back' })

  await ui.press({ key: 'item-r:big' })
  await Promise.all([ui.press({ key: 'next' }), ui.press({ key: 'scroll-down' })])
  expect(lastItem(writes)).toMatchObject({ format: 'raw', page: 1, top: 1 })
  expect(await firstShown(ui)).toBe(502)
  // The Next page below the text is in the same queue.
  await Promise.all([ui.press({ key: 'next-below' }), ui.press({ key: 'scroll-down' })])
  expect(lastItem(writes)).toMatchObject({ format: 'raw', page: 2, top: 1 })
  expect(await firstShown(ui)).toBe(1002)
  await ui.unmount()
})

test('desktop: a 1,200-line Bash result in the formatted view steps line by line, and its facts line follows', async ($, on) => {
  await linesWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  await openBig(ui)
  await ui.press({ key: 'format' })
  expect(await place(ui)).toBe('lines 1-499 of 1,200')
  const shown: string[] = []
  const firsts: number[] = []
  for (let n = 0; n < 5; n += 1) {
    await ui.press({ key: 'scroll-down' })
    const lines = (await markdownOf(ui)).split('\n')
    // Still drawn as code: the fence's opening line, then the next row.
    expect(lines[0]).toBe('```')
    shown.push(lines[1]!)
    firsts.push(Number(/^lines ([\d,]+)-/.exec(String(await place(ui)))?.[1]?.replace(/,/g, '')))
  }
  expect(shown).toEqual(['row 2', 'row 3', 'row 4', 'row 5', 'row 6'])
  // One line on per press, within a line of the row shown.
  expect(firsts.map((first, n) => first - firsts[0]! - n)).toEqual([0, 0, 0, 0, 0])
  expect(Math.abs(firsts[0]! - 2)).toBeLessThanOrEqual(1)
  await ui.unmount()
})

test('desktop: after 300 j on page 2 of 3, f to formatted and back keeps the line shown first', async ($, on) => {
  await linesWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'desktop' })
  await openBig(ui)
  await ui.press({ key: 'next' })
  await Promise.all(Array.from({ length: 300 }, () => ui.press({ key: 'scroll-down' })))
  expect(await place(ui)).toBe('lines 801-1,000 of 1,200')

  await ui.press({ key: 'format' })
  const facts = String(await place(ui))
  const first = Number(/^lines ([\d,]+)-/.exec(facts)?.[1]?.replace(/,/g, ''))
  // Formatted page 2 (lines 500-997), from the nearest unit at or before line 801.
  expect(facts).toMatch(/-997 of 1,200$/)
  expect(first).toBeLessThanOrEqual(801)
  expect(first).toBeGreaterThanOrEqual(799)
  const row = Number(/^row (\d+)$/.exec((await markdownOf(ui)).split('\n')[1]!)?.[1])
  expect(Math.abs(row - 801)).toBeLessThanOrEqual(2)

  // Back to raw: the line the formatted view showed first, exactly.
  await ui.press({ key: 'format' })
  expect(await firstShown(ui)).toBe(first)
  expect(await place(ui)).toBe(`lines ${first}-1,000 of 1,200`)
  await ui.unmount()
})
