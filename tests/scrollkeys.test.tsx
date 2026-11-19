import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { keysHint } from '../hooks/pane'
import { CHAT, FOCUSED_PANE, NOTES, PANE, SURFACES, isOff, manyResults, richUsage, world } from './fixtures'

// The kit does not carry a plugin's own `$.ui.scroll` (it rejects the call
// before any hook), so these tests raise the `ui.scroll` the engine would
// raise for it, origin this plugin, and read what the mod's hook passes on.

/** The surfaces where j and k at level 3 scroll the window. */
const TERMINAL = ['terminal'] as const

const START = { cwd: '/home/user/project', surface: 'terminal', isInteractive: true } as const
/** 1,200 lines: three pages of level 3. */
const LONG = Array.from({ length: 1200 }, (_, i) => `row ${i + 1}`).join('\n')
const BIG = [
  { role: 'assistant', content: [{ type: 'tool_use', id: 'big', name: 'Bash', input: { command: 'seq' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'big', content: LONG }] },
]

type Seen = { offset: number; by: number; origin: { kind: string } }

/** Where the window stands over a tree, as the engine reads it for a scroll. */
type Window = { standing: number; contentRows: number; bodyRows: number }

/**
 * A measured session, with what reaches the bottom of `ui.scroll` recorded.
 * With `standing`, every press of the mod's also raises the scroll the engine
 * would raise for a j or k, over a window standing where `standing()` says
 * (a row of a 60-row tree in a 20-row window, or a whole Window).
 */
async function scrollWorld($: Engine, on: On, messages: readonly unknown[] = CHAT, standing?: () => number | Window) {
  const w = world(on)
  const seen: Seen[] = []
  on('ui.scroll', (_, e) => {
    seen.push({ offset: e.offset, by: e.by, origin: e.origin })

    return {}
  })
  if (standing !== undefined) {
    // Beneath the mod's press hook: its step is pushed, its scroll not yet asked.
    on('ui.press', { plugin: '*' }, async (_, e, next) => {
      const result = await next(e)
      const at = standing()
      await (typeof at === 'number' ? ourScroll($, at) : ourScroll($, at.standing, at.contentRows, at.bodyRows))

      return result
    })
  }
  w.usage = richUsage()
  w.messages = messages
  w.files = { [NOTES]: 'alpha\nbeta\n' }
  await $.session.start(START)
  await w.clock.advance(0)

  return { w, seen }
}

/** The `ui.scroll` the engine raises for a `$.ui.scroll` to `start`, the window standing at `standing`. */
function ourScroll($: Engine, standing: number, contentRows = 60, bodyRows = 20) {
  return $.ui.scroll({
    component: 'Pane',
    requestId: 'context-breakdown',
    offset: 0,
    by: -standing,
    bodyRows,
    contentRows,
    origin: { kind: 'plugin', name: 'context-breakdown' },
  })
}

test('on the terminal j and k are hotkeys at every level while the pane has the keyboard; elsewhere there are none', async ($, on) => {
  await scrollWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    const hotkeys = async () => (await ui.findAll({ type: 'Button' })).map(button => button.props.hotkey)
    // Levels 1 and 2 key them apart from level 3, so no tree of one level
    // holds the key of level 3's first control (scroll.ts). Off the terminal
    // no level has Down and Up and no j or k key cap: Tab moves the ring
    // along the rows, and the app's own scrolling moves the text.
    const check = async (down: string, up: string) => {
      if (surface !== 'terminal') {
        for (const key of ['scroll-down', 'scroll-up', 'list-down', 'list-up']) {
          expect(await ui.find({ key })).toBeUndefined()
        }
        expect(await hotkeys()).not.toContain('j')
        expect(await hotkeys()).not.toContain('k')

        return
      }
      expect((await ui.find({ key: down }))?.props).toMatchObject({ hotkey: 'j', label: 'Down' })
      expect((await ui.find({ key: up }))?.props).toMatchObject({ hotkey: 'k', label: 'Up' })
      const other = down === 'scroll-down' ? ['list-down', 'list-up'] : ['scroll-down', 'scroll-up']
      for (const key of other) {
        expect(await ui.find({ key })).toBeUndefined()
      }
    }
    await check('list-down', 'list-up')
    await ui.press({ key: 'row-tool-results' })
    await check('list-down', 'list-up')
    await ui.press({ key: 'item-r:tu1' })
    expect(await ui.find({ type: 'Code' })).toBeDefined()
    await check('scroll-down', 'scroll-up')

    // Without the keyboard: the hint as before, and no j or k at level 3.
    await ui.redraw({ ...PANE.props })
    expect(await ui.find({ type: 'Text', text: keysHint(surface) })).toBeDefined()
    for (const key of ['scroll-down', 'scroll-up']) {
      expect(await ui.find({ key })).toBeUndefined()
    }
    expect(await hotkeys()).not.toContain('j')
    expect(await hotkeys()).not.toContain('k')
    await ui.redraw({ ...FOCUSED_PANE.props })
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a press moves the window one row from where it stands, within the tree', async ($, on) => {
  let standing = 0
  const { seen } = await scrollWorld($, on, BIG, () => standing)

  // The terminal only: off it level 3 draws no j and k, and the app scrolls
  // the text (tests/e2e/longitem.test.tsx).
  for (const surface of TERMINAL) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:big' })
    seen.length = 0

    standing = 5
    await ui.press({ key: 'scroll-down' })
    // Then an arrow moves the window back from 6 to 5: k steps from 5, not
    // from the 6 the last j went to.
    await $.ui.scroll({
      component: 'Pane',
      requestId: 'context-breakdown',
      offset: 5,
      by: -1,
      bodyRows: 20,
      contentRows: 60,
      origin: { kind: 'person' },
    })
    standing = 5
    await ui.press({ key: 'scroll-up' })
    // k at the top, j at the bottom (60 rows, 20 showing: the last offset is 40).
    standing = 0
    await ui.press({ key: 'scroll-up' })
    standing = 40
    await ui.press({ key: 'scroll-down' })
    // The arrow at level 3 goes on to the engine, untouched.
    expect(seen.map(one => [one.origin.kind, one.offset])).toEqual([
      ['plugin', 6],
      ['person', 5],
      ['plugin', 4],
      ['plugin', 0],
      ['plugin', 40],
    ])

    // A settled press leaves no step behind: a later scroll of ours (the top
    // after a page change) lands where the engine resolved it.
    seen.length = 0
    await ourScroll($, 17)
    expect(seen.map(one => one.offset)).toEqual([0])
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the wheel passes through, and the next j continues from where it left the window', async ($, on) => {
  let standing = 0
  const { seen } = await scrollWorld($, on, BIG, () => standing)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  await ui.press({ key: 'row-tool-results' })
  await ui.press({ key: 'item-r:big' })
  seen.length = 0

  // Three wheel ticks from 9: the engine moves the window to 12, untouched.
  await $.ui.scroll({
    component: 'Pane',
    requestId: 'context-breakdown',
    offset: 12,
    by: 3,
    bodyRows: 20,
    contentRows: 60,
    origin: { kind: 'person' },
  })
  expect(seen).toEqual([{ offset: 12, by: 3, origin: { kind: 'person' } }])
  // The engine's next scroll for j starts from its window, now 12.
  standing = 12
  await ui.press({ key: 'scroll-down' })
  expect(seen.at(-1)?.offset).toBe(13)
  await ui.unmount()
})

test('presses that overlap step one after the other, each from the row the last one left', async ($, on) => {
  // The window stands where the last scroll that reached the bottom put it,
  // as the engine reads it when the next call starts.
  let seen: Seen[] = []
  const world = await scrollWorld($, on, BIG, () => seen.at(-1)?.offset ?? 5)
  seen = world.seen
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  await ui.press({ key: 'row-tool-results' })
  await ui.press({ key: 'item-r:big' })
  seen.length = 0

  await Promise.all([ui.press({ key: 'scroll-down' }), ui.press({ key: 'scroll-up' })])
  // j to 6, then k from 6 back to 5; both from 5 would end on 4.
  expect(seen.map(one => one.offset)).toEqual([6, 5])
  await ui.unmount()
})

test('after a page change the keys stay, and nothing of an earlier press moves the window', async ($, on) => {
  const { seen } = await scrollWorld($, on, BIG)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:big' })
    if (surface === 'terminal') {
      // In the kit the press's own call is refused: the press settles quietly.
      await ui.press({ key: 'scroll-down' })
      await ui.press({ key: 'scroll-down' })
    }
    await ui.press({ key: 'next' })
    expect((await ui.find({ type: 'Code' }))?.props.startLine).toBe(501)
    // Off the terminal level 3 draws no Down: the app scrolls the text.
    const down = await ui.find({ key: 'scroll-down' })
    expect(surface === 'terminal' ? down?.props.hotkey : down).toBe(surface === 'terminal' ? 'j' : undefined)
    // The engine keeps the window across pages; the mod then asks for the top.
    // No press is under way, so that scroll lands on row 0, not where the
    // window stood (30).
    seen.length = 0
    await ourScroll($, 30)
    expect(seen.map(one => one.offset)).toEqual([0])
    // f switches the view. The kit refuses its scroll that reads the window
    // (nothing beneath raises one here), so the other view opens at its top.
    await ui.press({ key: 'format' })
    await ourScroll($, 30)
    expect(seen.map(one => one.offset)).toEqual([0, 0])
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

/** The line range the level-3 facts line shows, as "first-last". */
async function shownLines(ui: { find: (q: { type: string; text: RegExp }) => Promise<{ text: string } | undefined> }) {
  const facts = await ui.find({ type: 'Text', text: /· lines [\d,]+-[\d,]+ of [\d,]+$/ })

  return /lines ([\d,]+-[\d,]+) of/.exec(String(facts?.text))?.[1]
}

test('j at the bottom opens the next page; k at the top opens the previous one; nothing at the ends', async ($, on) => {
  let at: Window = { standing: 0, contentRows: 560, bodyRows: 66 }
  await scrollWorld($, on, BIG, () => at)

  // The terminal only: off it level 3 draws no j and k, and the app scrolls
  // the text (tests/e2e/longitem.test.tsx).
  for (const surface of TERMINAL) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:big' })
    expect(await shownLines(ui)).toBe('1-500')

    // Inside the page j only steps.
    at = { standing: 100, contentRows: 560, bodyRows: 66 }
    await ui.press({ key: 'scroll-down' })
    expect(await shownLines(ui)).toBe('1-500')
    // k at the top of the first page: no page before it.
    at = { standing: 0, contentRows: 560, bodyRows: 66 }
    await ui.press({ key: 'scroll-up' })
    expect(await shownLines(ui)).toBe('1-500')
    // j at the bottom (560 - 66 = 494): the next page.
    at = { standing: 494, contentRows: 560, bodyRows: 66 }
    await ui.press({ key: 'scroll-down' })
    expect(await shownLines(ui)).toBe('501-1,000')
    expect((await ui.find({ type: 'Code' }))?.props.startLine).toBe(501)
    const ringed = async () =>
      (await ui.findAll({ type: 'Button' })).filter(button => button.props.autoFocus === true).map(button => button.key)
    // The next page starts at its top: the ring is on the first control, above the text.
    expect(await ringed()).toEqual(['scroll-down'])
    // k at its top: back to the first page (the mod then asks for its bottom).
    // The ring starts on the control under the text, so the engine, which
    // brings the ring into view, keeps the bottom too.
    at = { standing: 0, contentRows: 560, bodyRows: 66 }
    await ui.press({ key: 'scroll-up' })
    expect(await shownLines(ui)).toBe('1-500')
    expect(await ringed()).toEqual(['next-below'])
    // Any other move starts at the top again.
    await ui.press({ key: 'next' })
    expect(await ringed()).toEqual(['scroll-down'])
    await ui.press({ key: 'prev' })
    expect(await ringed()).toEqual(['scroll-down'])

    // The last page: j at its bottom does nothing.
    await ui.press({ key: 'next' })
    await ui.press({ key: 'next' })
    expect(await shownLines(ui)).toBe('1,001-1,200')
    at = { standing: 200, contentRows: 266, bodyRows: 66 }
    await ui.press({ key: 'scroll-down' })
    expect(await shownLines(ui)).toBe('1,001-1,200')
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a page that fits whole in the window: j and k go to the next and previous page at once', async ($, on) => {
  // 1,200 lines in pages of 500: each page's tree fits a tall window.
  const at: Window = { standing: 0, contentRows: 540, bodyRows: 600 }
  await scrollWorld($, on, BIG, () => at)

  // The terminal only: off it level 3 draws no j and k, and the app scrolls
  // the text (tests/e2e/longitem.test.tsx).
  for (const surface of TERMINAL) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:big' })
    await ui.press({ key: 'scroll-down' })
    expect(await shownLines(ui)).toBe('501-1,000')
    await ui.press({ key: 'scroll-down' })
    await ui.press({ key: 'scroll-down' })
    expect(await shownLines(ui)).toBe('1,001-1,200')
    await ui.press({ key: 'scroll-up' })
    expect(await shownLines(ui)).toBe('501-1,000')
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('an item of one page: j and k step inside it and never change it', async ($, on) => {
  let at: Window = { standing: 0, contentRows: 40, bodyRows: 20 }
  const { seen } = await scrollWorld($, on, CHAT, () => at)

  // The terminal only: off it level 3 draws no j and k, and the app scrolls
  // the text (tests/e2e/longitem.test.tsx).
  for (const surface of TERMINAL) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:tu2' })
    const source = (await ui.find({ type: 'Code' }))?.props.source
    seen.length = 0
    await ui.press({ key: 'scroll-down' })
    at = { standing: 20, contentRows: 40, bodyRows: 20 }
    await ui.press({ key: 'scroll-down' })
    at = { standing: 0, contentRows: 40, bodyRows: 20 }
    await ui.press({ key: 'scroll-up' })
    expect(seen.map(one => one.offset)).toEqual([1, 20, 0])
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe(source)
    expect(isOff(await ui.find({ key: 'next' }))).toBe(true)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('levels 1 and 2 taller than a small pane: j and k move the ring, never the window, and never change the list page', async ($, on) => {
  // A small inline pane: 12 rows for a list of 20 rows and its lines. Under
  // each press the engine raises a scroll of ours from row 5, as it would for
  // a step: with no step under way the mod's hook passes it on untouched (0,
  // where `start` resolved). A step token would move it to 6.
  const { seen } = await scrollWorld($, on, manyResults(45), () => 5)
  const untouched = async (ui: { press: (target: { key: string }) => Promise<unknown> }, key: string) => {
    seen.length = 0
    await ui.press({ key })
    await settle()
    expect(seen.map(one => one.offset), key).toEqual([0])
  }

  // The terminal only: elsewhere the lists draw no j and k.
  for (const surface of TERMINAL) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, scroll: { offset: 3, bodyRows: 12 } } })
    await untouched(ui, 'list-down')

    await ui.press({ key: 'row-tool-results' })
    const first = (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').find(key => key.startsWith('item-'))
    await untouched(ui, 'list-down')
    await untouched(ui, 'list-up')
    // Still page 1 of the list: n and p page it, j and k only move the ring on it.
    expect(await ui.find({ type: 'Text', text: /page 1 of 3$/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').find(key => key.startsWith('item-'))).toBe(first)
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

type Drawn = { key?: string; props: Record<string, unknown>; children?: readonly unknown[] }
const isDrawn = (x: unknown): x is Drawn => typeof x === 'object' && x !== null && 'props' in x

/**
 * The row the terminal draws lit: the one under the ring, whose figures stand
 * at full strength. The kit refuses the mod's own `$.ui.focus`, so the lit row
 * shows where the mod put the ring.
 */
async function litRow(ui: { findAll: (q: { type: string }) => Promise<Drawn[]> }): Promise<string | undefined> {
  const rows = (await ui.findAll({ type: 'Button' })).filter(button => /^(row|item)-/.test(button.key ?? ''))
  const lit = rows.filter(row => (row.children ?? []).some(child => isDrawn(child) && child.props.tabular === true && child.props.dimColor === false))

  return lit.length === 1 ? lit[0]!.key : lit.length === 0 ? undefined : 'several'
}

/** The ring on the pane's close mark: on no row of ours. */
function ringOff($: Engine) {
  return $.ui.focus({ component: 'Pane', requestId: 'context-breakdown', origin: { kind: 'person' } })
}

/** A person's scroll of the pane: an arrow (one row, no pointer), the wheel or a page key. */
function personScroll($: Engine, by: number, pointer?: { column: number; row: number }) {
  return $.ui.scroll({
    component: 'Pane',
    requestId: 'context-breakdown',
    offset: Math.max(0, 5 + by),
    by,
    bodyRows: 12,
    contentRows: 30,
    origin: { kind: 'person' },
    ...(pointer === undefined ? {} : { pointer }),
  })
}

/** Lets a move that no hook waits for (an arrow's) finish. */
const settle = () => wait(20)

/** Waits `ms` on the host's clock (the types of this mod declare no timers). */
function wait(ms: number): Promise<void> {
  const host = globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown }

  return new Promise(resolve => void host.setTimeout(resolve, ms))
}


/** The keys of the rows a drawing shows, in order. */
async function rowsOf(ui: { findAll: (q: { type: string }) => Promise<Drawn[]> }): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => /^(row|item)-/.test(key))
}

test('five quick j presses put the ring on the fifth row, and k after them on the fourth', async ($, on) => {
  await scrollWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  const rows = await rowsOf(ui)
  expect(rows.length).toBeGreaterThan(6)
  // Before any move the ring is on the row the tree asks for: the first.
  expect(await litRow(ui)).toBe(rows[0])

  await ringOff($)
  expect(await litRow(ui)).toBeUndefined()
  const j = () => ui.press({ key: 'list-down' })
  await Promise.all([j(), j(), j(), j(), j()])
  expect(await litRow(ui)).toBe(rows[4])
  await ui.press({ key: 'list-up' })
  expect(await litRow(ui)).toBe(rows[3])

  // A person's move (Tab, a click, the engine's own arrow walk) is where the next j starts.
  await $.ui.focus({ component: 'Pane', requestId: 'context-breakdown', plugin: 'context-breakdown', element: rows[5]!, origin: { kind: 'person' } })
  await j()
  expect(await litRow(ui)).toBe(rows[6])
  await ui.unmount()
})

test('on the terminal a Shift+Tab back onto a row j visited is where the next j starts', async ($, on) => {
  await scrollWorld($, on, manyResults(45))
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  for (const level of [1, 2]) {
    if (level === 2) {
      await ui.press({ key: 'row-tool-results' })
    }
    const rows = await rowsOf(ui)
    await ui.press({ key: 'list-down' })
    await ui.press({ key: 'list-down' })
    expect(await litRow(ui), `level ${level}`).toBe(rows[2])
    // The person's Shift+Tab: back onto the row the first j visited.
    await ringOn($, rows[1]!)
    expect(await litRow(ui), `level ${level}`).toBe(rows[1])
    await ui.press({ key: 'list-down' })
    expect(await litRow(ui), `level ${level}`).toBe(rows[2])
  }
  await ui.unmount()
})

test('at level 1 the ends stop; from a control j goes to the first row and k to the last', async ($, on) => {
  await scrollWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  const rows = await rowsOf(ui)
  await ui.press({ key: 'list-up' })
  expect(await litRow(ui)).toBe(rows[0])
  for (let n = 0; n < rows.length + 3; n += 1) {
    await ui.press({ key: 'list-down' })
  }
  expect(await litRow(ui)).toBe(rows.at(-1))

  // The ring on a control: no row is lit, and k goes to the last row.
  await $.ui.focus({ component: 'Pane', requestId: 'context-breakdown', plugin: 'context-breakdown', element: 'back', origin: { kind: 'person' } })
  expect(await litRow(ui)).toBeUndefined()
  await ui.press({ key: 'list-up' })
  expect(await litRow(ui)).toBe(rows.at(-1))
  await $.ui.focus({ component: 'Pane', requestId: 'context-breakdown', plugin: 'context-breakdown', element: 'close', origin: { kind: 'person' } })
  await ui.press({ key: 'list-down' })
  expect(await litRow(ui)).toBe(rows[0])
  await ui.unmount()
})

test('at level 2 j past the last row opens the next page on its first row, and k before the first the previous page on its last', async ($, on) => {
  await scrollWorld($, on, manyResults(45))
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  await ui.press({ key: 'row-tool-results' })
  const keys = async () => (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith('item-'))
  const ringed = async () =>
    (await ui.findAll({ type: 'Button' })).filter(button => button.props.autoFocus === true).map(button => button.key)
  const page1 = await keys()
  expect(await ui.find({ type: 'Text', text: /page 1 of 3$/ })).toBeDefined()

  // k on the first row of the first page: no page before it.
  await ui.press({ key: 'list-up' })
  expect(await ui.find({ type: 'Text', text: /page 1 of 3$/ })).toBeDefined()
  expect(await litRow(ui)).toBe(page1[0])
  for (let n = 1; n < page1.length; n += 1) {
    await ui.press({ key: 'list-down' })
  }
  expect(await litRow(ui)).toBe(page1.at(-1))
  await ui.press({ key: 'list-down' })
  expect(await ui.find({ type: 'Text', text: /page 2 of 3$/ })).toBeDefined()
  const page2 = await keys()
  expect(await ringed()).toEqual([page2[0]])
  expect(await litRow(ui)).toBe(page2[0])
  await ui.press({ key: 'list-up' })
  expect(await ui.find({ type: 'Text', text: /page 1 of 3$/ })).toBeDefined()
  expect(await ringed()).toEqual([page1.at(-1)])
  expect(await litRow(ui)).toBe(page1.at(-1))

  // The last page: j on its last row stays there.
  await ui.press({ key: 'next' })
  await ui.press({ key: 'next' })
  const page3 = await keys()
  for (let n = 0; n < page3.length + 2; n += 1) {
    await ui.press({ key: 'list-down' })
  }
  expect(await ui.find({ type: 'Text', text: /page 3 of 3$/ })).toBeDefined()
  expect(await litRow(ui)).toBe(page3.at(-1))
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('an arrow at level 1 or 2 moves the ring and keeps the window; the wheel, the page keys and level 3 scroll', async ($, on) => {
  const { seen } = await scrollWorld($, on, BIG)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  const rows = await rowsOf(ui)
  seen.length = 0

  await personScroll($, 1)
  await settle()
  // Answered without the engine: the window stays, and the ring takes the next row.
  expect(seen).toEqual([])
  expect(await litRow(ui)).toBe(rows[1])
  await personScroll($, -1)
  await settle()
  expect(await litRow(ui)).toBe(rows[0])

  // The wheel, even by one row, and a page key go on to the engine untouched.
  await personScroll($, 1, { column: 4, row: 6 })
  await personScroll($, 12)
  expect(seen.map(one => one.by)).toEqual([1, 12])
  expect(await litRow(ui)).toBe(rows[0])

  // A scroll of ours with no step, such as the one that brings the ring's row
  // into view, goes where the engine resolved it.
  seen.length = 0
  await $.ui.scroll({
    component: 'Pane',
    requestId: 'context-breakdown',
    offset: 9,
    by: 2,
    bodyRows: 12,
    contentRows: 30,
    origin: { kind: 'plugin', name: 'context-breakdown' },
  })
  expect(seen.map(one => one.offset)).toEqual([9])

  // Without the keys an arrow cannot reach the pane; a scroll then passes on.
  await ui.redraw({ ...PANE.props })
  seen.length = 0
  await personScroll($, 1)
  expect(seen.map(one => one.by)).toEqual([1])
  await ui.redraw({ ...FOCUSED_PANE.props })

  // Level 3: the arrows scroll the text, as before.
  await ui.press({ key: 'row-tool-results' })
  await personScroll($, 1)
  await settle()
  expect(await litRow(ui)).toBe('item-r:big')
  seen.length = 0
  await ui.press({ key: 'item-r:big' })
  seen.length = 0
  await personScroll($, 1)
  expect(seen.map(one => one.by)).toEqual([1])
  await ui.unmount()
})

/** The person moves the ring onto `element` of this mod: Tab, a click, the engine's own arrow walk. */
function ringOn($: Engine, element: string) {
  return $.ui.focus({ component: 'Pane', requestId: 'context-breakdown', plugin: 'context-breakdown', element, origin: { kind: 'person' } })
}

test('an arrow at the first or the last row scrolls the window: the ring cannot move that way', async ($, on) => {
  const { seen } = await scrollWorld($, on, manyResults(45))
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  const rows = await rowsOf(ui)
  seen.length = 0

  // The ring on the last row: down goes to the engine, which scrolls the
  // lines under the rows into view; the ring stays.
  await ringOn($, rows.at(-1)!)
  await personScroll($, 1)
  await settle()
  expect(seen.map(one => one.by)).toEqual([1])
  expect(await litRow(ui)).toBe(rows.at(-1))
  // Up from there moves the ring, and the window stays.
  await personScroll($, -1)
  await settle()
  expect(seen.map(one => one.by)).toEqual([1])
  expect(await litRow(ui)).toBe(rows.at(-2))

  // The first row: up goes to the engine, for the heading above the rows.
  await ringOn($, rows[0]!)
  await personScroll($, -1)
  await settle()
  expect(seen.map(one => one.by)).toEqual([1, -1])
  expect(await litRow(ui)).toBe(rows[0])

  // Level 2 with a next page: down on the last row opens it, so the arrow moves the ring.
  await ui.press({ key: 'row-tool-results' })
  const page1 = await rowsOf(ui)
  await ringOn($, page1.at(-1)!)
  seen.length = 0
  await personScroll($, 1)
  await settle()
  expect(seen).toEqual([])
  expect(await ui.find({ type: 'Text', text: /page 2 of 3$/ })).toBeDefined()
  await ui.unmount()
})

test('j on the last row and k on the first move the window one row; so does j in a list with no row that opens', async ($, on) => {
  // Under each press the engine raises the scroll a step asks for, the window
  // standing at row 5: a step token moves it to 6 (j) or 4 (k); with no step
  // under way the mod's hook passes it on untouched (0).
  const { seen } = await scrollWorld($, on, CHAT, () => 5)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  const rows = await rowsOf(ui)
  const offsets = async (key: string) => {
    seen.length = 0
    await ui.press({ key })
    await settle()

    return seen.map(one => one.offset)
  }

  // The ring on the last row: j has no row to go to, so the window goes down
  // one row, as an arrow there does, and the ring stays.
  await ringOn($, rows.at(-1)!)
  expect(await offsets('list-down')).toEqual([6])
  expect(await litRow(ui)).toBe(rows.at(-1))
  // k from there moves the ring, and the window stays.
  expect(await offsets('list-up')).toEqual([0])
  expect(await litRow(ui)).toBe(rows.at(-2))

  // The first row: k moves the window up one row.
  await ringOn($, rows[0]!)
  expect(await offsets('list-up')).toEqual([4])
  expect(await litRow(ui)).toBe(rows[0])

  // A list with no row that opens has no ring to move: j and k move the window.
  let found = false
  for (const row of rows) {
    await ui.press({ key: row })
    if ((await rowsOf(ui)).length === 0 && (await ui.find({ key: 'list-down' })) !== undefined) {
      found = true
      expect(await offsets('list-down'), row).toEqual([6])
      expect(await offsets('list-up'), row).toEqual([4])
    }
    await ui.press({ key: 'back' })
  }
  expect(found).toBe(true)
  await ui.unmount()
})

test('after a reload the ring state still names a row: an arrow steps from that row, not from the first', async ($, on) => {
  // A reload empties the mod's record of the ring, and the state keeps the
  // row. Here the second session start's write of no ring lands as that row,
  // before the mod has moved the ring at all.
  let kept: string | null = null
  on('state.set', async (_, e, next) => {
    const change = e as unknown as { key?: string; value?: { value?: unknown } }
    if (kept !== null && change.key === 'ring' && change.value?.value === null) {
      return next({ ...e, value: { ...change.value, value: kept } } as typeof e)
    }

    return next(e)
  })
  const { seen } = await scrollWorld($, on)
  let ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  const rows = await rowsOf(ui)
  await ui.unmount()
  kept = rows[4]!
  await $.session.start(START)
  ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  kept = null
  expect(await litRow(ui)).toBe(rows[4])

  // Up: the mod answers the scroll, so the window stays, and the ring goes to row 4.
  seen.length = 0
  await personScroll($, -1)
  await settle()
  expect(seen).toEqual([])
  expect(await litRow(ui)).toBe(rows[3])
  await ui.unmount()
})

test('after a click on Down or Up, j and k step on from the row the ring was on', async ($, on) => {
  await scrollWorld($, on)
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  const rows = await rowsOf(ui)
  await ui.press({ key: 'list-down' })
  await ui.press({ key: 'list-down' })
  expect(await litRow(ui)).toBe(rows[2])

  // The click puts the ring on the control, then presses it.
  await ringOn($, 'list-down')
  await ui.press({ key: 'list-down' })
  expect(await litRow(ui)).toBe(rows[3])
  await ringOn($, 'list-down')
  await ui.press({ key: 'list-down' })
  expect(await litRow(ui)).toBe(rows[4])
  await ringOn($, 'list-up')
  await ui.press({ key: 'list-up' })
  expect(await litRow(ui)).toBe(rows[3])
  await ui.unmount()
})

test('off the terminal the mod keeps no record of the ring: a focus move there writes nothing', async ($, on) => {
  // Every write of the ring key, as the mod makes it.
  const ringWrites: unknown[] = []
  on('state.set', async (_, e, next) => {
    const change = e as unknown as { key?: string; value?: { value?: unknown } }
    if (change.key === 'ring') {
      ringWrites.push(change.value?.value)
    }

    return next(e)
  })
  await scrollWorld($, on)
  for (const props of [FOCUSED_PANE.props, PANE.props]) {
    const desktop = await $.ui.mount({ ...PANE, surface: 'desktop', props })
    const rows = await rowsOf(desktop)
    ringWrites.length = 0
    // The desktop reports a click on a row, and the mod's own focus calls, as
    // the person's moves; it reports no Tab at all. So it notes none of them.
    await ringOn($, rows[3]!)
    await ringOff($)
    await settle()
    expect(ringWrites).toEqual([])
    await desktop.unmount()
  }
  // The desktop draws no lit row, so the terminal shows where the mod has
  // the ring: where the tree asks for it, the first row. j steps from there,
  // so the mod's record did not move either.
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  const rows = await rowsOf(ui)
  expect(await litRow(ui)).toBe(rows[0])
  await ui.press({ key: 'list-down' })
  expect(await litRow(ui)).toBe(rows[1])
  await ui.unmount()
})

test('an arrow at once after Enter opens an item goes to the engine: level 3 scrolls', async ($, on) => {
  // The arrow comes while the press writes level 3, before the pane draws it.
  let armed = false
  on('state.set', async (_, e, next) => {
    const change = e as unknown as { key?: string; value?: { value?: { level?: number } } }
    if (armed && change.key === 'view' && change.value?.value?.level === 3) {
      armed = false
      await personScroll($, 1)
    }

    return next(e)
  })
  const { seen } = await scrollWorld($, on, manyResults(45))
  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  await ui.press({ key: 'row-tool-results' })
  const item = (await rowsOf(ui))[0]!
  seen.length = 0
  armed = true
  await ui.press({ key: item })
  await settle()
  expect(seen.map(one => one.by)).toEqual([1])
  expect(await ui.find({ type: 'Code' })).toBeDefined()
  await ui.unmount()
})

test('f keeps the line the window shows: the other view opens on the page that holds it', async ($, on) => {
  // Raw page 2 is lines 501-1,000; formatted page 2 is 500-997, so only a
  // window near the bottom of raw page 2 shows a line of formatted page 3.
  let at: Window = { standing: 0, contentRows: 560, bodyRows: 60 }
  const { seen } = await scrollWorld($, on, BIG, () => at)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:big' })
    await ui.press({ key: 'next' })
    expect(await shownLines(ui)).toBe('501-1,000')

    // The window at the bottom of raw page 2 shows line 1,000.
    at = { standing: 500, contentRows: 560, bodyRows: 60 }
    seen.length = 0
    await ui.press({ key: 'format' })
    if (surface !== 'terminal') {
      // Off the terminal f reads no window: the engine there clamps the
      // mod's own offsets. The scroll raised for the press is not moved, and
      // the other view opens on the page that holds the first line of the
      // page shown before, at its top.
      expect(seen.map(one => one.offset)).toEqual([0])
      expect(await shownLines(ui)).toBe('500-997')
      // Back to raw: line 500 is on raw page 1.
      await ui.press({ key: 'format' })
      expect(await shownLines(ui)).toBe('1-500')
      await ui.press({ key: 'back' })
      await ui.press({ key: 'back' })
      await ui.unmount()
      continue
    }
    // The scroll that read the window left it where it stood.
    expect(seen.map(one => one.offset)).toEqual([500])
    expect(await shownLines(ui)).toBe('998-1,200')
    // Back to raw from the top of that page: line 998, on raw page 2.
    at = { standing: 0, contentRows: 260, bodyRows: 60 }
    await ui.press({ key: 'format' })
    expect(await shownLines(ui)).toBe('501-1,000')
    // From the top of raw page 2, as before: formatted page 2.
    await ui.press({ key: 'format' })
    expect(await shownLines(ui)).toBe('500-997')
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})
