import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { keysHint } from '../hooks/pane'
import { CHAT, FOCUSED_PANE, NOTES, PANE, SURFACES, isOff, manyResults, richUsage, world } from './fixtures'

// The kit does not carry a plugin's own `$.ui.scroll` (it rejects the call
// before any hook), so these tests raise the `ui.scroll` the engine would
// raise for it, origin this plugin, and read what the mod's hook passes on.

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

test('j and k are hotkeys at every level while the pane has the keyboard, and gone without it', async ($, on) => {
  await scrollWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    // Levels 1 and 2 key them apart from level 3, so no tree of one level
    // holds the key of level 3's first control (scroll.ts).
    const check = async (down: string, up: string) => {
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

    // Without the keyboard: the hint as before, and no j or k at all.
    await ui.redraw({ ...PANE.props })
    expect(await ui.find({ type: 'Text', text: keysHint(surface) })).toBeDefined()
    expect(await ui.find({ key: 'scroll-down' })).toBeUndefined()
    expect(await ui.find({ key: 'scroll-up' })).toBeUndefined()
    await ui.redraw({ ...FOCUSED_PANE.props })
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a press moves the window one row from where it stands, within the tree', async ($, on) => {
  let standing = 0
  const { seen } = await scrollWorld($, on, BIG, () => standing)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:big' })
    seen.length = 0

    standing = 5
    await ui.press({ key: 'scroll-down' })
    standing = 5
    await ui.press({ key: 'scroll-up' })
    // k at the top, j at the bottom (60 rows, 20 showing: the last offset is 40).
    standing = 0
    await ui.press({ key: 'scroll-up' })
    standing = 40
    await ui.press({ key: 'scroll-down' })
    expect(seen.map(one => one.offset)).toEqual([6, 4, 0, 40])
    expect(seen.every(one => one.origin.kind === 'plugin')).toBe(true)

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
    // In the kit the press's own call is refused: the press settles quietly.
    await ui.press({ key: 'scroll-down' })
    await ui.press({ key: 'scroll-down' })
    await ui.press({ key: 'next' })
    expect((await ui.find({ type: 'Code' }))?.props.startLine).toBe(501)
    expect((await ui.find({ key: 'scroll-down' }))?.props.hotkey).toBe('j')
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

  for (const surface of SURFACES) {
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

  for (const surface of SURFACES) {
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

  for (const surface of SURFACES) {
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

test('levels 1 and 2 taller than a small pane: j and k step there, and never change the list page', async ($, on) => {
  // A small inline pane: 12 rows for a list of 20 rows and its lines.
  let at: Window = { standing: 3, contentRows: 30, bodyRows: 12 }
  const { seen } = await scrollWorld($, on, manyResults(45), () => at)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface, props: { ...FOCUSED_PANE.props, scroll: { offset: 3, bodyRows: 12 } } })
    seen.length = 0
    at = { standing: 3, contentRows: 30, bodyRows: 12 }
    await ui.press({ key: 'list-down' })
    expect(seen.map(one => one.offset)).toEqual([4])

    await ui.press({ key: 'row-tool-results' })
    const first = (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').find(key => key.startsWith('item-'))
    seen.length = 0
    at = { standing: 18, contentRows: 30, bodyRows: 12 }
    await ui.press({ key: 'list-down' })
    at = { standing: 0, contentRows: 30, bodyRows: 12 }
    await ui.press({ key: 'list-up' })
    expect(seen.map(one => one.offset)).toEqual([18, 0])
    // Still page 1 of the list: n and p page it, j and k do not.
    expect(await ui.find({ type: 'Text', text: /page 1 of 3$/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').find(key => key.startsWith('item-'))).toBe(first)
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
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
