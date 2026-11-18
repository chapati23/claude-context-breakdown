// A debug log of the pane's presses, scrolls, focus moves and draws, for a
// live diagnosis in the desktop app. Off unless `TRACE_FILE` names a file:
// set it to an absolute path, reload, and read one JSON line per event.
// It must ship as null (tests/trace.test.ts).

import type { EngineInterface as Engine } from 'claude-code'

/** The file the trace goes to, or null for no trace at all. */
export const TRACE_FILE: string | null = null

/**
 * The one surface whose session writes the trace, or null for every session.
 * Several sessions can load this folder at once (a terminal and the desktop
 * app), and each writes the whole file: without this they overwrite each
 * other. A session writes nothing until a record names this surface.
 */
export const TRACE_SURFACE: string | null = 'desktop'

/** The most lines kept: the file is written whole each time, and a write over 4 MiB is refused. */
const MOST_LINES = 2000

/** The lines so far, in order; the file API has no append, so each write is the whole file. */
const lines: string[] = []
/** Counts the lines, so their order shows without a clock. */
let count = 0
/** Whether a record of this session has named `TRACE_SURFACE`. */
let isOurs = false
/** Writes one after the other, so a slow write never lands over a later one. */
let writing: Promise<unknown> = Promise.resolve()

/** Adds one line to the trace file. Does nothing while `TRACE_FILE` is null; never throws. */
export function trace($: Engine, record: Record<string, unknown>): void {
  const file = TRACE_FILE
  if (file === null) {
    return
  }
  if (TRACE_SURFACE !== null && !isOurs) {
    if (record.surface !== TRACE_SURFACE) {
      return
    }
    isOurs = true
  }
  count += 1
  let line: string
  try {
    line = JSON.stringify({ n: count, ...record })
  } catch {
    line = JSON.stringify({ n: count, error: 'not serializable' })
  }
  lines.push(line)
  if (lines.length > MOST_LINES) {
    lines.splice(0, lines.length - MOST_LINES)
  }
  const text = `${lines.join('\n')}\n`
  writing = writing.then(() => $.fs.write(file, text)).catch(() => undefined)
}

/** The lines kept so far, for tests. */
export function traceLines(): readonly string[] {
  return lines
}
