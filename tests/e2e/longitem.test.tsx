// Journey 5, long item and keys: a Bash result of 1,200 lines, three pages
// of level 3. n and p page it. On the terminal j and k, pressed through
// `hotkey` and `hold`, move the window one row per press, cross to the next
// page at the bottom and back at the top, and do nothing without the
// keyboard. On the desktop they ask for no scroll: each press redraws the
// text one line later or earlier under the head, and crosses pages the same
// way (lines.ts). In the formatted view a step is one line too, also in a
// paragraph of 430 lines.
//
// The kit refuses the mod's own `$.ui.scroll` before any hook. So the world
// here plays the engine: after each press it raises the `ui.scroll` the
// engine would raise for the mod's step, over a window it keeps (where it
// stands, the rows of the tree, the rows that show), and the bottom of the
// chain records where each scroll lands. Two windows:
// - a real one, which stands where the last scroll left it;
// - a stale one, which stands still between presses, as the desktop app's
//   engine was seen to report the old row while the window moved on.

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { richUsage } from '../fixtures'
import { flatten, hold, hotkey, mountPane, session, setFocus } from './helpers'
import type { PaneUi } from './helpers'

/** Where j and k scroll the window; the desktop has a journey of its own below. */
const SURFACES = ['terminal'] as const

/** 1,200 lines: pages 1-500, 501-1,000 and 1,001-1,200. */
const LONG = Array.from({ length: 1200 }, (_, i) => `row ${i + 1}`).join('\n')
const BIG = [
  { role: 'assistant', content: [{ type: 'tool_use', id: 'big', name: 'Bash', input: { command: 'seq 1200' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'big', content: LONG }] },
]

/** The rows that show: a 66-row window. */
const BODY = 66
/** The rows of each page's tree: 500 lines and the head; the last page is shorter. */
const ROWS: Record<string, number> = { '1-500': 560, '501-1,000': 560, '1,001-1,200': 266 }

/** Where the engine's window stands over the pane's tree. */
type Window = { standing: number; contentRows: number; bodyRows: number; stale: boolean }

/** A scroll that reached the bottom of the chain. */
type Seen = { offset: number; by: number; origin: string }

/**
 * A measured session holding BIG, with the engine's window played as told
 * above. Hooks are added before the session starts, beneath the mod's.
 */
async function longWorld($: Engine, on: On, win: Window) {
  const seen: Seen[] = []
  on('ui.scroll', (_, e) => {
    seen.push({ offset: e.offset, by: e.by, origin: e.origin.kind })
    // A real window stands where the scroll put it; a stale one does not move.
    if (!win.stale) {
      win.standing = e.offset
    }

    return {}
  })
  // Beneath the mod's press hook: its step is pushed, its scroll not yet
  // asked. The engine raises that scroll over the window as it stands.
  on('ui.press', { plugin: '*' }, async (_, e, next) => {
    const result = await next(e)
    await $.ui.scroll({
      component: 'Pane',
      requestId: 'context-breakdown',
      offset: 0,
      by: -win.standing,
      bodyRows: win.bodyRows,
      contentRows: win.contentRows,
      origin: { kind: 'plugin', name: 'context-breakdown' },
    })

    return result
  })
  await session($, on, { usage: richUsage(), messages: BIG })

  return seen
}

/** The line range the level-3 facts line shows, as "first-last". */
async function shown(ui: PaneUi): Promise<string | undefined> {
  const facts = flatten(await ui.drawn()).find(line => / · lines [\d,]+-[\d,]+ of [\d,]+$/.test(line))

  return facts === undefined ? undefined : /lines ([\d,]+-[\d,]+) of/.exec(facts)?.[1]
}

/**
 * One press of `ch`, then the window as a real engine leaves it: on a new
 * page the mod asks for the top (j, n, p) or the bottom (k from the top),
 * and the kit refuses that call, so the world moves the window itself.
 */
async function step(ui: PaneUi, win: Window, ch: string): Promise<boolean> {
  const before = await shown(ui)
  const found = await hotkey(ui, ch)
  const after = await shown(ui)
  if (after !== before && after !== undefined) {
    win.contentRows = ROWS[after] ?? win.contentRows
    win.standing = ch === 'k' ? win.contentRows - win.bodyRows : 0
  }

  return found
}

/** The offsets of the scrolls of the mod that reached the bottom. */
const offsets = (seen: readonly Seen[]) => seen.filter(one => one.origin === 'plugin').map(one => one.offset)

/** The numbers from `from` to `to`, one step at a time, either way. */
function run(from: number, to: number): number[] {
  const sign = to >= from ? 1 : -1

  return Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => from + sign * i)
}

for (const surface of SURFACES) {
  test(`J5 ${surface}: a long item pages with n and p, and j and k move a real window one row per press`, async ($, on) => {
    const win: Window = { standing: 0, contentRows: ROWS['1-500']!, bodyRows: BODY, stale: false }
    const seen = await longWorld($, on, win)
    const ui = await mountPane($, surface, { columns: 88, isFocused: true, rows: BODY })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:big' })
    expect(await shown(ui)).toBe('1-500')

    // n and p page the item, each to the top of its page.
    expect(await step(ui, win, 'n')).toBe(true)
    expect(await shown(ui)).toBe('501-1,000')
    expect(await step(ui, win, 'n')).toBe(true)
    expect(await shown(ui)).toBe('1,001-1,200')
    expect(await step(ui, win, 'p')).toBe(true)
    expect(await step(ui, win, 'p')).toBe(true)
    expect(await shown(ui)).toBe('1-500')
    win.standing = 0

    // 10 quick j, then 60: one row each, none lost.
    seen.length = 0
    expect(await hold(ui, 'j', 10)).toBe(10)
    expect(offsets(seen)).toEqual(run(1, 10))
    expect(await hold(ui, 'j', 60)).toBe(60)
    expect(offsets(seen)).toEqual(run(1, 70))
    // 10 k, then 60: back to the top, row by row.
    seen.length = 0
    expect(await hold(ui, 'k', 10)).toBe(10)
    expect(await hold(ui, 'k', 60)).toBe(60)
    expect(offsets(seen)).toEqual(run(69, 0))
    expect(await shown(ui)).toBe('1-500')

    // At the bottom (560 - 66 = 494) the next j opens the next page at its top.
    win.standing = 490
    seen.length = 0
    for (let n = 0; n < 4; n += 1) {
      expect(await step(ui, win, 'j')).toBe(true)
    }
    expect(offsets(seen)).toEqual(run(491, 494))
    expect(await shown(ui)).toBe('1-500')
    expect(await step(ui, win, 'j')).toBe(true)
    expect(await shown(ui)).toBe('501-1,000')
    // On the new page j steps on from its top.
    seen.length = 0
    expect(await step(ui, win, 'j')).toBe(true)
    expect(offsets(seen)).toEqual([1])
    // k at its top goes back to the first page, at its bottom.
    expect(await step(ui, win, 'k')).toBe(true)
    expect(await step(ui, win, 'k')).toBe(true)
    expect(await shown(ui)).toBe('1-500')
    seen.length = 0
    expect(await step(ui, win, 'k')).toBe(true)
    expect(offsets(seen)).toEqual([493])

    // Without the keyboard (Escape) no key reaches the pane: nothing moves.
    await setFocus(ui, false)
    seen.length = 0
    const before = flatten(await ui.drawn())
    expect(await hold(ui, 'j', 10)).toBe(0)
    expect(await hold(ui, 'k', 10)).toBe(0)
    expect(await hotkey(ui, 'n')).toBe(false)
    expect(seen).toEqual([])
    expect(flatten(await ui.drawn())).toEqual(before)
    expect(await shown(ui)).toBe('1-500')
    await ui.unmount()
  })

  test(`J5 ${surface}: j and k go on row by row while the engine reports a stale window`, async ($, on) => {
    const win: Window = { standing: 5, contentRows: ROWS['1-500']!, bodyRows: BODY, stale: true }
    const seen = await longWorld($, on, win)
    const ui = await mountPane($, surface, { columns: 88, isFocused: true, rows: BODY })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:big' })

    // The window stands at 5 for every scroll the engine raises: each press
    // still moves one row on from the last, 10 and then 60 of them.
    seen.length = 0
    expect(await hold(ui, 'j', 10)).toBe(10)
    expect(offsets(seen)).toEqual(run(6, 15))
    expect(await hold(ui, 'j', 60)).toBe(60)
    expect(offsets(seen)).toEqual(run(6, 75))
    seen.length = 0
    expect(await hold(ui, 'k', 10)).toBe(10)
    expect(offsets(seen)).toEqual(run(74, 65))

    // A stale window at 492 of a last offset of 494: two rows, then the next page.
    win.standing = 492
    seen.length = 0
    expect(await hold(ui, 'j', 2)).toBe(2)
    expect(offsets(seen)).toEqual([493, 494])
    expect(await shown(ui)).toBe('1-500')
    expect(await hotkey(ui, 'j')).toBe(true)
    expect(await shown(ui)).toBe('501-1,000')
    // At the top of that page, still reported at 0: k goes back a page.
    win.standing = 0
    expect(await hotkey(ui, 'k')).toBe(true)
    expect(await shown(ui)).toBe('1-500')

    // Without the keyboard nothing moves.
    await setFocus(ui, false)
    seen.length = 0
    expect(await hold(ui, 'j', 60)).toBe(0)
    expect(seen).toEqual([])
    await ui.unmount()
  })
}

/** The level-3 facts line's place part: "lines 11-500 of 1,200" and the like. */
async function place(ui: PaneUi): Promise<string | undefined> {
  const facts = flatten(await ui.drawn()).find(line => / · lines? [\d,]+/.test(line))

  return facts === undefined ? undefined : / · (lines? [\d,]+.*)$/.exec(facts)?.[1]
}

/** The gutter's first number: the first line the text shows. */
async function firstShown(ui: PaneUi): Promise<unknown> {
  return (await ui.findAll({ type: 'Code' }))[0]?.props.startLine
}

test('J5 desktop: j and k move the first line shown one line per press, under a head that stays, and cross pages', async ($, on) => {
  const win: Window = { standing: 0, contentRows: ROWS['1-500']!, bodyRows: BODY, stale: false }
  const seen = await longWorld($, on, win)
  const ui = await mountPane($, 'desktop', { columns: 88, isFocused: true, rows: BODY })
  await ui.press({ key: 'row-tool-results' })
  await ui.press({ key: 'item-r:big' })
  expect(await shown(ui)).toBe('1-500')
  const head = flatten(await ui.drawn()).slice(0, 2)

  // n and p page the item.
  expect(await hotkey(ui, 'n')).toBe(true)
  expect(await shown(ui)).toBe('501-1,000')
  expect(await hotkey(ui, 'p')).toBe(true)
  expect(await shown(ui)).toBe('1-500')

  // 10 quick j, then 60: the text starts one line later each time, none lost.
  seen.length = 0
  expect(await hold(ui, 'j', 10)).toBe(10)
  expect(await firstShown(ui)).toBe(11)
  expect(await place(ui)).toBe('lines 11-500 of 1,200')
  expect(await hold(ui, 'j', 60)).toBe(60)
  expect(await firstShown(ui)).toBe(71)
  // The title and the facts line stay at the top; the controls with them.
  const lines = flatten(await ui.drawn())
  expect(lines[0]).toBe(head[0])
  expect(lines.indexOf(lines.find(line => line.includes('Down')) ?? '')).toBeLessThan(lines.indexOf(lines.find(line => line.includes('row 71')) ?? ''))
  expect(lines.some(line => / row 70$/.test(line))).toBe(false)
  // 10 k, then 60: back to the first line.
  expect(await hold(ui, 'k', 10)).toBe(10)
  expect(await firstShown(ui)).toBe(61)
  expect(await hold(ui, 'k', 60)).toBe(60)
  expect(await shown(ui)).toBe('1-500')
  // No press asked for a step: each scroll the world raised for a press
  // landed where the engine resolved it, row 0.
  expect(offsets(seen).length).toBe(140)
  expect(offsets(seen).every(offset => offset === 0)).toBe(true)

  // k at the first line of the first page does nothing.
  expect(await hotkey(ui, 'k')).toBe(true)
  expect(await shown(ui)).toBe('1-500')

  // On page 2, k at its first line goes back to page 1, at its end, with
  // about one window of text showing (66 rows less the head's 8).
  expect(await hotkey(ui, 'n')).toBe(true)
  expect(await hold(ui, 'j', 3)).toBe(3)
  expect(await firstShown(ui)).toBe(504)
  expect(await hold(ui, 'k', 4)).toBe(4)
  expect(await place(ui)).toBe('lines 443-500 of 1,200')
  // j to the page's last line, which can be the first shown; one more opens page 2.
  expect(await hold(ui, 'j', 57)).toBe(57)
  expect(await place(ui)).toBe('line 500 of 1,200, page 1 of 3')
  expect(await hotkey(ui, 'j')).toBe(true)
  expect(await shown(ui)).toBe('501-1,000')
  expect(await firstShown(ui)).toBe(501)

  // Without the keyboard (Escape) no key reaches the pane; a click on Down
  // still does what j does.
  await setFocus(ui, false)
  expect(await hold(ui, 'j', 10)).toBe(0)
  expect(await firstShown(ui)).toBe(501)
  await ui.press({ key: 'scroll-down' })
  expect(await firstShown(ui)).toBe(502)
  await ui.unmount()
})

/** A skill body whose formatted text is one paragraph of 430 lines: a list of names, one per line, no blank lines. */
const NAMES = ['Base directory for this skill: /home/user/.claude/skills/names', '', ...Array.from({ length: 430 }, (_, i) => `name ${i + 1}`)].join('\n')

test('J5 desktop: in the formatted view j and k move a 430-line paragraph one line per press', async ($, on) => {
  await session($, on, { usage: richUsage(), messages: [{ role: 'user', content: [{ type: 'text', text: NAMES }] }] })
  const ui = await mountPane($, 'desktop', { columns: 88, isFocused: true, rows: BODY })
  await ui.press({ key: 'row-skill-bodies' })
  const item = (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').find(key => key.startsWith('item-'))!
  await ui.press({ key: item })
  const firstText = async () => String((await ui.findAll({ type: 'Markdown' }))[0]?.props.text).split('\n')[0]
  const drawnNames = async () => flatten(await ui.drawn()).filter(line => /\bname \d+\b/.test(line))

  // One j to the paragraph's first line, then three more: three lines on.
  expect(await hotkey(ui, 'j')).toBe(true)
  expect(await firstText()).toBe('name 1')
  expect(await hold(ui, 'j', 3)).toBe(3)
  expect(await firstText()).toBe('name 4')
  // The drawn text starts at name 4, and the facts line says so: line 6 of the body.
  expect((await drawnNames())[0]).toMatch(/\bname 4$/)
  expect(await place(ui)).toBe('lines 6-432 of 432')
  // k one back.
  expect(await hotkey(ui, 'k')).toBe(true)
  expect(await firstText()).toBe('name 3')
  expect(await place(ui)).toBe('lines 5-432 of 432')
  await ui.unmount()
})
