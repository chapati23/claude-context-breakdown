// Journey 5, long item and keys: a Bash result of 1,200 lines, three pages
// of level 3. n and p page it. On the terminal j and k, pressed through
// `hotkey` and `hold`, move the window one row per press, cross to the next
// page at the bottom and back at the top, and are not offered without the
// keyboard. On the desktop level 3 draws no j and k: the app's own scrolling
// moves the text, so the person's scrolls go on to the engine, and f, v, n
// and p show their text from the top without reading or placing the window.
//
// The kit refuses the mod's own `$.ui.scroll` before any hook. So the world
// here plays the engine: after each press it raises the `ui.scroll` the
// engine would raise for the mod's step, over a window it keeps (where it
// stands, the rows of the tree, the rows that show), and the bottom of the
// chain records where each scroll lands.

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { richUsage } from '../fixtures'
import { chat, flatten, hold, hotkey, hotkeysOf, mountPane, session, setFocus } from './helpers'
import type { PaneUi, SessionOptions } from './helpers'

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
type Window = { standing: number; contentRows: number; bodyRows: number }

/** A scroll that reached the bottom of the chain. */
type Seen = { offset: number; by: number; origin: string }

/**
 * A measured session holding BIG (or `opts`), with the engine's window played
 * as told above. Hooks are added before the session starts, beneath the mod's.
 */
async function longWorld($: Engine, on: On, win: Window, opts: SessionOptions = { usage: richUsage(), messages: BIG }) {
  const seen: Seen[] = []
  on('ui.scroll', (_, e) => {
    seen.push({ offset: e.offset, by: e.by, origin: e.origin.kind })
    // The window stands where the scroll put it.
    win.standing = e.offset

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
  await session($, on, opts)

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
    const win: Window = { standing: 0, contentRows: ROWS['1-500']!, bodyRows: BODY }
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

    // Without the keyboard (Escape) the terminal offers no key at all: no
    // Button holds a hotkey, so no key can reach the pane, and Down and Up go.
    await setFocus(ui, false)
    expect(await hotkeysOf(ui)).toEqual([])
    expect(await ui.findAll({ key: 'scroll-down' })).toEqual([])
    expect(await ui.findAll({ key: 'scroll-up' })).toEqual([])
    expect(await shown(ui)).toBe('1-500')
    await ui.unmount()
  })
}

/** The level-3 facts line's form and source: "raw · as loaded" and the like. */
async function form(ui: PaneUi): Promise<string | undefined> {
  const facts = flatten(await ui.drawn()).find(line => / tokens · (raw|formatted) · /.test(line))

  return facts === undefined ? undefined : / · ((raw|formatted) · (as loaded|on disk))/.exec(facts)?.[1]
}

/** The person's scroll of the pane: an arrow (no pointer), `by` rows from where the window stands. */
function personScroll($: Engine, win: Window, by: number) {
  return $.ui.scroll({
    component: 'Pane',
    requestId: 'context-breakdown',
    offset: win.standing + by,
    by,
    bodyRows: win.bodyRows,
    contentRows: win.contentRows,
    origin: { kind: 'person' },
  })
}

test('J5 desktop: level 3 draws no j and k, leaves the person’s scrolls to the app, and f, v, n and p ask for no placement', async ($, on) => {
  const win: Window = { standing: 0, contentRows: ROWS['1-500']!, bodyRows: BODY }
  // BIG and the chat's Read result, which v can switch to the file on disk.
  const read = chat()
  const seen = await longWorld($, on, win, { ...read, messages: [...(read.messages ?? []), ...BIG] })
  const ui = await mountPane($, 'desktop', { columns: 88, isFocused: true, rows: BODY })
  await ui.press({ key: 'row-tool-results' })
  await ui.press({ key: 'item-r:big' })
  expect(await shown(ui)).toBe('1-500')

  // No Down or Up and no j or k key cap, with the keys and without them.
  const noSteps = async (state: string) => {
    for (const key of ['scroll-down', 'scroll-up', 'list-down', 'list-up']) {
      expect(await ui.findAll({ key }), `${state}: ${key}`).toEqual([])
    }
    const caps = await hotkeysOf(ui)
    expect(caps, state).not.toContain('j')
    expect(caps, state).not.toContain('k')
    expect(caps, state).toContain('n')
  }
  await noSteps('with the keys')
  await setFocus(ui, false)
  await noSteps('without the keys')
  await setFocus(ui, true)

  // An arrow down and up at level 3 goes on to the engine as it came: the
  // mod's hook passes it on and does not answer for itself.
  seen.length = 0
  await personScroll($, win, 1)
  await personScroll($, win, -1)
  expect(seen).toEqual([
    { offset: 1, by: 1, origin: 'person' },
    { offset: 0, by: -1, origin: 'person' },
  ])

  // n and p page the item. Each press pushes no step, so the scroll the
  // world raises for it lands where the engine resolved it, row 0.
  win.standing = 300
  seen.length = 0
  expect(await hotkey(ui, 'n')).toBe(true)
  expect(await shown(ui)).toBe('501-1,000')
  expect(await hotkey(ui, 'p')).toBe(true)
  expect(await shown(ui)).toBe('1-500')
  expect(await hotkey(ui, 'n')).toBe(true)
  // f from the bottom of raw page 2, which shows line 1,000 of formatted page
  // 3: the window is not read, so each view opens at the top of the page that
  // holds the first line of the page shown before (formatted page 2 is
  // 500-997, and its line 500 is on raw page 1).
  win.standing = ROWS['501-1,000']! - BODY
  expect(await hotkey(ui, 'f')).toBe(true)
  expect(await form(ui)).toBe('formatted · as loaded')
  expect(await shown(ui)).toBe('500-997')
  expect(await hotkey(ui, 'f')).toBe(true)
  expect(await form(ui)).toBe('raw · as loaded')
  expect(await shown(ui)).toBe('1-500')
  expect(offsets(seen)).toEqual([0, 0, 0, 0, 0])

  // v on the Read result: the file on disk, from its top, and again no placement.
  expect(await hotkey(ui, 'b')).toBe(true)
  await ui.press({ key: 'item-r:tu1' })
  expect(await form(ui)).toBe('raw · as loaded')
  win.standing = 3
  seen.length = 0
  expect(await hotkey(ui, 'v')).toBe(true)
  expect(await form(ui)).toBe('raw · on disk')
  expect((await ui.findAll({ type: 'Code' }))[0]?.props).toMatchObject({ source: 'alpha\nbeta', startLine: 1 })
  expect(offsets(seen)).toEqual([0])
  await ui.unmount()
})
