// Journey 6, list navigation by keys: at levels 1 and 2, j, k and the arrows
// move the ring row by row. Level 1 stops at its ends; level 2 crosses to the
// next or the previous page. Enter (a press on the ring's row) opens it, and
// b comes back with the ring on that row. The wheel is never a ring move, and
// at level 3 the arrows scroll the text, and so do j and k on the terminal
// (elsewhere they move the first line shown). An arrow at the end of a
// list with no page that way goes on to the engine as a scroll. Without the
// keys, a press of Down or Up at a list level changes nothing.
//
// What the kit lets a test see:
// - It has no answer for the mod's own `$.ui.focus`, so no ring really
//   moves. The mod writes its ring record (`ringWrites`) for each move just
//   before it asks for the focus, on both surfaces: that record is the
//   check of every move. The terminal also lights the row the mod put the
//   ring on (its figures at full strength). The reveal scroll that follows
//   a granted focus never runs, so no test sees it.
// - It sends no arrow. A test raises the `ui.scroll` the engine raises for
//   one: origin person, one row, no pointer, as register.tsx matches it.
//   The mod answers it without waiting for the move, so the test waits a
//   moment after each arrow.

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { manyResults, richUsage } from '../fixtures'
import { flatten, hold, hotkey, litRow, mountPane, ringOf, ringWrites, rowsOf, session, setFocus } from './helpers'
import type { PaneUi } from './helpers'

const SURFACES = ['terminal', 'desktop'] as const

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
  return flatten(await ui.drawn())
    .map(line => /page \d+ of \d+$/.exec(line)?.[0])
    .find(page => page !== undefined)
}

for (const surface of SURFACES) {
  test(`J6 ${surface}: j, k and the arrows move the ring at levels 1 and 2; Enter opens, b comes back; level 3 scrolls`, async ($, on) => {
    const { seen, ring } = await listWorld($, on)
    const ui = await mountPane($, surface, { columns: 88, isFocused: true, rows: WINDOW.bodyRows })
    const lights = surface === 'terminal'
    /** On the terminal, the row lit now; on the desktop, nothing to read. */
    const lit = async (key: string | undefined) => {
      if (lights) {
        expect(await litRow(ui)).toBe(key)
      }
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
    // Off the terminal j and k move the text, not the window: they push no
    // step, so the scrolls the world raises land where the engine resolved
    // them (row 0). The arrow still scrolls.
    expect(seen.map(one => [one.origin, one.offset])).toEqual(
      surface === 'terminal'
        ? [
            ['plugin', from + 1],
            ['plugin', from],
            ['person', from + 1],
          ]
        : [
            ['plugin', 0],
            ['plugin', 0],
            ['person', 1],
          ],
    )

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

    // Without the keys, a press of Down or Up (a click on the desktop's
    // controls) changes nothing: no ring move, no new drawing.
    if (surface === 'desktop') {
      await setFocus(ui, false)
      const before = flatten(await ui.drawn())
      const writes = ring.length
      for (const key of ['list-down', 'list-up']) {
        expect(await ui.find({ key }), key).toBeDefined()
        await ui.press({ key })
        expect(flatten(await ui.drawn()), key).toEqual(before)
        expect(ring.slice(writes), key).toEqual([])
      }
    }
    await ui.unmount()
  })
}
