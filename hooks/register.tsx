// Wiring only: which events ask for a measurement, where it is drawn, and
// what each press of the pane does. The logic lives in the .ts files beside
// this one. Each hook spells `$` at its call sites (the engine refuses `$`
// passed around), so the calls a measurement or a move needs are handed over
// as closures.

import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, RenderSurface, UiPressArgument, UiPressResult } from 'claude-code'

import type { ContextBreakdownSegmentId, ContextBreakdownSnapshot, ContextBreakdownView } from '../types'
import { BAR_CLIENT, bandTree, glanceTree, pictureFigures } from './band'
import type { OpenPane } from './band'
import type { BarClientPost } from './barclient'
import { createChipHold } from './focus'
import {
  LEVEL_1,
  afterClear,
  back,
  contentPage,
  listPage,
  mention,
  noMatchNote,
  notice,
  openItem,
  openSegment,
  rebuildView,
  refreshItem,
  toLevel1,
  toLevel1With,
  toggleFormat,
  toggleSort,
  toggleSource,
} from './navigate'
import type { NavIo } from './navigate'
import { lineMove } from './lines'
import { contentHeadRows, paneTree, ringKey } from './pane'
import { paletteFor } from './palette'
import { createRefresher } from './refresh'
import { arrowStep, createRingMoves, notesRing, pagesOf, ringTarget, rowKeys } from './ring'
import {
  END_SCROLL,
  STEP_SCROLL,
  TOP_SCROLL,
  atNewTop,
  createLane,
  createPaneScroll,
  createSteps,
  crossDelta,
  crossScroll,
  heldOffset,
  learnLink,
  needsRetry,
  shareAcross,
  stepAnswer,
  stepOf,
} from './scroll'
import type { StepToken } from './scroll'
import { matchSegment } from './segments'
import { PANE_ID, PANE_TITLE, PLUGIN } from './state'
import { trace } from './trace'
import { bandModelFor } from './view'
import type { LayoutPart, SegmentPart } from './layout'

// The engine reads which state a hook touches from this file, so the atoms
// are written here. A tag declines a value an earlier version stored (it
// outlives a reload); change it whenever the value's fields change.
const snapshotAtom = atom({ plugin: 'context-breakdown', key: 'snapshot' } as const, null, {
  shape: 'snapshot-2',
})
const viewAtom = atom({ plugin: 'context-breakdown', key: 'view' } as const, LEVEL_1, {
  shape: 'view-5',
})
const themeAtom = atom({ plugin: 'context-breakdown', key: 'theme' } as const, null, {
  shape: 'theme-1',
})
const focusAtom = atom({ plugin: 'context-breakdown', key: 'focus' } as const, null, {
  shape: 'focus-2',
})
/** The key noted while the pane's ring is on no element of ours: no row is lit. */
const OFF_ROWS = ''
// The key of the pane's element under the focus ring (see `ring` in types).
const ringAtom = atom({ plugin: 'context-breakdown', key: 'ring' } as const, null, {
  shape: 'ring-1',
})

/**
 * This load of the code. State outlives a reload; a focus written by an
 * earlier load names a ring that load drew, so the band ignores it.
 */
const LOAD = Math.random().toString(36).slice(2)

/**
 * Whether this load may have written a focus since it last cleared one: a
 * hint that lets the prompt hook below skip all work. It is never drawn from,
 * so a reload that resets it loses nothing.
 */
let mayHoldFocus = false

/** The timer that ends the keyboard chip a few seconds after the last focus move. */
const chipHold = createChipHold()

/** The j and k presses whose scroll is under way; empty between presses. */
const steps = createSteps()
/** j and k presses, one at a time: one running, one waiting. */
const lane = createLane(2)
/**
 * Whether the `ui.scroll` hook sees our own scrolls, and the window's offset
 * the render hook last read (scroll.ts, `PaneScroll`). Hints for this load
 * only: a reload resets them. A new level or item keeps the link, so a link
 * proven to work stays proven.
 */
const win = createPaneScroll()
/**
 * `/ctx` only gave an open pane the keyboard: its trees take no ring until
 * the next move, so the window stays where the person left it (`paneTree`).
 * A reload that resets it only gives the ring back to the first control.
 */
let keepsPlace = false
/** j, k and the arrows at levels 1 and 2: the mod's record of the ring, and its presses (ring.ts). */
const ring = createRingMoves()
/**
 * What an arrow's `ui.scroll` and a press of j or k are read against, with no
 * wait: whether the pane held the keys when the render hook last drew it; the
 * view, which every write of it also sets, so a new level counts at once; the
 * snapshot the render hook last drew from; and the ring key last noted in
 * `ringAtom`. Hints only.
 */
let paneFocused = false
let shownView: ContextBreakdownView = LEVEL_1
let shownSnapshot: ContextBreakdownSnapshot | null = null
let shownNoted: string | null = null
/**
 * The pane's columns and the rows its body may show, as the render hook last
 * read them (null before it read any): how many lines k shows when it enters
 * the previous page from its end, off the terminal. Hints only.
 */
let shownColumns = 0
/** The surface the pane was last drawn on. */
let shownSurface: string = 'terminal'
/**
 * The keys this mod asked the ring onto and has not yet seen echoed. A
 * desktop reports every focus move as the person's, this mod's own too: such
 * an echo of an older target must not put the record back (ring.ts).
 */
const ringAsked: string[] = []
let shownBodyRows: number | null = null
/**
 * The presses at level 3 off the terminal that change what the text shows
 * (j, k, f, v, n, p, the Next page below the text, and r), one after the
 * other in the order pressed and never dropped: each starts from where the
 * last one left the view, and a press that crosses to another page finishes
 * before the next counts.
 */
const lineLane = createLane(Number.POSITIVE_INFINITY)
/** The presses in `lineLane` that have not finished: 0 while it is idle. */
let lineHeld = 0

/** Queues `work` in `lineLane`, counted in `lineHeld`. */
function inLineLane<T>(work: () => Promise<T>): Promise<{ value: T } | null> {
  lineHeld += 1

  return lineLane.run(work).finally(() => {
    lineHeld -= 1
  })
}

/**
 * Writes the view, and notes it for the hooks that cannot wait for a read.
 * Noted as the change is made, before the write lands: an arrow raised
 * meanwhile already counts the new level.
 */
function writeView($: Engine, change: (view: ContextBreakdownView) => ContextBreakdownView): Promise<ContextBreakdownView> {
  return update($, viewAtom, view => {
    const next = change(view)
    shownView = next

    return next
  })
}

/** Writes the ring key, and notes it as `writeView` does the view. */
function writeRing($: Engine, change: (key: string | null) => string | null): Promise<string | null> {
  return update($, ringAtom, key => {
    const next = change(key)
    shownNoted = next

    return next
  })
}

/**
 * The key a step of the ring starts from: the mod's record (the last row
 * while the ring is on Down or Up), else the key last noted, else the row
 * the tree asks the ring for, as the pane lights it.
 */
function stepStart(view: ContextBreakdownView, snapshot: ContextBreakdownSnapshot | null, noted: string | null): string | null {
  const known = ring.from()
  if (known !== undefined) {
    return known
  }

  return noted ?? (keepsPlace ? null : ringKey(view, snapshot, true))
}

function themeName(rows: readonly { key: string; value: unknown }[]): string | null {
  const value = rows.find(row => row.key === 'theme')?.value

  return typeof value === 'string' ? value : null
}

/** Events of a subagent's loop carry its id; this mod shows the main session. */
function isSubagent(e: object): boolean {
  return (e as { agentId?: unknown }).agentId !== undefined
}

/** Our own failure in a press or a command never reaches the session. */
function quietly(work: Promise<unknown>): Promise<unknown> {
  return work.catch(() => undefined)
}

/** The engine calls a click on the band makes, bound to one hook's `$`. */
type BandActs = {
  dropFocus: () => Promise<unknown>
  dropRing: () => Promise<unknown>
  toLevel1: () => Promise<unknown>
  open: () => Promise<unknown>
  toTop: () => Promise<unknown>
}

function bandActs($: Engine): BandActs {
  return {
    dropFocus: () => update($, focusAtom, () => null),
    dropRing: () => {
      ring.forget()

      return writeRing($, () => null)
    },
    toLevel1: () => writeView($, toLevel1),
    open: () => $.ui.open({ id: PANE_ID, title: PANE_TITLE }),
    toTop: () => $.ui.scroll(TOP_SCROLL),
  }
}

/** The engine calls a move between levels or pages makes, bound to one hook's `$`. */
function navOf($: Engine): NavIo {
  return {
    usage: () => $.session.usage({ breakdown: 'summary' }),
    messages: () => $.session.messages({ as: 'api' }),
    snapshot: () => read($, snapshotAtom),
    view: () => read($, viewAtom),
    write: fn => writeView($, fn),
    readFile: path => $.fs.read(path),
  }
}

/**
 * Puts the ring on `key`, then brings its row into view. `nearest` leaves a
 * row that already shows where it is; the `ui.scroll` hook below passes this
 * scroll on as the engine resolved it, as it carries no step.
 */
async function applyRing($: Engine, key: string): Promise<{ deny?: string }> {
  ringAsked.push(key)
  if (ringAsked.length > 32) {
    ringAsked.shift()
  }
  const answer = await $.ui.focus({ requestId: PANE_ID, key })
  trace($, { at: 'ring', key, answer })
  // A desktop brings the focused control into view itself, and refuses a
  // scroll to a key (seen live: "no element of its own is drawn under that key").
  if (answer.deny === undefined && shownSurface === 'terminal') {
    await $.ui.scroll({ in: PANE_ID, to: { key }, block: 'nearest' })
  }

  return answer
}

/**
 * One step of the ring at levels 1 and 2, for j, k or an arrow, from the key
 * `stepStart` gives. Past the end of a page it opens the next or the
 * previous page, with the ring on its first or last row. The focus call is
 * not waited for: the next press steps on. If the engine refuses it, the
 * record and the ring key go back to what they were before the move.
 */
async function moveRing($: Engine, step: number): Promise<void> {
  await ring.serial(async () => {
    const view = await read($, viewAtom)
    if (view.level === 3) {
      return
    }
    const snapshot = await read($, snapshotAtom)
    const current = stepStart(view, snapshot, await read($, ringAtom))
    const move = ringTarget(rowKeys(view, snapshot), current, step, pagesOf(view))
    if (move === null) {
      return
    }
    const before = ring.mark()
    let key: string | undefined
    if ('page' in move) {
      // A new page, as the render hook's moves open one: no step to continue from.
      keepsPlace = false
      steps.forget()
      await listPage(navOf($), move.page, move.page > 0 ? 'first' : 'last')
      const keys = rowKeys(await read($, viewAtom), snapshot)
      key = move.page > 0 ? keys[0] : keys[keys.length - 1]
      if (move.page > 0) {
        // The engine keeps the window across a new tree: the next page from its top.
        atNewTop(win, steps)
        await quietly($.ui.scroll(TOP_SCROLL))
      }
    } else {
      key = move.key
    }
    if (key === undefined) {
      return
    }
    const target = key
    ring.set(target)
    // Lit at once on the terminal, before the engine answers: a held key
    // shows where it is. Not on a desktop: the write redraws the pane with
    // the ring asked onto the new row, the focus call moves it again and the
    // desktop's report of the move redraws once more: the outline flickers.
    // There the report alone writes the key, as for a Tab.
    let noted = shownSurface === 'terminal' ? null : await read($, ringAtom)
    if (shownSurface === 'terminal') {
      await quietly(
        writeRing($, now => {
          noted = now

          return target
        }),
      )
    }
    void ring.focus(
      target,
      async next => {
        // Off the terminal the key is written once the focus call is over,
        // unless a later move took the record: where the desktop's report
        // already wrote it, this write changes nothing and draws nothing.
        const note = async () => {
          if (shownSurface !== 'terminal' && ring.local() === next) {
            await quietly(writeRing($, () => next))
          }
        }
        try {
          const answer = await applyRing($, next)
          if (answer.deny === undefined) {
            await note()
          }

          return answer
        } catch (error) {
          await note()
          throw error
        }
      },
      async () => {
        ring.restore(before)
        await quietly(writeRing($, now => (now === target ? noted : now)))
      },
    )
  })
}

/**
 * j (1) or k (-1) at level 3 off the terminal: the text starts one unit
 * later or earlier (lines.ts), one write of the view and no scroll. At a
 * page's edge it opens the next page at its top, or the previous one at its
 * end with about one window of text showing.
 */
async function stepLines($: Engine, step: number, surface: RenderSurface): Promise<void> {
  const view = await read($, viewAtom)
  if (view.level !== 3) {
    return
  }
  const move = lineMove(view.item, step)
  if (move === null) {
    return
  }
  // The move is worked out again on the view as the write finds it, and
  // whatever move applies there is made: a step, or a page crossing (a
  // press never does nothing while a move exists). `update` may run the
  // change more than once; the last run counts.
  const found: { cross: 1 | -1 | null } = { cross: 'page' in move ? move.page : null }
  if ('top' in move) {
    await writeView($, current => {
      found.cross = null
      if (current.level !== 3) {
        return current
      }
      const again = lineMove(current.item, step)
      if (again === null) {
        return current
      }
      if ('page' in again) {
        found.cross = again.page

        return current
      }

      return { ...current, item: { ...current.item, top: again.top } }
    })
  }
  const { cross } = found
  if (cross === null) {
    return
  }
  const rows =
    shownBodyRows === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, shownBodyRows - contentHeadRows(view, shownColumns, paneFocused, surface))
  await contentPage(navOf($), cross, false, cross > 0 ? 0 : { endRows: rows })
}

/**
 * A new page, level or item from `work`, at its top: no step to continue
 * from, the ring where the new tree puts it, and the window at the top.
 */
function thenTopOf($: Engine, work: () => Promise<unknown>): Promise<unknown> {
  return quietly(
    (async () => {
      keepsPlace = false
      // A new level or item: no step to continue from. The link stays as
      // it is: a step at the top of the new tree proves nothing.
      steps.forget()
      // The new tree's ring is where `ringKey` puts it until an event says otherwise.
      ring.forget()
      await quietly(writeRing($, () => null))
      await work()
      atNewTop(win, steps)
      await quietly($.ui.scroll(TOP_SCROLL))
      const key = ringKey(await read($, viewAtom), await read($, snapshotAtom), true)
      if (key !== null) {
        await $.ui.focus({ requestId: PANE_ID, key })
      }
    })(),
  )
}

/**
 * f at level 3 off the terminal: the other view, with the line the window
 * shows first (lines.ts, `topAtLine`), and the window at its top. That line
 * counts from the line shown first after j and k, and from where the window
 * stands when a scroll of the person's moved it and `measure` (pushed as the
 * press came, as the terminal's f does) reads it.
 */
async function formatLines($: Engine, measure: StepToken | null): Promise<void> {
  let share = 0
  if (measure !== null) {
    try {
      let answer: { deny?: string } | null = null
      try {
        answer = await $.ui.scroll(STEP_SCROLL)
      } catch {
        answer = null
      }
      win.link = learnLink(win.link, measure, answer, win.shown)
      share = measure.seen ? measure.share : 0
    } finally {
      steps.drop(measure)
    }
  }
  await toggleFormat(navOf($), share, true)
  await quietly($.ui.scroll(TOP_SCROLL))
}

/**
 * n, p, the Next page below the text, v or r at level 3 off the terminal,
 * on the view as the queue reaches it: a press that does not apply there
 * does nothing. v keeps the line shown first when the other text has it.
 */
async function itemPress($: Engine, element: string, refresh: () => Promise<unknown>): Promise<void> {
  if (element === 'refresh') {
    await refresh()

    return
  }
  const view = await read($, viewAtom)
  if (view.level !== 3) {
    return
  }
  const nav = navOf($)
  if (element === 'view') {
    if (view.item.canToggle) {
      await thenTopOf($, () => toggleSource(nav, true))
    }

    return
  }
  const delta = element === 'prev' ? -1 : 1
  const page = view.item.page + delta
  if (page >= 0 && page < view.item.pages) {
    await thenTopOf($, () => contentPage(nav, delta))
  }
}

/** What a `ui.press` hook calls to run the hooks beneath and the onPress. */
type PressNext = (e: UiPressArgument) => Promise<UiPressResult>

/**
 * j and k at level 3, for the press hook of level 3 (`register`). That hook,
 * not the Button's onPress, asks for the scroll: the engine shows this mod's `ui.scroll` hook a scroll a
 * registered hook asked for, never one from onPress (see scroll.ts). One
 * press at a time, so each steps from the row the last one left. At a
 * page's edge the press opens the next page at its top, or the previous
 * page at its bottom.
 *
 * Off the terminal no scroll at all: the engine there clamps a plugin's
 * scroll to a height it recorded when the pane opened, so after a long item
 * opens every step would be cut back to row 0. j and k move where the text
 * starts instead (lines.ts), in order, every press counted; the person's
 * wheel and arrows still scroll the window.
 */
async function scrollPress($: Engine, e: UiPressArgument, next: PressNext): Promise<UiPressResult> {
  const step = stepOf(e.element)
  if (e.surface !== 'terminal') {
    // Queued before `next`, so the presses keep the order they came in.
    const moved = inLineLane(() => stepLines($, step, e.surface))
    const result = await next(e)
    await quietly(moved)

    return result
  }
  const ran = await lane.run(async () => {
    const token = steps.push(step)
    let retry: typeof token | null = null
    try {
      const result = await next(e)
      // Without the hook a step to `start` would jump to the top: no scroll.
      if (win.link === 'absent') {
        return result
      }
      let answer: { deny?: string } | null = null
      try {
        answer = await $.ui.scroll(STEP_SCROLL)
      } catch {
        // No pane to scroll, or no surface: the press does nothing.
      }
      win.link = learnLink(win.link, token, answer, win.shown)
      trace($, { at: 'learnLink', link: win.link, seen: token.seen, answer, shown: win.shown })
      // The engine believed the window already stood at `start` and raised
      // no event: ask once more, for `end`, which it must move to.
      if (needsRetry(token, answer, win.link)) {
        retry = steps.push(step)
        let again: { deny?: string } | null = null
        try {
          again = await $.ui.scroll(END_SCROLL)
        } catch {
          again = null
        }
        win.link = learnLink(win.link, retry, again, win.shown)
        trace($, { at: 'retry', link: win.link, seen: retry.seen, answer: again, shown: win.shown })
      }
      // Only the hook sets `cross`, from the window's own numbers.
      const cross = retry?.seen === true ? retry.cross : token.cross
      if (cross !== null) {
        await quietly(
          (async () => {
            const view = await read($, viewAtom)
            const delta = view.level === 3 ? crossDelta(cross, view.item.page, view.item.pages) : 0
            if (delta === 0) {
              return
            }
            const nav: NavIo = {
              usage: () => $.session.usage({ breakdown: 'summary' }),
              messages: () => $.session.messages({ as: 'api' }),
              snapshot: () => read($, snapshotAtom),
              view: () => read($, viewAtom),
              write: fn => writeView($, fn),
              readFile: path => $.fs.read(path),
            }
            await contentPage(nav, delta, delta < 0)
            if (delta > 0) {
              atNewTop(win, steps)
            } else {
              steps.forget()
            }
            // The next page from its top; the previous one from its bottom,
            // so k keeps going up line by line. The ring goes where the
            // window goes (the first control, or the one under the text),
            // as the engine brings the ring into view on a new tree.
            await quietly($.ui.scroll(crossScroll(delta)))
            const key = ringKey(await read($, viewAtom), null, true)
            if (key !== null) {
              await $.ui.focus({ requestId: PANE_ID, key })
            }
          })(),
        )
      }

      return result
    } finally {
      steps.drop(token)
      if (retry !== null) {
        steps.drop(retry)
      }
    }
  })

  // A press dropped while two are under way only passes on.
  return ran === null ? next(e) : ran.value
}

/**
 * f switches the view, for the press hook of level 3, as j and k, so this mod's `ui.scroll`
 * hook sees its scrolls: one reads where the window stands, and after the
 * switch one puts the window at the same line of the other view. Without
 * the hook (or when that is not known) the other view opens at its top.
 */
async function formatPress($: Engine, e: UiPressArgument, next: PressNext): Promise<UiPressResult> {
  if (e.surface !== 'terminal') {
    // In the one queue of level 3's presses, before `next`, as j and k.
    // The switch waits for the press to pass, as the terminal's does. The
    // read of the window is pushed now only while the queue is idle: a
    // scroll of an earlier press (a new page goes to its top) would take it.
    const canMeasure = win.link !== 'absent'
    const early = canMeasure && lineHeld === 0 ? steps.push(0, 'measure') : null
    let passed = () => undefined as void
    const pressed = new Promise<void>(resolve => {
      passed = resolve
    })
    const switched = inLineLane(async () => {
      await pressed
      await formatLines($, early ?? (canMeasure && win.link !== 'absent' ? steps.push(0, 'measure') : null))
    })
    try {
      return await next(e)
    } finally {
      passed()
      await quietly(switched)
    }
  }
  const nav: NavIo = {
    usage: () => $.session.usage({ breakdown: 'summary' }),
    messages: () => $.session.messages({ as: 'api' }),
    snapshot: () => read($, snapshotAtom),
    view: () => read($, viewAtom),
    write: fn => writeView($, fn),
    readFile: path => $.fs.read(path),
  }
  const ran = await lane.run(async () => {
    const measure = win.link === 'absent' ? null : steps.push(0, 'measure')
    try {
      const result = await next(e)
      await quietly(
        (async () => {
          let share: number | null = null
          if (measure !== null) {
            let answer: { deny?: string } | null = null
            try {
              answer = await $.ui.scroll(STEP_SCROLL)
            } catch {
              answer = null
            }
            win.link = learnLink(win.link, measure, answer, win.shown)
            share = measure.seen ? measure.share : null
            steps.drop(measure)
          }
          const before = await read($, viewAtom)
          await toggleFormat(nav, share ?? 0)
          const after = await read($, viewAtom)
          const target =
            share !== null && before.level === 3 && after.level === 3 ? shareAcross(before.item, share, after.item) : null
          if (target === null) {
            await $.ui.scroll(TOP_SCROLL)

            return
          }
          // The new tree may not be drawn yet: the hook then places by the
          // old tree's rows, and the engine keeps that row (clamped).
          const place = steps.push(0, 'place', target)
          try {
            await $.ui.scroll(STEP_SCROLL)
          } finally {
            steps.drop(place)
          }
        })(),
      )

      return result
    } finally {
      if (measure !== null) {
        steps.drop(measure)
      }
    }
  })
  if (ran !== null) {
    return ran.value
  }
  // Two j or k presses under way: switch only, and the window keeps its row.
  const result = await next(e)
  await quietly(toggleFormat(nav))

  return result
}

export const register: Register = on => {
  const refresher = createRefresher()

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'ctx',
        description: 'Show what fills the context window',
        argumentHint: '[segment]',
        immediate: true,
      })
    } catch {
      // The bar still works without the command.
    }
    // A new session holds no focus ring of ours.
    mayHoldFocus = false
    chipHold.stop()
    void quietly(update($, focusAtom, () => null))
    void quietly(writeRing($, () => null))
    // The theme picks the palette. Read in the background: the session
    // does not wait for the settings list.
    void quietly(
      (async () => {
        const theme = themeName(await $.config.list())
        await update($, themeAtom, () => theme)
      })(),
    )
    refresher.soon({
      after: (ms, fn) => $.clock.after(ms, fn),
      now: () => $.clock.now(),
      usage: () => $.session.usage({ breakdown: 'summary' }),
      messages: () => $.session.messages({ as: 'api' }),
      write: fn => update($, snapshotAtom, fn),
      rebuild: async data => {
        // Level 1 holds no items: no write, so no redraw.
        if ((await read($, viewAtom)).level !== 1) {
          await writeView($, view => rebuildView(view, data))
        }
      },
    })

    return next(e)
  })

  // `/ctx` opens the segments; `/ctx <segment>` opens that segment's items.
  // `/ctx` alone on an open pane only gives it the keyboard: it is the one
  // key path to a pane that lost it (ctrl+x tab reaches the bar only). Its
  // trees then name no ring of their own (`keepsPlace`), and the hook puts
  // the window back where it stood (below).
  on('command.run', { command: 'ctx' }, async ($, e) => {
    const nav: NavIo = {
      usage: () => $.session.usage({ breakdown: 'summary' }),
      messages: () => $.session.messages({ as: 'api' }),
      snapshot: () => read($, snapshotAtom),
      view: () => read($, viewAtom),
      write: fn => writeView($, fn),
      readFile: path => $.fs.read(path),
    }
    const segment = matchSegment(e.args)
    const hasWord = e.args.trim() !== ''
    let isOpen = false
    if (!hasWord) {
      try {
        isOpen = (await $.ui.panes()).some(pane => pane.id === PANE_ID)
      } catch {
        isOpen = false
      }
    }
    keepsPlace = !hasWord && isOpen
    if (!keepsPlace) {
      // Another tree: the ring that was noted names an element of the old one.
      ring.forget()
      await quietly(writeRing($, () => null))
    }
    if (segment !== null) {
      await quietly(openSegment(nav, segment))
    } else if (hasWord) {
      await quietly(writeView($, toLevel1With(noMatchNote(e.args))))
    } else if (!isOpen) {
      await quietly(writeView($, toLevel1))
    }
    // A pane that takes the keyboard gets its ring back on a control, and the
    // engine brings that control into view (seen live: the window jumped to
    // the controls above the text). So read where the window stands first
    // (`measure`), and put it back after the open (`place`), as f does.
    const held: { share: number | null } = { share: null }
    if (keepsPlace && win.link !== 'absent') {
      await lane.run(async () => {
        const measure = steps.push(0, 'measure')
        try {
          let answer: { deny?: string } | null = null
          try {
            answer = await $.ui.scroll(STEP_SCROLL)
          } catch {
            answer = null
          }
          win.link = learnLink(win.link, measure, answer, win.shown)
          held.share = measure.seen ? measure.share : null
        } finally {
          steps.drop(measure)
        }
      })
    }
    try {
      // Focus so the keys work at once; no closeOnEscape: the pane stays.
      await $.ui.open({ id: PANE_ID, title: PANE_TITLE, focus: true })
      const { share } = held
      if (share !== null) {
        // The ring first, and wait for it: a window put back before the
        // engine has brought the ring into view is moved again.
        const key = ringKey(await read($, viewAtom), await read($, snapshotAtom), true)
        if (key !== null) {
          await quietly($.ui.focus({ requestId: PANE_ID, key }))
        }
        await lane.run(async () => {
          const place = steps.push(0, 'place', share)
          try {
            await $.ui.scroll(STEP_SCROLL)
          } finally {
            steps.drop(place)
          }
        })
      }
      // An open pane keeps its window: the new level starts at the top. Asked
      // from this hook, the scroll also tells whether the `ui.scroll` hook
      // sees ours, at no cost: the top is where it goes either way. A pane
      // that `/ctx` only gave the keyboard keeps its window: no scroll.
      if (!isOpen) {
        const probed = await lane.run(async () => {
          const token = steps.push(0, 'probe')
          try {
            let answer: { deny?: string } | null = null
            try {
              answer = await $.ui.scroll(TOP_SCROLL)
            } catch {
              answer = null
            }
            win.link = learnLink(win.link, token, answer, win.shown)
          } finally {
            steps.drop(token)
          }
        })
        if (probed === null) {
          await $.ui.scroll(TOP_SCROLL)
        }
      }
    } catch {
      // A refused open leaves nothing to draw into; a refused scroll, the old place.
    }
    refresher.soon({
      after: (ms, fn) => $.clock.after(ms, fn),
      now: () => $.clock.now(),
      usage: () => $.session.usage({ breakdown: 'summary' }),
      messages: () => $.session.messages({ as: 'api' }),
      write: fn => update($, snapshotAtom, fn),
      rebuild: async data => {
        if ((await read($, viewAtom)).level !== 1) {
          await writeView($, view => rebuildView(view, data))
        }
      },
    })

    return {}
  }).catch(() => ({}))

  on('session.measure', ($, e, next) => {
    if (e.changed.includes('context')) {
      refresher.soon({
        after: (ms, fn) => $.clock.after(ms, fn),
        now: () => $.clock.now(),
        usage: () => $.session.usage({ breakdown: 'summary' }),
        messages: () => $.session.messages({ as: 'api' }),
        write: fn => update($, snapshotAtom, fn),
        rebuild: async data => {
          if ((await read($, viewAtom)).level !== 1) {
            await writeView($, view => rebuildView(view, data))
          }
        },
      })
    }

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (!isSubagent(e)) {
      refresher.soon({
        after: (ms, fn) => $.clock.after(ms, fn),
        now: () => $.clock.now(),
        usage: () => $.session.usage({ breakdown: 'summary' }),
        messages: () => $.session.messages({ as: 'api' }),
        write: fn => update($, snapshotAtom, fn),
        rebuild: async data => {
          if ((await read($, viewAtom)).level !== 1) {
            await writeView($, view => rebuildView(view, data))
          }
        },
      })
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (!isSubagent(e)) {
      refresher.afterTool({
        after: (ms, fn) => $.clock.after(ms, fn),
        now: () => $.clock.now(),
        usage: () => $.session.usage({ breakdown: 'summary' }),
        messages: () => $.session.messages({ as: 'api' }),
        write: fn => update($, snapshotAtom, fn),
        rebuild: async data => {
          if ((await read($, viewAtom)).level !== 1) {
            await writeView($, view => rebuildView(view, data))
          }
        },
      })
    }

    return result
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (!isSubagent(e) && e.trigger !== 'precompute' && result.skip === undefined) {
      // The plain usage call is free; its token figure is the one that stays
      // stale until the next model response.
      let staleTokens: number | null = null
      try {
        staleTokens = (await $.session.usage()).context.tokens ?? null
      } catch {
        staleTokens = null
      }
      refresher.compacted(
        {
          after: (ms, fn) => $.clock.after(ms, fn),
          now: () => $.clock.now(),
          usage: () => $.session.usage({ breakdown: 'summary' }),
          messages: () => $.session.messages({ as: 'api' }),
          write: fn => update($, snapshotAtom, fn),
          rebuild: async data => {
            if ((await read($, viewAtom)).level !== 1) {
              await writeView($, view => rebuildView(view, data))
            }
          },
        },
        staleTokens,
      )
    }

    return result
  }).catch(($, e, next) => next(e))

  // A /clear fires no session.start, and the next measurement comes only after
  // the next turn: drop the old conversation's snapshot and items now, and
  // measure again.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear') {
      await quietly(writeView($, afterClear))
      mayHoldFocus = false
      chipHold.stop()
      await quietly(update($, focusAtom, () => null))
      await refresher.cleared({
        after: (ms, fn) => $.clock.after(ms, fn),
        now: () => $.clock.now(),
        usage: () => $.session.usage({ breakdown: 'summary' }),
        messages: () => $.session.messages({ as: 'api' }),
        write: fn => update($, snapshotAtom, fn),
        rebuild: async data => {
          if ((await read($, viewAtom)).level !== 1) {
            await writeView($, view => rebuildView(view, data))
          }
        },
      })
    }

    return result
  }).catch(($, e, next) => next(e))

  // The theme changed in /config: the palette follows.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined) {
      const theme = typeof result.value === 'string' ? result.value : null
      await quietly(update($, themeAtom, () => theme))
    }

    return result
  }).catch(($, e, next) => next(e))

  // The keyboard twin of the hover chip: the band names the segment whose
  // Button holds the focus ring. Every plugin's elements (`plugin: '*'`):
  // the ring moving onto another mod's row in the band, or onto an engine
  // stop (no `element`), must clear it too. No event says the band lost the
  // keyboard (Esc, typing, a click elsewhere), so each move onto a segment
  // also starts a timer that ends the chip (focus.ts).
  on('ui.focus', { component: 'AbovePrompt', plugin: '*' }, async ($, e, next) => {
    trace($, { hook: 'ui.focus', component: e.component, origin: e.origin, element: e.element ?? null })
    const result = await next(e)
    if (result.deny === undefined) {
      const isOurs = e.plugin === 'context-breakdown' && e.element?.startsWith('seg-') === true
      const key = isOurs ? (e.element ?? null) : null
      if (key !== null) {
        mayHoldFocus = true
        const hold = chipHold.start(
          (ms, fn) => $.clock.after(ms, fn),
          held => {
            // Clears only this move's value: a later move, or a later load's, stays.
            try {
              void quietly(update($, focusAtom, value => (value?.load === LOAD && value.hold === held ? null : value)))
            } catch {
              // A `$` that no longer answers (an unloaded copy): nothing to clear.
            }
          },
        )
        await quietly(update($, focusAtom, () => ({ key, load: LOAD, hold })))
      } else if (mayHoldFocus) {
        mayHoldFocus = false
        chipHold.stop()
        await quietly(update($, focusAtom, () => null))
      }
    }

    return result
  }).catch(($, e, next) => next(e))

  // A ring that moves in a pane means the band no longer holds the keyboard.
  // Any pane, any plugin's; nothing to do unless a chip may be up.
  on('ui.focus', { component: 'Pane', plugin: '*' }, async ($, e, next) => {
    trace($, { hook: 'ui.focus', component: e.component, origin: e.origin, element: e.element ?? null })
    const result = await next(e)
    // Our pane's ring moved: onto `element`, whose row is drawn in one
    // highlight, or onto one of the engine's stops (the close mark), which
    // has no element. That is noted as no row, or the row the ring left
    // would stay drawn as if it held it.
    // While a move of j, k or an arrow is under way, this mod's own events
    // are answers to older targets: the record keeps the newest (ring.ts).
    // A report of a move this mod asked for: one of an older target is stale.
    const asked = e.element === undefined ? -1 : ringAsked.indexOf(e.element)
    const isEcho = e.origin.kind === 'person' && asked >= 0
    if (isEcho) {
      ringAsked.splice(0, asked + 1)
    }
    const isStale = isEcho && ring.local() !== e.element
    if (!isStale && result.deny === undefined && e.requestId === PANE_ID && notesRing(e.origin, PLUGIN, ring.busy())) {
      const key = e.plugin === PLUGIN && e.element !== undefined ? e.element : OFF_ROWS
      ring.set(key)
      await quietly(writeRing($, () => key))
    }
    if (mayHoldFocus) {
      mayHoldFocus = false
      chipHold.stop()
      await quietly(update($, focusAtom, () => null))
    }

    return result
  }).catch(($, e, next) => next(e))

  // A submitted prompt means the band no longer holds the keyboard (Esc gives
  // it back without a focus event): drop the chip at once rather than when
  // its timer ends. Not on each keystroke (prompt.edit): that would put this
  // mod on the typing path.
  on('prompt.submit', ($, e, next) => {
    if (mayHoldFocus) {
      mayHoldFocus = false
      chipHold.stop()
      void quietly(update($, focusAtom, () => null))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // j and k at levels 1 and 2: the ring one row down or up (ring.ts). A
  // registered hook, as for the scroll below, so the engine raises this
  // mod's `ui.focus` hook for the move. Every press counts: none is dropped.
  // A pane without the keys has no ring to move (a click on the desktop's
  // Down or Up): the press changes nothing.
  on('ui.press', { component: 'Pane', requestId: 'context-breakdown', element: ['list-down', 'list-up'] }, async ($, e, next) => {
    trace($, { hook: 'ui.press', element: e.element, surface: e.surface })
    const result = await next(e)
    if (paneFocused) {
      await quietly(moveRing($, stepOf(e.element)))
    }

    return result
  }).catch(($, e, next) => next(e))

  // Level 3's presses that change what the text shows: j and k
  // (`scrollPress`), f (`formatPress`), and n, p, the Next page below the
  // text, v and r. One hook for all of them, so each press reaches it in
  // the order pressed: the engine walks a press past each earlier hook that
  // does not match it, so presses that meet separate hooks can overtake.
  //
  // Off the terminal n, p, the Next page below the text, v and r go into the
  // one queue with j, k and f (lineLane), queued as the press comes, so they
  // apply in the order pressed. The hook takes the press: the Button's own
  // onPress would run outside the queue. The terminal, and n, p and r at
  // levels 1 and 2, pass on to the onPress untouched.
  // Literal matchers, as the render hook's: the engine reads them as written.
  on(
    'ui.press',
    {
      component: 'Pane',
      requestId: 'context-breakdown',
      element: ['scroll-down', 'scroll-up', 'format', 'prev', 'next', 'next-below', 'view', 'refresh'],
    },
    async ($, e, next) => {
      trace($, { hook: 'ui.press', element: e.element, surface: e.surface })
      if (e.element === 'scroll-down' || e.element === 'scroll-up') {
        return scrollPress($, e, next)
      }
      if (e.element === 'format') {
        return formatPress($, e, next)
      }
      const isItemOnly = e.element === 'next-below' || e.element === 'view'
      if (e.surface === 'terminal' || !(isItemOnly || shownView.level === 3)) {
        return next(e)
      }
      const refresh = () =>
        refresher
          .now({
            after: (ms, fn) => $.clock.after(ms, fn),
            now: () => $.clock.now(),
            usage: () => $.session.usage({ breakdown: 'summary' }),
            messages: () => $.session.messages({ as: 'api' }),
            write: fn => update($, snapshotAtom, fn),
            rebuild: async data => {
              if ((await read($, viewAtom)).level !== 1) {
                await writeView($, current => rebuildView(current, data))
              }
            },
          })
          .then(() => refreshItem(navOf($)))
      await quietly(inLineLane(() => itemPress($, e.element, refresh)))

      return { element: e.element }
    },
  ).catch(($, e, next) => next(e))



  // The scroll a j or k press asked for lands one row from where the window
  // stands. Matched on this plugin's origin, so the person's wheel and arrows
  // never wait on this hook. If it fails, a scroll of ours stays put. If the
  // engine skips it, a step lands on row 0 (where `start` resolved) once, and
  // the press hook then stops asking (`link`).
  on('ui.scroll', { component: 'Pane', requestId: 'context-breakdown', origin: { kind: 'plugin', name: 'context-breakdown' } }, ($, e, next) => {
    const offset = stepAnswer(e, PLUGIN, steps)
    trace($, { hook: 'ui.scroll', origin: e.origin, by: e.by, offset: e.offset, pointer: e.pointer !== undefined, returned: offset ?? e.offset, bodyRows: e.bodyRows, contentRows: e.contentRows })

    return offset === null ? next(e) : next({ ...e, offset })
  }).catch(($, e, next) => next({ ...e, offset: heldOffset(e, PLUGIN) }))

  // The person's scrolls of the pane. An arrow at level 1 or 2 moves the
  // ring instead of the window when the ring can move that way (a row or a
  // page): the scroll is answered without `next`, so the window stays, and
  // the move is not waited for here. That is decided at once, from what the
  // mod knows now. Any other scroll (the wheel, the page keys, an arrow at
  // the first or last row, every scroll at level 3) passes on untouched, and
  // a j or k after it steps from where it leaves the window.
  on('ui.scroll', { component: 'Pane', requestId: 'context-breakdown', origin: { kind: 'person' } }, ($, e, next) => {
    const step = arrowStep(e, { isFocused: paneFocused, level: shownView.level })
    const moves =
      step !== null &&
      ringTarget(rowKeys(shownView, shownSnapshot), stepStart(shownView, shownSnapshot, shownNoted), step, pagesOf(shownView)) !== null
    trace($, { hook: 'ui.scroll', origin: e.origin, by: e.by, offset: e.offset, pointer: e.pointer !== undefined, ring: moves ? step : null, bodyRows: e.bodyRows, contentRows: e.contentRows })
    if (step === null || !moves) {
      steps.forget()

      return next(e)
    }
    void quietly(moveRing($, step))

    return {}
  }).catch(($, e, next) => next(e))

  // The parts the band drew last, for a click the desktop's bar posts.
  let bandParts: readonly LayoutPart[] = []

  /**
   * What a click on the band opens: a segment its items, a merged cell or
   * the total (null) the segments.
   */
  const openFromBand = (nav: NavIo, acts: BandActs, part: SegmentPart | null) =>
    quietly(
      (async () => {
        // A click moves the ring onto the segment too, which shows its
        // chip; the pane it opens names the segment now. Cleared before
        // the open and again after it, in case the ring's move came late.
        const dropChip = async () => {
          mayHoldFocus = false
          chipHold.stop()
          await quietly(acts.dropFocus())
        }
        await dropChip()
        keepsPlace = false
        await quietly(acts.dropRing())
        if (part !== null && part.members.length === 1) {
          await openSegment(nav, part.id as ContextBreakdownSegmentId)
        } else {
          await acts.toLevel1()
        }
        // No `focus`: the click gave the band the keyboard, and the engine
        // refuses `focus` while the band holds it. The pane says how to
        // get the keys instead.
        await acts.open()
        await dropChip()
        // An open pane keeps its window: the new level starts at the top.
        await acts.toTop()
      })(),
    )

  // A click on the desktop's bar (barclient.tsx): the part under it, or the total.
  on('ui.message', { component: 'AbovePrompt' }, async ($, e, next) => {
    const data = e.data as Partial<BarClientPost> | null
    if (e.element !== BAR_CLIENT || data === null || typeof data !== 'object' || data.open === undefined) {
      return next(e)
    }
    const nav: NavIo = {
      usage: () => $.session.usage({ breakdown: 'summary' }),
      messages: () => $.session.messages({ as: 'api' }),
      snapshot: () => read($, snapshotAtom),
      view: () => read($, viewAtom),
      write: fn => writeView($, fn),
      readFile: path => $.fs.read(path),
    }
    const part = data.open === 'total' ? null : bandParts[data.open]
    if (part === undefined || (part !== null && part.kind !== 'segment')) {
      return next(e)
    }
    await openFromBand(nav, bandActs($), part)

    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snapshot = await read($, snapshotAtom)
    // Nothing before the first measurement, and a survey has the band.
    if (snapshot === null || e.props.hasSurvey) {
      return next(e)
    }
    const model = bandModelFor(snapshot, e.props.bodyColumns, e.surface)
    // Too narrow for even the shortest total.
    if (model.label === '') {
      return next(e)
    }
    const palette = paletteFor(await read($, themeAtom))
    const focus = await read($, focusAtom)
    const focused = focus !== null && focus.load === LOAD ? focus.key : null
    const nav: NavIo = {
      usage: () => $.session.usage({ breakdown: 'summary' }),
      messages: () => $.session.messages({ as: 'api' }),
      snapshot: () => read($, snapshotAtom),
      view: () => read($, viewAtom),
      write: fn => writeView($, fn),
      readFile: path => $.fs.read(path),
    }

    // A segment opens its items; a merged cell, which holds several, the list.
    const acts = bandActs($)
    const openPane: OpenPane = part => openFromBand(nav, acts, part)
    // The desktop's bar posts the index of the part a click landed on.
    bandParts = model.parts

    return bandTree($.ui.resolve(e), model, palette, openPane, focused, pictureFigures(snapshot), e.surface)
  })

  on('ui.render', { component: 'Pane', requestId: 'context-breakdown' }, async ($, e) => {
    const snapshot = await read($, snapshotAtom)
    const palette = paletteFor(await read($, themeAtom))
    // A minimized pane on the desktop app: a glance, as clicks may not reach it.
    if (e.props.placement === 'widget') {
      return glanceTree($.ui.resolve(e), snapshot, e.props.bodyColumns, palette, e.surface)
    }
    win.shown = e.props.scroll?.offset ?? 0
    shownColumns = e.props.bodyColumns
    shownSurface = e.surface
    shownBodyRows = e.props.scroll?.bodyRows ?? null
    const view = await read($, viewAtom)
    paneFocused = e.props.isFocused === true
    shownView = view
    shownSnapshot = snapshot
    trace($, { hook: 'ui.render', isFocused: e.props.isFocused === true, offset: win.shown, level: view.level, surface: e.surface, scroll: e.props.scroll ?? null, columns: e.props.bodyColumns })
    // The ring's key. The terminal reads it from the state, so a move draws
    // the row lit. A desktop draws no lit row, and each redraw there makes the
    // focus outline flash: its drawing takes the key from the mod's own
    // record and so does not follow the state's writes (seen live: two
    // redraws for each j, none for a Tab).
    const ringNow = e.surface === 'terminal' ? await read($, ringAtom) : (ring.local() ?? shownNoted)
    shownNoted = ringNow
    const nav: NavIo = {
      usage: () => $.session.usage({ breakdown: 'summary' }),
      messages: () => $.session.messages({ as: 'api' }),
      snapshot: () => read($, snapshotAtom),
      view: () => read($, viewAtom),
      write: fn => writeView($, fn),
      readFile: path => $.fs.read(path),
    }
    // The engine keeps the window across a new tree, only clamped: a page or
    // level change starts at the top. A refresh keeps the place; f is the
    // `ui.press` hook's. Then the ring goes onto the element the new tree
    // focuses (the row b came back to, the first row, the first control):
    // `autoFocus` alone left some trees with no ring, after Enter. The call
    // is refused while the pane does not hold the keys; that is fine.
    const thenTop = (work: () => Promise<unknown>) => thenTopOf($, work)

    const tree = paneTree($.ui.resolve(e), snapshot, view, e.props.bodyColumns, {
      close: () =>
        quietly(
          (async () => {
            await $.ui.close({ id: PANE_ID })
            await writeView($, toLevel1)
          })(),
        ),
      refresh: () =>
        quietly(
          (async () => {
            await refresher.now({
              after: (ms, fn) => $.clock.after(ms, fn),
              now: () => $.clock.now(),
              usage: () => $.session.usage({ breakdown: 'summary' }),
              messages: () => $.session.messages({ as: 'api' }),
              write: fn => update($, snapshotAtom, fn),
              rebuild: async data => {
                if ((await read($, viewAtom)).level !== 1) {
                  await writeView($, current => rebuildView(current, data))
                }
              },
            })
            await refreshItem(nav)
          })(),
        ),
      openSegment: id => thenTop(() => openSegment(nav, id)),
      openItem: id => thenTop(() => openItem(nav, id)),
      back: () => thenTop(() => writeView($, back)),
      toggleSort: () => thenTop(() => toggleSort(nav)),
      listPage: delta => thenTop(() => listPage(nav, delta)),
      contentPage: delta => thenTop(() => contentPage(nav, delta)),
      toggleSource: () => thenTop(() => toggleSource(nav)),
      copy: (path, surface) =>
        quietly(
          (async () => {
            const copied = await $.ui.copy({ text: path, surface })
            await notice(nav, copied.isCopied ? 'Copied the path.' : `The path was not copied (${copied.reason}).`)
          })(),
        ),
      mention: path =>
        quietly(
          (async () => {
            const filled = await $.prompt.fill({ text: mention(path), mode: 'insert' })
            const why =
              filled.refusal === 'no_composer'
                ? ': there is no prompt box'
                : filled.refusal === 'dialog'
                  ? ': a dialog holds the keys'
                  : ''
            await notice(nav, filled.isFilled ? 'Put the path in the prompt.' : `The prompt did not take the path${why}.`)
          })(),
        ),
    }, palette, e.props.isFocused === true, e.surface, keepsPlace, ringNow)

    return tree
  })
}
