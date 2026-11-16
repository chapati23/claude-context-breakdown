// The as-loaded text of instruction and memory files, read from the
// conversation's opening reminder, and the comparison with the file on disk.

import type { BlockLike, MessageLike } from './classify'

/** The result of comparing an as-loaded text with the file now. */
export type DiskCompare = 'same' | 'changed' | 'unknown'

const HEADER = 'Contents of '

/** Lines that end a file's section in the reminder, besides the next header. */
function isSectionEnd(line: string): boolean {
  return (
    line === '</system-reminder>' ||
    line === '# currentDate' ||
    /^\s*IMPORTANT: this context may or may not be relevant/.test(line) ||
    (line.startsWith(HEADER) && line.endsWith(':'))
  )
}

/**
 * The text of `path`'s section in one reminder: the lines after its
 * "Contents of <path> (...):" header up to the next section, or null when
 * the reminder has no such header.
 */
export function sectionOf(reminder: string, path: string): string | null {
  const lines = reminder.replace(/\r\n?/g, '\n').split('\n')
  const head = lines.findIndex(
    line =>
      line.startsWith(`${HEADER}${path}`) &&
      line.endsWith(':') &&
      // The path must end here, so "/a/x.md" does not match "/a/x.md.bak".
      /^(?: \(.*\))?:$/.test(line.slice(HEADER.length + path.length)),
  )
  if (head === -1) {
    return null
  }
  let end = lines.length
  for (let i = head + 1; i < lines.length; i += 1) {
    if (isSectionEnd(lines[i]!)) {
      end = i
      break
    }
  }

  return lines
    .slice(head + 1, end)
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '')
}

function textOf(block: BlockLike): string {
  return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
}

/**
 * The as-loaded text of a memory file: its section in the first reminder of
 * the conversation that carries it, or null when no reminder does.
 */
export function loadedFileText(messages: readonly MessageLike[], path: string): string | null {
  const marker = `${HEADER}${path}`
  for (const message of messages) {
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      continue
    }
    for (const block of message.content) {
      const text = textOf(block)
      if (text.includes(marker) && text.trimStart().startsWith('<system-reminder>')) {
        const section = sectionOf(text, path)
        if (section !== null) {
          return section
        }
      }
    }
  }

  return null
}

/**
 * A text as the engine may load it: line ends folded, leading frontmatter
 * and HTML comments out, trailing spaces out. Both sides get the same, so a
 * step the engine may or may not take never reads as a change.
 */
function normalized(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}

/**
 * The note the engine appends to a MEMORY.md it cut at load:
 * "> WARNING: MEMORY.md is N lines (limit: 200). Only part of it was loaded: …".
 */
const CUT_NOTE = /\n*> WARNING: [^\n]*Only part of it was loaded[^\n]*\s*$/

/** Lines with line ends folded and trailing spaces out, outer blank lines out. */
function plainLines(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}

/**
 * Compares a memory file as loaded with the file now. A prefix either way,
 * or a note of truncation, may be the engine cutting a long file: unknown.
 */
export function compareFile(loaded: string, disk: string): DiskCompare {
  const cut = CUT_NOTE.exec(loaded)
  if (cut !== null) {
    // The engine kept only the file's head: a head that still matches says
    // nothing about the rest, a head that differs is a change.
    const head = loaded.slice(0, cut.index)
    const isHead =
      normalized(disk).startsWith(normalized(head)) || plainLines(disk).startsWith(plainLines(head))

    return isHead ? 'unknown' : 'changed'
  }
  const a = normalized(loaded)
  const b = normalized(disk)
  if (a === b) {
    return 'same'
  }
  const tail = a.split('\n').slice(-5).join('\n')
  if (b.startsWith(a) || a.startsWith(b) || /truncat|cut off|only part of it was loaded/i.test(tail)) {
    return 'unknown'
  }

  return 'changed'
}

/** A Read result line: its number, then a tab or an arrow, then the line. */
const NUMBERED = /^\s*(\d+)(?:\t|→)(.*)$/

/** Lines longer than this may have been cut by the Read tool. */
const LONG_LINE = 1000

/**
 * The numbered lines at the head of a Read result, or null when it has none
 * or their numbers do not run on one by one. Lines after them (a reminder,
 * a note) are not the file's.
 */
export function readLines(result: string): { first: number; lines: string[] } | null {
  const out: string[] = []
  let first = 0
  for (const line of result.replace(/\r\n?/g, '\n').split('\n')) {
    const match = NUMBERED.exec(line)
    if (match === null) {
      break
    }
    const n = Number(match[1])
    if (out.length === 0) {
      first = n
    } else if (n !== first + out.length) {
      return null
    }
    out.push(match[2]!)
  }

  return out.length === 0 || first < 1 ? null : { first, lines: out }
}

/**
 * Compares a Read result with the file now, line by line over the part it
 * holds (a Read may hold only some lines). Unknown when the result holds no
 * numbered lines.
 */
export function compareRead(result: string, disk: string): DiskCompare {
  const read = readLines(result)
  if (read === null) {
    return 'unknown'
  }
  const fileLines = disk.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < read.lines.length; i += 1) {
    const shown = read.lines[i]!
    const now = fileLines[read.first - 1 + i]
    if (now === undefined) {
      if (shown === '') {
        continue
      }

      return 'changed'
    }
    // A long line the tool may have cut cannot be compared: skip it.
    if (shown === now || shown.length >= LONG_LINE) {
      continue
    }

    return 'changed'
  }

  return 'same'
}
