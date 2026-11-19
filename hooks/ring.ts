// j, k and the arrows at levels 1 and 2 on the terminal: the focus ring one
// row down or up. Only the terminal reports every move of the ring to the
// mod. Every other surface moves the ring with Tab and Shift+Tab and raises
// no event for them, so there the mod draws no j and k and leaves the arrows
// to the app.
//
// The ring moves through `$.ui.focus`. A held key can press faster than the
// engine answers and raises `ui.focus`, so the mod keeps its own record of
// the row the ring is on and steps from that (`RingMoves.from`). The presses
// run one after the other and none is dropped; the focus calls run one at a
// time, and a target asked for while one is under way replaces any that
// waits, so the ring always ends on the last target.
//
// A mod cannot bind the arrows. While the pane is taller than its window,
// the engine turns an arrow into a scroll of one row, raised as `ui.scroll`
// with the person's origin and no pointer. When the ring can move that way
// (a row or a page), the mod answers that scroll without moving the window
// and moves the ring instead (`arrowStep`, `ringTarget`). At the first or the
// last row it passes the scroll on, so the arrows still bring the lines above
// and below the rows into view. While the list fits, the engine walks the
// ring with the arrows itself and raises `ui.focus`, which the mod notes like
// any other move.
//
// A click on the Down or Up control puts the ring on that control first. So
// the record keeps the last row the ring was on beside it, and j and k step
// from that row (`RingMoves.from`).

import type { ContextBreakdownSnapshot, ContextBreakdownView } from '../types'
import { LIST_DOWN, LIST_UP } from './scroll'

/** The keys of the rows that open, in drawing order; none at level 3. */
export function rowKeys(view: ContextBreakdownView, snapshot: ContextBreakdownSnapshot | null): string[] {
  if (view.level === 2) {
    return view.list.rows.filter(row => row.isOpenable).map(row => `item-${row.id}`)
  }
  if (view.level === 3 || snapshot === null) {
    return []
  }

  return [...snapshot.baseline, ...snapshot.conversation].filter(segment => segment.tokens > 0).map(segment => `row-${segment.id}`)
}

/** Whether the list has a page before and after the one shown: only level 2 has pages. */
export function pagesOf(view: ContextBreakdownView): { prev: boolean; next: boolean } {
  if (view.level !== 2) {
    return { prev: false, next: false }
  }

  return { prev: view.list.page > 0, next: view.list.page + 1 < view.list.pages }
}

/** Where one step takes the ring: a row, the next or previous page, or nowhere. */
export type RingMove = { key: string } | { page: 1 | -1 } | null

/**
 * The move one step makes from the row `current` (a row's key, or anything
 * else for no row). From no row, down goes to the first row and up to the
 * last. Past the last row down opens the next page, before the first row up
 * the previous page, when there is one; otherwise the ring stays.
 */
export function ringTarget(
  keys: readonly string[],
  current: string | null,
  step: number,
  pages: { prev: boolean; next: boolean } = { prev: false, next: false },
): RingMove {
  if (keys.length === 0 || step === 0) {
    return null
  }
  const at = current === null ? -1 : keys.indexOf(current)
  if (at === -1) {
    return { key: step > 0 ? keys[0]! : keys[keys.length - 1]! }
  }
  const to = at + (step > 0 ? 1 : -1)
  if (to >= keys.length) {
    return pages.next ? { page: 1 } : null
  }
  if (to < 0) {
    return pages.prev ? { page: -1 } : null
  }

  return { key: keys[to]! }
}

/** The fields of a person's `ui.scroll` that tell an arrow from the wheel or a page key. */
export type PersonScroll = { by: number; pointer?: unknown }

/**
 * The step an arrow makes on the ring, or null to let the scroll through.
 * Only while the pane holds the keys at level 1 or 2, and only for a scroll
 * of one row with no pointer: an arrow. The wheel carries a pointer, and a
 * page key or Home and End move more than one row.
 */
export function arrowStep(e: PersonScroll, state: { isFocused: boolean; level: 1 | 2 | 3 }): 1 | -1 | null {
  if (!state.isFocused || state.level === 3 || e.pointer !== undefined || Math.abs(e.by) !== 1) {
    return null
  }

  return e.by > 0 ? 1 : -1
}

/** Who moved the ring, as a `ui.focus` event says. */
export type RingOrigin = { kind: 'person' } | { kind: 'plugin'; name: string }

/**
 * Whether a `ui.focus` event updates the mod's record of the ring. The
 * person's moves always do. This mod's own do only while none of its moves
 * is under way: an answer to an older target would put the ring back.
 */
export function notesRing(origin: RingOrigin, plugin: string, busy: boolean): boolean {
  return origin.kind === 'person' || origin.name !== plugin || !busy
}

/** What the record held before a move, to put back when the engine refuses it. */
export type RingMark = { local: string | null | undefined; row: string | null | undefined }

export type RingMoves = {
  /**
   * The key a step starts from: the ring's key, or, while the ring is on the
   * Down or Up control, the last key it held before (a row, or none).
   */
  from: () => string | null | undefined
  /** Notes the ring on `key`. The Down and Up controls keep the row the ring left. */
  set: (key: string | null) => void
  /** The record now, and the record put back as it was. */
  mark: () => RingMark
  restore: (mark: RingMark) => void
  /** A new tree: the record names an element of the old one. */
  forget: () => void
  /**
   * The person moved the ring (Tab, a click): a target that still waits is
   * older than that move and is not asked for. The call under way stands.
   */
  drop: () => void
  /** Whether a press or a focus call is under way. */
  busy: () => boolean
  /** Resolves once no focus call is under way or waits. */
  idle: () => Promise<void>
  /** Runs one press's work after the ones before it. None is dropped. */
  serial: (work: () => Promise<void>) => Promise<void>
  /**
   * Asks `apply` for the ring on `key`, one call at a time. A key asked for
   * while a call is under way waits, and replaces any key that waited.
   *
   * When the engine answers `{ deny }` and no later move has changed the
   * record, `undo` runs: it puts back what the move changed. A key that
   * replaced a waiting one keeps the waiting one's `undo`, so it goes back to
   * before both; `undo` is told the key that was refused, which is then not
   * the key its own move asked for. A call that fails runs no `undo`.
   */
  focus: (key: string, apply: (key: string) => Promise<unknown>, undo?: (denied: string) => Promise<unknown> | void) => Promise<void>
}

function isDeny(answer: unknown): boolean {
  return typeof answer === 'object' && answer !== null && typeof (answer as { deny?: unknown }).deny === 'string'
}

export function createRingMoves(): RingMoves {
  let local: string | null | undefined
  let row: string | null | undefined
  let tail: Promise<void> = Promise.resolve()
  let pressing = 0
  type Wait = { key: string; apply: (key: string) => Promise<unknown>; undo: ((denied: string) => Promise<unknown> | void) | undefined }
  let waiting: Wait | null = null
  let running: Promise<void> | null = null

  const drain = async () => {
    while (waiting !== null) {
      const { key, apply, undo } = waiting
      waiting = null
      try {
        const answer = await apply(key)
        if (isDeny(answer) && local === key && undo !== undefined) {
          await undo(key)
        }
      } catch {
        // A refused move leaves the ring where it was; the next one still runs.
      }
    }
    running = null
  }

  return {
    from: () => (local === LIST_DOWN || local === LIST_UP ? row : local),
    set: key => {
      local = key
      if (key !== LIST_DOWN && key !== LIST_UP) {
        row = key
      }
    },
    mark: () => ({ local, row }),
    restore: mark => {
      local = mark.local
      row = mark.row
    },
    forget: () => {
      local = undefined
      row = undefined
    },
    drop: () => {
      waiting = null
    },
    busy: () => pressing > 0 || running !== null,
    idle: () => running ?? Promise.resolve(),
    serial: work => {
      pressing += 1
      const turn = tail.then(work).finally(() => {
        pressing -= 1
      })
      // A failed press does not stop the next one.
      tail = turn.catch(() => undefined)

      return turn
    },
    focus: (key, apply, undo) => {
      waiting = { key, apply, undo: waiting?.undo ?? undo }
      running ??= drain()

      return running
    },
  }
}
