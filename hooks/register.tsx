// Wiring only: which events ask for a measurement, where it is drawn, and
// what each press of the pane does. The logic lives in the .ts files beside
// this one. Each hook spells `$` at its call sites (the engine refuses `$`
// passed around), so the calls a measurement or a move needs are handed over
// as closures.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ContextBreakdownSegmentId } from '../types'
import { bandTree, glanceTree } from './band'
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
import { paneTree, ringKey } from './pane'
import { paletteFor } from './palette'
import { createRefresher } from './refresh'
import {
  STEP_SCROLL,
  TOP_SCROLL,
  createLane,
  createSteps,
  crossDelta,
  crossScroll,
  heldOffset,
  learnLink,
  shareAcross,
  stepAnswer,
  stepOf,
} from './scroll'
import type { Link } from './scroll'
import { matchSegment } from './segments'
import { PANE_ID, PANE_TITLE, PLUGIN } from './state'
import { bandModelFor } from './view'

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
 * Whether the `ui.scroll` hook sees our own scrolls (scroll.ts). A hint for
 * this load only: a reload that resets it asks again.
 */
let link: Link = 'unknown'
/**
 * The pane's window offset the render hook last read: whether a scroll of
 * ours had to move the window, for `learnLink`. A hint only, never drawn from.
 */
let shownOffset = 0
/**
 * `/ctx` only gave an open pane the keyboard: its trees take no ring until
 * the next move, so the window stays where the person left it (`paneTree`).
 * A reload that resets it only gives the ring back to the first control.
 */
let keepsPlace = false

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
          await update($, viewAtom, view => rebuildView(view, data))
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
      write: fn => update($, viewAtom, fn),
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
    if (segment !== null) {
      await quietly(openSegment(nav, segment))
    } else if (hasWord) {
      await quietly(update($, viewAtom, toLevel1With(noMatchNote(e.args))))
    } else if (!isOpen) {
      await quietly(update($, viewAtom, toLevel1))
    }
    // A pane that takes the keyboard gets its ring back on a control, and the
    // engine brings that control into view (seen live: the window jumped to
    // the controls above the text). So read where the window stands first
    // (`measure`), and put it back after the open (`place`), as f does.
    const held: { share: number | null } = { share: null }
    if (keepsPlace && link !== 'absent') {
      await lane.run(async () => {
        const measure = steps.push(0, 'measure')
        try {
          let answer: { deny?: string } | null = null
          try {
            answer = await $.ui.scroll(STEP_SCROLL)
          } catch {
            answer = null
          }
          link = learnLink(link, measure, answer, shownOffset)
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
            link = learnLink(link, token, answer, shownOffset)
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
          await update($, viewAtom, view => rebuildView(view, data))
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
            await update($, viewAtom, view => rebuildView(view, data))
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
            await update($, viewAtom, view => rebuildView(view, data))
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
            await update($, viewAtom, view => rebuildView(view, data))
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
              await update($, viewAtom, view => rebuildView(view, data))
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
      await quietly(update($, viewAtom, afterClear))
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
            await update($, viewAtom, view => rebuildView(view, data))
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
    const result = await next(e)
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

  // j and k. This hook, not the Button's onPress, asks for the scroll: the
  // engine shows this mod's `ui.scroll` hook a scroll a registered hook asked
  // for, never one from onPress (see scroll.ts). One press at a time, so each
  // steps from the row the last one left. At a page's edge the press opens
  // the next page at its top, or the previous page at its bottom.
  // Literal matchers, as the render hook's: the engine reads them as written.
  on('ui.press', { component: 'Pane', requestId: 'context-breakdown', element: ['scroll-down', 'scroll-up', 'list-down', 'list-up'] }, async ($, e, next) => {
    const step = stepOf(e.element)
    const ran = await lane.run(async () => {
      const token = steps.push(step)
      try {
        const result = await next(e)
        // Without the hook a step to `start` would jump to the top: no scroll.
        if (link === 'absent') {
          return result
        }
        let answer: { deny?: string } | null = null
        try {
          answer = await $.ui.scroll(STEP_SCROLL)
        } catch {
          // No pane to scroll, or no surface: the press does nothing.
        }
        link = learnLink(link, token, answer, shownOffset)
        // Only the hook sets `cross`, from the window's own numbers.
        const { cross } = token
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
                write: fn => update($, viewAtom, fn),
                readFile: path => $.fs.read(path),
              }
              await contentPage(nav, delta, delta < 0)
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
      }
    })

    // A press dropped while two are under way only passes on.
    return ran === null ? next(e) : ran.value
  }).catch(($, e, next) => next(e))

  // f switches the view. A press hook, as j and k, so this mod's `ui.scroll`
  // hook sees its scrolls: one reads where the window stands, and after the
  // switch one puts the window at the same line of the other view. Without
  // the hook (or when that is not known) the other view opens at its top.
  on('ui.press', { component: 'Pane', requestId: 'context-breakdown', element: 'format' }, async ($, e, next) => {
    const nav: NavIo = {
      usage: () => $.session.usage({ breakdown: 'summary' }),
      messages: () => $.session.messages({ as: 'api' }),
      snapshot: () => read($, snapshotAtom),
      view: () => read($, viewAtom),
      write: fn => update($, viewAtom, fn),
      readFile: path => $.fs.read(path),
    }
    const ran = await lane.run(async () => {
      const measure = link === 'absent' ? null : steps.push(0, 'measure')
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
              link = learnLink(link, measure, answer, shownOffset)
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
  }).catch(($, e, next) => next(e))

  // The scroll a j or k press asked for lands one row from where the window
  // stands. Matched on this plugin's origin, so the person's wheel and arrows
  // never wait on this hook. If it fails, a scroll of ours stays put. If the
  // engine skips it, a step lands on row 0 (where `start` resolved) once, and
  // the press hook then stops asking (`link`).
  on('ui.scroll', { component: 'Pane', requestId: 'context-breakdown', origin: { kind: 'plugin', name: 'context-breakdown' } }, ($, e, next) => {
    const offset = stepAnswer(e, PLUGIN, steps)

    return offset === null ? next(e) : next({ ...e, offset })
  }).catch(($, e, next) => next({ ...e, offset: heldOffset(e, PLUGIN) }))

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
      write: fn => update($, viewAtom, fn),
      readFile: path => $.fs.read(path),
    }

    // A segment opens its items; a merged cell, which holds several, the list.
    return bandTree(
      $.ui.resolve(e),
      model,
      palette,
      part =>
        quietly(
          (async () => {
            // A click moves the ring onto the segment too, which shows its
            // chip; the pane it opens names the segment now. Cleared before
            // the open and again after it, in case the ring's move came late.
            const dropChip = async () => {
              mayHoldFocus = false
              chipHold.stop()
              await quietly(update($, focusAtom, () => null))
            }
            await dropChip()
            keepsPlace = false
            if (part.members.length === 1) {
              await openSegment(nav, part.id as ContextBreakdownSegmentId)
            } else {
              await update($, viewAtom, toLevel1)
            }
            // No `focus`: the click gave the band the keyboard, and the engine
            // refuses `focus` while the band holds it. The pane says how to
            // get the keys instead.
            await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
            await dropChip()
            // An open pane keeps its window: the new level starts at the top.
            await $.ui.scroll(TOP_SCROLL)
          })(),
        ),
      focused,
    )
  })

  on('ui.render', { component: 'Pane', requestId: 'context-breakdown' }, async ($, e) => {
    const snapshot = await read($, snapshotAtom)
    const palette = paletteFor(await read($, themeAtom))
    // A minimized pane on the desktop app: a glance, as clicks may not reach it.
    if (e.props.placement === 'widget') {
      return glanceTree($.ui.resolve(e), snapshot, e.props.bodyColumns, palette)
    }
    shownOffset = e.props.scroll?.offset ?? 0
    const view = await read($, viewAtom)
    const nav: NavIo = {
      usage: () => $.session.usage({ breakdown: 'summary' }),
      messages: () => $.session.messages({ as: 'api' }),
      snapshot: () => read($, snapshotAtom),
      view: () => read($, viewAtom),
      write: fn => update($, viewAtom, fn),
      readFile: path => $.fs.read(path),
    }
    // The engine keeps the window across a new tree, only clamped: a page or
    // level change starts at the top. A refresh keeps the place; f is the
    // `ui.press` hook's. Then the ring goes onto the element the new tree
    // focuses (the row b came back to, the first row, the first control):
    // `autoFocus` alone left some trees with no ring, after Enter. The call
    // is refused while the pane does not hold the keys; that is fine.
    const thenTop = (work: () => Promise<unknown>) =>
      quietly(
        (async () => {
          keepsPlace = false
          await work()
          await quietly($.ui.scroll(TOP_SCROLL))
          const key = ringKey(await read($, viewAtom), await read($, snapshotAtom), true)
          if (key !== null) {
            await $.ui.focus({ requestId: PANE_ID, key })
          }
        })(),
      )

    return paneTree($.ui.resolve(e), snapshot, view, e.props.bodyColumns, {
      close: () =>
        quietly(
          (async () => {
            await $.ui.close({ id: PANE_ID })
            await update($, viewAtom, toLevel1)
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
                  await update($, viewAtom, current => rebuildView(current, data))
                }
              },
            })
            await refreshItem(nav)
          })(),
        ),
      openSegment: id => thenTop(() => openSegment(nav, id)),
      openItem: id => thenTop(() => openItem(nav, id)),
      back: () => thenTop(() => update($, viewAtom, back)),
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
    }, palette, e.props.isFocused === true, e.surface, keepsPlace)
  })
}
