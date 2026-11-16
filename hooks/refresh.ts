// Takes measurements outside the dispatch that asked for one, so no tool
// result, turn or compaction waits on reading the whole conversation.
//
// The engine wants `$` spelled at each call site, never passed around, so a
// hook hands this module the few calls it needs as closures (Io).

import type { SessionUsage, Timer } from 'claude-code'

import type { ContextBreakdownSnapshot } from '../types'
import type { MessageLike } from './classify'
import type { ItemData } from './items'
import type { Compaction } from './snapshot'
import { nextSnapshot } from './snapshot'

/** At most one measurement per this many milliseconds after tool calls. */
export const TOOL_THROTTLE_MS = 3000

/** The engine calls a measurement makes, bound by the hook that asks. */
export type Io = {
  after: (ms: number, fn: () => void) => Timer
  now: () => Promise<number>
  usage: () => Promise<SessionUsage>
  messages: () => Promise<readonly MessageLike[]>
  write: (
    fn: (previous: ContextBreakdownSnapshot | null) => ContextBreakdownSnapshot | null,
  ) => Promise<unknown>
  /** Rebuilds an open list or item from what this measurement read. */
  rebuild?: (data: ItemData) => Promise<unknown>
}

export type Refresher = {
  /** Measures as soon as the calling dispatch is done. */
  soon: (io: Io) => void
  /** Measures after tool calls, at most once every TOOL_THROTTLE_MS. */
  afterTool: (io: Io) => void
  /** Notes a compaction of the main conversation, then measures. */
  compacted: (io: Io, staleTokens: number | null) => void
  /** Drops the old conversation's snapshot after a /clear, then measures. */
  cleared: (io: Io) => Promise<void>
  /** Measures now and resolves when the snapshot is written (a press). */
  now: (io: Io) => Promise<void>
}

/** One measurement: usage, then the messages, then one state write. */
async function measure(io: Io, compaction: Compaction | null): Promise<boolean> {
  const usage = await io.usage()
  const breakdown = usage.context.breakdown
  if (breakdown === undefined) {
    return false
  }
  let messages: readonly MessageLike[] | null
  try {
    messages = await io.messages()
  } catch {
    // The split needs the messages; without them one "Conversation" shows.
    messages = null
  }
  const now = await io.now()
  let written: ContextBreakdownSnapshot | null = null
  await io.write(previous => {
    written = nextSnapshot({
      breakdown,
      modelWindow: usage.context.window,
      contextTokens: usage.context.tokens,
      messages,
      previous,
      compaction,
      now,
    })

    return written
  })
  if (io.rebuild !== undefined) {
    try {
      const snapshot = written as ContextBreakdownSnapshot | null
      await io.rebuild({
        breakdown,
        messages,
        charsPerToken: snapshot?.charsPerToken ?? null,
        segments: snapshot?.conversation ?? null,
      })
    } catch {
      // The pane keeps its page; the next measurement tries again.
    }
  }

  return true
}

export function createRefresher(): Refresher {
  let running: Promise<void> | null = null
  let isAgain = false
  let compaction: Compaction | null = null
  let toolTimer: Timer | null = null
  let toolTimerAt = 0

  // One measurement at a time; a request during one runs once more after it.
  function run(io: Io): Promise<void> {
    if (running !== null) {
      isAgain = true

      return running
    }
    running = (async () => {
      try {
        do {
          isAgain = false
          const pending = compaction
          compaction = null
          let isDone = false
          try {
            isDone = await measure(io, pending)
          } catch {
            // Our own failure: the last snapshot stays on screen.
          }
          if (!isDone && pending !== null && compaction === null) {
            // Keep the compaction for the next try, so a stale fill is not shown.
            compaction = pending
          }
        } while (isAgain)
      } finally {
        running = null
      }
    })()

    return running
  }

  function soon(io: Io): void {
    try {
      io.after(0, () => {
        void run(io)
      })
    } catch {
      // No timer: skip this measurement; the next event asks again.
    }
  }

  // A burst of tool calls shares one measurement at the window's end.
  async function armToolTimer(io: Io): Promise<void> {
    let now: number
    try {
      now = await io.now()
    } catch {
      return
    }
    if (toolTimer !== null) {
      if (now - toolTimerAt < 2 * TOOL_THROTTLE_MS) {
        return
      }
      // A refused wait never runs its function and gives no sign, so a timer
      // well past its time counts as lost; otherwise it would block every
      // later refresh after tool calls.
      try {
        toolTimer.cancel()
      } catch {
        // Already gone.
      }
      toolTimer = null
    }
    toolTimerAt = now
    try {
      const timer = io.after(TOOL_THROTTLE_MS, () => {
        if (toolTimer === timer) {
          toolTimer = null
        }
        void run(io)
      })
      toolTimer = timer
    } catch {
      toolTimer = null
    }
  }

  return {
    soon,
    afterTool: io => {
      void armToolTimer(io)
    },
    compacted: (io, staleTokens) => {
      compaction = { staleTokens }
      soon(io)
    },
    cleared: async io => {
      // The old conversation is gone: no estimate to carry, nothing to draw
      // until the new one is measured.
      compaction = null
      try {
        await io.write(() => null)
      } catch {
        // The next measurement replaces the snapshot anyway.
      }
      soon(io)
    },
    now: io => run(io),
  }
}
