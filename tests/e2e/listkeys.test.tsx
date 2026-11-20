// Journey 6, list navigation by keys. On the terminal, at levels 1 and 2, j,
// k and the arrows move the ring row by row. Level 1 stops at its ends; level
// 2 crosses to the next or the previous page. A Shift+Tab back onto a row is
// where the next j starts. Enter (a press on the ring's row) opens it, and b
// comes back with the ring on that row. The wheel is never a ring move, and
// at level 3 the arrows, j and k scroll the text. An arrow at the end of a
// list with no page that way goes on to the engine as a scroll.
//
// On the desktop the pane uses the app's own keys only: no Down, Up, j or k
// at any level, every arrow goes on to the engine, and the mod writes no ring
// key. Enter and the digits still open rows, and b comes back.
//
// What the kit lets a test see:
// - It has no answer for the mod's own `$.ui.focus`, so no ring really
//   moves. On the terminal the mod writes its ring key (`ringWrites`) for
//   each move just before it asks for the focus: that key is the check of
//   every move. The terminal also lights the row the mod put the ring on
//   (its figures at full strength). The reveal scroll that follows a granted
//   focus never runs, so no test sees it.
// - It sends no Tab. A test raises the person's `ui.focus` the engine raises
//   for one on the terminal. The desktop raises none for Tab.
// - It sends no arrow. A test raises the `ui.scroll` the engine raises for
//   one: origin person, one row, no pointer, as register.tsx matches it.
//   The mod answers it without waiting for the move, so the test waits a
//   moment after each arrow.

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { manyResults, richUsage } from '../fixtures'
import { flatten, hold, hotkey, hotkeysOf, litRow, mountPane, ringOf, ringWrites, rowsOf, session, setFocus } from './helpers'
import type { PaneUi } from './helpers'

/** The window the engine reports for the pane; it stands where the last scroll left it. */
const WINDOW = { standing: 3, contentRows: 40, bodyRows: 30 }

/** A scroll that reached the bottom of the chain. */
type Seen = { offset: number; by: number; origin: string }

/**
 * A measured session with 45 tool results (three pages of level 2). The
 * bottom of the chain records each scroll that reaches it. After a press of
 * j or k at level 3 the world raises the scroll the engine raises for the
 * mod's step, which the kit refuses to raise itself.
 */
async function listWorld($: Engine, on: On) {
  const seen: Seen[] = []
  const ring = ringWrites(on)
  WINDOW.standing = 3
  on('ui.scroll', (_, e) => {
    seen.push({ offset: e.offset, by: e.by, origin: e.origin.kind })
    WINDOW.standing = e.offset

    return {}
  })
  on('ui.press', { plugin: '*' }, async (_, e, next) => {
    const result = await next(e)
    if (e.element === 'scroll-down' || e.element === 'scroll-up') {
      await $.ui.scroll({
        component: 'Pane',
        requestId: 'context-breakdown',
        offset: 0,
        by: -WINDOW.standing,
        bodyRows: WINDOW.bodyRows,
        contentRows: WINDOW.contentRows,
        origin: { kind: 'plugin', name: 'context-breakdown' },
      })
    }

    return result
  })
  await session($, on, { usage: richUsage(), messages: manyResults(45) })

  return { seen, ring }
}

/** The scroll the engine raises for a person: an arrow (one row, no pointer) or the wheel. */
function personScroll($: Engine, by: number, pointer?: { column: number; row: number }) {
  return $.ui.scroll({
    component: 'Pane',
    requestId: 'context-breakdown',
    offset: Math.max(0, WINDOW.standing + by),
    by,
    bodyRows: WINDOW.bodyRows,
    contentRows: WINDOW.contentRows,
    origin: { kind: 'person' },
    ...(pointer === undefined ? {} : { pointer }),
  })
}

/** Waits `ms` on the host's clock, so a move no hook waits for (an arrow's) ends. */
function wait(ms: number): Promise<void> {
  const host = globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown }

  return new Promise(resolve => void host.setTimeout(resolve, ms))
}

/** One arrow press: the person's scroll, then a moment for the move. */
async function arrow($: Engine, by: 1 | -1): Promise<void> {
  await personScroll($, by)
  await wait(20)
}

/** The page the level-2 facts line states, as "page 1 of 3". */
async function pageOf(ui: PaneUi): Promise<string | undefined> {
  // Off the terminal the column's name always follows the facts on their line.
  return flatten(await ui.drawn())
    .map(line => /page \d+ of \d+(?=$| +% of )/.exec(line)?.[0])
    .find(page => page !== undefined)
}

/** The person moves the ring onto `element`: Tab, Shift+Tab or a click. */
function ringOn($: Engine, element: string) {
  return $.ui.focus({ component: 'Pane', requestId: 'context-breakdown', plugin: 'context-breakdown', element, origin: { kind: 'person' } })
}

test('J6 terminal: j, k and the arrows move the ring at levels 1 and 2; Enter opens, b comes back; level 3 scrolls', async ($, on) => {
  const { seen, ring } = await listWorld($, on)
  const ui = await mountPane($, 'terminal', { columns: 88, isFocused: true, rows: WINDOW.bodyRows })
  /** The row lit now. */
  const lit = async (key: string | undefined) => {
    expect(await litRow(ui)).toBe(key)
  }

  // Level 1: the ring starts on the first row; k there stops.
  const rows = await rowsOf(ui)
  expect(rows.length).toBeGreaterThan(5)
  expect(await ringOf(ui)).toBe(rows[0])
  await lit(rows[0])
  ring.length = 0
  expect(await hotkey(ui, 'k')).toBe(true)
  expect(ring).toEqual([])
  await lit(rows[0])

  // j three times, then the arrows down and up: row by row, and the mod
  // asks for exactly those rows, one per press.
  ring.length = 0
  expect(await hold(ui, 'j', 3)).toBe(3)
  expect(ring).toEqual([rows[1], rows[2], rows[3]])
  await lit(rows[3])
  seen.length = 0
  await arrow($, 1)
  await lit(rows[4])
  await arrow($, -1)
  await lit(rows[3])
  expect(ring).toEqual([rows[1], rows[2], rows[3], rows[4], rows[3]])
  // The engine got no arrow to scroll: the mod answered both itself.
  expect(seen).toEqual([])

  // The wheel, even by one row, goes on to the engine and moves no ring.
  await personScroll($, 1, { column: 4, row: 6 })
  await wait(20)
  expect(seen.map(one => [one.origin, one.by])).toEqual([['person', 1]])
  expect(ring).toHaveLength(5)
  await lit(rows[3])

  // A Shift+Tab back onto the second row: the next j starts there.
  await ringOn($, rows[1]!)
  await lit(rows[1])
  expect(await hotkey(ui, 'j')).toBe(true)
  expect(ring.slice(-2)).toEqual([rows[1], rows[2]])
  await lit(rows[2])

  // j past the last row stops on it.
  expect(await hold(ui, 'j', rows.length + 3)).toBe(rows.length + 3)
  expect(ring.at(-1)).toBe(rows.at(-1))
  await lit(rows.at(-1))
  expect(await rowsOf(ui)).toEqual(rows)

  // There the arrow down has no row and no page to go to: it goes on to
  // the engine as a scroll of the window, and the ring stays.
  const moves = ring.length
  seen.length = 0
  await arrow($, 1)
  expect(seen.map(one => [one.origin, one.by])).toEqual([['person', 1]])
  expect(ring).toHaveLength(moves)
  await lit(rows.at(-1))

  // Back up to Tool results, then Enter: its items open.
  const tools = rows.indexOf('row-tool-results')
  expect(tools).toBeGreaterThanOrEqual(0)
  expect(await hold(ui, 'k', rows.length - 1 - tools)).toBe(rows.length - 1 - tools)
  await lit('row-tool-results')
  await ui.press({ key: 'row-tool-results' })
  expect(await pageOf(ui)).toBe('page 1 of 3')

  // Level 2: 20 rows a page. Nineteen j stay on page 1, the twentieth
  // opens page 2 on its first row, and k goes back to page 1's last row.
  const page1 = await rowsOf(ui)
  expect(page1.length).toBe(20)
  expect(await ringOf(ui)).toBe(page1[0])
  expect(await hold(ui, 'j', 19)).toBe(19)
  expect(await pageOf(ui)).toBe('page 1 of 3')
  await lit(page1[19])
  expect(await hotkey(ui, 'j')).toBe(true)
  expect(await pageOf(ui)).toBe('page 2 of 3')
  const page2 = await rowsOf(ui)
  expect(await ringOf(ui)).toBe(page2[0])
  await lit(page2[0])
  expect(await hotkey(ui, 'k')).toBe(true)
  expect(await pageOf(ui)).toBe('page 1 of 3')
  expect(await ringOf(ui)).toBe(page1[19])
  expect(ring.at(-1)).toBe(page1[19])
  await lit(page1[19])
  // The arrow down crosses the same way.
  await arrow($, 1)
  expect(await pageOf(ui)).toBe('page 2 of 3')
  expect(await ringOf(ui)).toBe(page2[0])
  expect(ring.at(-1)).toBe(page2[0])

  // Two rows on, Enter opens that item; at level 3 j, k and the arrows scroll.
  expect(await hold(ui, 'j', 2)).toBe(2)
  expect(ring.slice(-2)).toEqual([page2[1], page2[2]])
  await lit(page2[2])
  await ui.press({ key: page2[2]! })
  expect(flatten(await ui.drawn()).some(line => / · lines [\d,]+-[\d,]+ of [\d,]+$|tokens/.test(line))).toBe(true)
  seen.length = 0
  const from = WINDOW.standing
  expect(await hotkey(ui, 'j')).toBe(true)
  expect(await hotkey(ui, 'k')).toBe(true)
  await arrow($, 1)
  expect(seen.map(one => [one.origin, one.offset])).toEqual([
    ['plugin', from + 1],
    ['plugin', from],
    ['person', from + 1],
  ])

  // b comes back to page 2 with the ring on the item, then to level 1 with
  // the ring on Tool results.
  expect(await hotkey(ui, 'b')).toBe(true)
  expect(await pageOf(ui)).toBe('page 2 of 3')
  expect(await ringOf(ui)).toBe(page2[2])
  await lit(page2[2])
  expect(await hotkey(ui, 'b')).toBe(true)
  expect(await rowsOf(ui)).toEqual(rows)
  expect(await ringOf(ui)).toBe('row-tool-results')
  await lit('row-tool-results')
  // And j goes on from there.
  expect(await hotkey(ui, 'j')).toBe(true)
  expect(ring.at(-1)).toBe(rows[tools + 1])
  await lit(rows[tools + 1])
  await ui.unmount()
})

test('J6 desktop: no Down, Up, j or k in the lists; the arrows go to the app; Enter opens, no digit does, b comes back', async ($, on) => {
  const { seen, ring } = await listWorld($, on)
  const ui = await mountPane($, 'desktop', { columns: 88, isFocused: true, rows: WINDOW.bodyRows })
  /** No Down or Up control and no j or k key cap at this level. */
  const noSteps = async (where: string) => {
    for (const key of ['list-down', 'list-up', 'scroll-down', 'scroll-up']) {
      expect(await ui.find({ key }), `${where} ${key}`).toBeUndefined()
    }
    expect(await hotkeysOf(ui), where).not.toContain('j')
    expect(await hotkeysOf(ui), where).not.toContain('k')
  }
  /** A press of list-down by its key: no Button holds it, so the kit refuses it. */
  const pressDown = async () => {
    try {
      await ui.press({ key: 'list-down' })
    } catch (error) {
      return String(error)
    }

    return 'pressed'
  }
  /**
   * The ring keys written for a row or a control. A new tree writes "no key"
   * (null) on every surface; only the terminal writes a key.
   */
  const keysWritten = () => ring.filter(key => key !== 'null')

  // Level 1: the ring starts on the first row; the key words name Enter only: the rows take no digit.
  const rows = await rowsOf(ui)
  expect(rows.length).toBeGreaterThan(5)
  expect(await ringOf(ui)).toBe(rows[0])
  await noSteps('level 1')
  expect(flatten(await ui.drawn()).some(line => line.startsWith('⏎: Open') && !line.includes('Move'))).toBe(true)
  ring.length = 0
  expect(await hotkey(ui, 'j')).toBe(false)
  expect(await pressDown()).toContain('no Button')

  // Every arrow and the wheel go on to the engine: the app scrolls the pane.
  seen.length = 0
  await arrow($, 1)
  await arrow($, -1)
  await personScroll($, 1, { column: 4, row: 6 })
  await wait(20)
  expect(seen.map(one => [one.origin, one.by])).toEqual([
    ['person', 1],
    ['person', -1],
    ['person', 1],
  ])
  // A focus move the desktop reports (a click on a row) writes no ring key
  // either: the mod moved nothing.
  await ringOn($, rows[3]!)
  expect(keysWritten()).toEqual([])
  // The tree still asks for the ring on the first row, its autoFocus key.
  expect(await ringOf(ui)).toBe(rows[0])

  // No digit opens Tool results; Enter on its row (a press) does.
  const tools = rows.indexOf('row-tool-results')
  expect(tools).toBeGreaterThanOrEqual(0)
  expect(tools).toBeLessThan(9)
  expect(await hotkey(ui, String(tools + 1))).toBe(false)
  await ui.press({ key: 'row-tool-results' })
  expect(await pageOf(ui)).toBe('page 1 of 3')

  // Level 2: the same rule.
  const page1 = await rowsOf(ui)
  expect(await ringOf(ui)).toBe(page1[0])
  await noSteps('level 2')
  expect(await pressDown()).toContain('no Button')
  seen.length = 0
  await arrow($, 1)
  expect(seen.map(one => [one.origin, one.by])).toEqual([['person', 1]])
  expect(await pageOf(ui)).toBe('page 1 of 3')
  expect(keysWritten()).toEqual([])

  // Enter (a press on a row) opens it; b comes back with the ring on it.
  await ui.press({ key: page1[2]! })
  expect(flatten(await ui.drawn()).some(line => / · lines [\d,]+-[\d,]+ of [\d,]+$|tokens/.test(line))).toBe(true)
  await noSteps('level 3')
  expect(await hotkey(ui, 'b')).toBe(true)
  expect(await ringOf(ui)).toBe(page1[2])
  // The digit 3 opens nothing; Enter opens the same row again.
  expect(await hotkey(ui, '3')).toBe(false)
  await ui.press({ key: page1[2]! })
  expect(flatten(await ui.drawn()).some(line => / · lines [\d,]+-[\d,]+ of [\d,]+$|tokens/.test(line))).toBe(true)
  expect(await hotkey(ui, 'b')).toBe(true)
  expect(await hotkey(ui, 'b')).toBe(true)
  expect(await rowsOf(ui)).toEqual(rows)
  expect(await ringOf(ui)).toBe('row-tool-results')

  // Without the keys no hotkey presses, and a click still opens a row.
  await setFocus(ui, false)
  expect(await hotkey(ui, String(tools + 1))).toBe(false)
  await ui.press({ key: 'row-tool-results' })
  expect(await pageOf(ui)).toBe('page 1 of 3')
  expect(keysWritten()).toEqual([])
  await ui.unmount()
})
