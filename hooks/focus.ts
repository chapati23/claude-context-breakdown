// How long the keyboard chip stays up after the last focus move, and the one
// timer that ends it.
//
// The engine raises `ui.focus` when the ring moves onto an element, but no
// event when the band loses the keyboard (Esc, typing, a click elsewhere),
// and no call says which element holds it. So the chip ends on its own a few
// seconds after the ring last moved onto a segment.

import type { Timer } from 'claude-code'

/** The keyboard chip ends this long after the last focus move onto a segment. */
export const CHIP_HOLD_MS = 4000

export type ChipHold = {
  /**
   * A focus move onto a segment: stops the running timer and starts a new
   * one. Returns the move's number; `expire` gets it when its time is up.
   */
  start: (after: (ms: number, fn: () => void) => Timer, expire: (hold: number) => void) => number
  /** The chip was cleared some other way: no timer is left running. */
  stop: () => void
}

/**
 * One timer at most, for this load of the code. A timer an earlier load
 * started may still fire (`after` runs on until the old copy unloads); its
 * `expire` clears only the value its own move wrote, so it changes nothing.
 */
export function createChipHold(): ChipHold {
  let timer: Timer | null = null
  let moves = 0

  const stop = () => {
    const running = timer
    timer = null
    if (running !== null) {
      try {
        running.cancel()
      } catch {
        // Already gone.
      }
    }
  }

  return {
    start: (after, expire) => {
      stop()
      moves += 1
      const hold = moves
      let started: Timer | null = null
      try {
        started = after(CHIP_HOLD_MS, () => {
          if (started !== null && timer === started) {
            timer = null
          }
          expire(hold)
        })
        timer = started
      } catch {
        // No timer: the chip then stays until the next focus move or prompt.
        timer = null
      }

      return hold
    },
    stop,
  }
}
