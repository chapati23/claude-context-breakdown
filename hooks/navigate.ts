// Moves between the pane's levels. Each move reads what it needs through
// closures a hook hands over (the engine wants `$` spelled at the call site)
// and stores only the visible page of the result.

import type { SessionUsage } from 'claude-code'

import type {
  ContextBreakdownContent,
  ContextBreakdownFormat,
  ContextBreakdownList,
  ContextBreakdownListId,
  ContextBreakdownPlace,
  ContextBreakdownSnapshot,
  ContextBreakdownSort,
  ContextBreakdownSource,
  ContextBreakdownView,
} from '../types'
import type { MessageLike } from './classify'
import { NO_ITEMS, buildItems, isBaseline, listOf, opens, pageOf, placeOf } from './items'
import type { Item, ItemBreakdown, ItemData, ItemSet } from './items'
import { defaultFormat, formattedSource, mappedLine, markdownPages, pageAtLine } from './markdown'
import { compareFile, compareRead } from './reminder'
import { NOT_LOADED, isSegmentList } from './segments'
import { displayText, firstWords, newlines, pageLines, textPage } from './text'

export const LEVEL_1: ContextBreakdownView = { seq: 0, gen: 0, level: 1 }

/** The level-1 line when an open item is no longer in the context. */
export const GONE_NOTE = 'The item that was open is no longer in the context.'

/** The level-1 line when every item of an open list left the context. */
export const ITEMS_GONE_NOTE = 'The items that were open are no longer in the context.'

/** The level-1 line for a `/ctx` word that names no segment. */
export function noMatchNote(word: string): string {
  return `No segment matches "${firstWords(word, 40)}".`
}

/** The engine calls a move makes, bound by the hook that asks. */
export type NavIo = {
  usage: () => Promise<SessionUsage>
  messages: () => Promise<readonly MessageLike[]>
  snapshot: () => Promise<ContextBreakdownSnapshot | null>
  view: () => Promise<ContextBreakdownView>
  write: (fn: (previous: ContextBreakdownView) => ContextBreakdownView) => Promise<unknown>
  /** `$.fs.read`: only when the person opens or pages an item with a file. */
  readFile: (path: string) => Promise<string>
}

/** Reads the breakdown and the messages; an unreadable part is null. */
async function gather(io: NavIo): Promise<ItemData> {
  const [usage, messages, snapshot] = await Promise.all([
    io.usage().catch(() => null),
    io.messages().catch(() => null),
    io.snapshot().catch(() => null),
  ])

  return {
    breakdown: (usage?.context.breakdown as ItemBreakdown | undefined) ?? null,
    messages,
    charsPerToken: snapshot?.charsPerToken ?? null,
    segments: snapshot?.conversation ?? null,
  }
}

/**
 * What a commit did: wrote; lost to a later press (`superseded`); or found
 * the view rebuilt from newer messages than the move read (`stale`).
 */
type Outcome = 'written' | 'superseded' | 'stale'

/**
 * Writes `next` unless the view moved on since `base` was read: the later
 * press wins over a slow earlier one, and data older than a rebuild is not
 * written.
 */
async function commit(io: NavIo, base: ContextBreakdownView, next: ContextBreakdownView): Promise<Outcome> {
  // `update` may run the change again on a version miss; the last run counts.
  let outcome: Outcome = 'superseded'
  await io.write(previous => {
    if (previous.seq !== base.seq) {
      outcome = 'superseded'

      return previous
    }
    if (previous.gen !== base.gen) {
      outcome = 'stale'

      return previous
    }
    outcome = 'written'

    return { ...next, seq: base.seq + 1, gen: base.gen } as ContextBreakdownView
  })

  return outcome
}

/** Runs a move again while a rebuild replaced the data it read; a few tries. */
async function retried(move: () => Promise<Outcome | null>): Promise<void> {
  for (let tries = 0; tries < 3; tries += 1) {
    if ((await move()) !== 'stale') {
      return
    }
  }
}

function listOfView(view: ContextBreakdownView): ContextBreakdownList | null {
  return view.level === 1 ? null : view.list
}

// Pure moves on the stored view.

/** Level 1. */
export function toLevel1(view: ContextBreakdownView): ContextBreakdownView {
  return { seq: view.seq + 1, gen: view.gen, level: 1 }
}

/** Level 1 with a line that says why; the next move clears it. */
export function toLevel1With(note: string): (view: ContextBreakdownView) => ContextBreakdownView {
  return view => ({ seq: view.seq + 1, gen: view.gen, level: 1, note })
}

/**
 * Level 1 after a /clear: an open list or item of the conversation says it
 * left the context. A baseline segment's items stay in the context, and the
 * servers that are not loaded were never in it, so their list or item goes
 * back with no note.
 */
export function afterClear(view: ContextBreakdownView): ContextBreakdownView {
  if (view.level === 1 || !isSegmentList(view.list.segment) || isBaseline(view.list.segment)) {
    return toLevel1(view)
  }

  return toLevel1With(view.level === 2 ? ITEMS_GONE_NOTE : GONE_NOTE)(view)
}

/**
 * One level back: an item to its list, a list to the segments. The row it
 * came from is kept, so the ring goes back to it.
 */
export function back(view: ContextBreakdownView): ContextBreakdownView {
  if (view.level === 3) {
    return { seq: view.seq + 1, gen: view.gen, level: 2, list: view.list, from: view.item.id }
  }
  if (view.level === 2) {
    return { seq: view.seq + 1, gen: view.gen, level: 1, from: view.list.segment }
  }

  return toLevel1(view)
}

/**
 * The view after a new measurement: a list rebuilt from the new items, an
 * item kept only while it still exists (else level 1), so nothing gone shows.
 * It counts a new generation, so a move that read the old messages retries.
 */
export function rebuildView(view: ContextBreakdownView, data: ItemData): ContextBreakdownView {
  if (view.level === 1) {
    return view
  }
  const gen = view.gen + 1
  const set = buildItems(view.list.segment, data)
  const list = listOf(view.list.segment, set, view.list.sort, view.list.page)
  if (view.level === 2) {
    // No server has tools that are not loaded any more: the list would be
    // empty, so the segments show instead.
    if (view.list.segment === NOT_LOADED && set.items.length === 0) {
      return { seq: view.seq, gen, level: 1 }
    }
    // Every item it listed left the context (a compaction, a /clear): an
    // empty list would read as "~0 · No items", so say what happened. A list
    // that could not be read keeps its own note.
    if (view.list.items > 0 && set.items.length === 0 && set.note === NO_ITEMS) {
      return { seq: view.seq, gen, level: 1, note: ITEMS_GONE_NOTE }
    }
    // The row that took the ring before the rebuild keeps it (`from`, which
    // `ringKey` reads): a new item first would take it otherwise, and a
    // desktop moves the focus to it while the person is elsewhere.
    const ids = view.list.rows.filter(row => row.isOpenable).map(row => row.id)
    const from = view.from !== undefined && ids.includes(view.from) ? view.from : ids[0]

    return { ...view, gen, list, ...(from === undefined ? {} : { from }) }
  }
  const item = set.items.find(one => one.id === view.item.id)
  if (item === undefined) {
    return { seq: view.seq, gen, level: 1, note: GONE_NOTE }
  }

  // A new item can push the open one to another page, or change its place.
  const held = heldBy(view.list.segment, set, view.list.sort, item.id, view.list.page)

  return { ...view, gen, ...held, item: { ...view.item, tokens: item.tokens } }
}

/**
 * Level 3's list and place for the item `id`: the page of the list that
 * holds the item, so b puts the ring on its row, and where the item stands
 * (`placeOf`). Without the item in the set, the list at `page` and no place.
 */
function heldBy(
  segment: ContextBreakdownListId,
  set: ItemSet,
  sort: ContextBreakdownSort,
  id: string,
  page: number,
): { list: ContextBreakdownList; place?: ContextBreakdownPlace } {
  const place = placeOf(segment, set, sort, id)
  if (place === null) {
    return { list: listOf(segment, set, sort, page) }
  }

  return { list: listOf(segment, set, sort, pageOf(place)), place }
}

// Content of level 3.

type Resolved = {
  /** The as-loaded text, or null when the conversation does not hold it. */
  loaded: string | null
  /** The file now, or null when there is none or it could not be read. */
  disk: string | null
  isDiskRead: boolean
}

async function resolveText(io: NavIo, item: Item, wantsDisk: boolean): Promise<Resolved> {
  const loaded = item.loaded?.() ?? null
  if (item.path === null || item.disk === null || !wantsDisk) {
    return { loaded, disk: null, isDiskRead: false }
  }
  let disk: string | null = null
  try {
    disk = await io.readFile(item.path)
  } catch {
    disk = null
  }

  return { loaded, disk, isDiskRead: true }
}

/** Whether the file changed since it was loaded; false whenever unsure. */
export function isChangedOnDisk(item: Pick<Item, 'disk'>, loaded: string | null, disk: string | null): boolean {
  if (loaded === null || disk === null || item.disk === null) {
    return false
  }

  return (item.disk === 'read' ? compareRead(loaded, disk) : compareFile(loaded, disk)) === 'changed'
}

/**
 * Where a view opens: a page of it, or the place a page of the other view
 * shows (its first line, `line` of `lines`), so a switch keeps the place.
 */
type Place = number | { line: number; lines: number }

/** One page of one view; `startLine`, `endLine` and `lines` count that view's own lines. */
type ViewPage = { page: number; pages: number; text: string; startLine: number; endLine: number; lines: number }

/**
 * One page of one view: `text` is the raw display text, `own` the text the
 * formatted view is made from (the same, except for Claude's reply).
 */
function viewPage(
  item: Item,
  text: string,
  own: string,
  source: ContextBreakdownSource,
  format: ContextBreakdownFormat,
  place: Place,
): ViewPage {
  if (format === 'raw') {
    const lines = text.split('\n').length
    const page = typeof place === 'number' ? place : pageAtLine(pageLines(text), mappedLine(place.line, place.lines, lines))

    return { ...textPage(text, page), lines }
  }
  const markdown = formattedSource(item, source, own)
  const lines = markdown.split('\n').length
  const pages = markdownPages(markdown)
  const wanted =
    typeof place === 'number'
      ? place
      : pageAtLine(
          pages.map(one => one.startLine),
          mappedLine(place.line, place.lines, lines),
        )
  const index = Math.min(Math.max(0, Math.floor(wanted)), pages.length - 1)
  const shown = pages[index]!

  return { page: index, pages: pages.length, text: shown.text, startLine: shown.startLine, endLine: shown.endLine, lines }
}

/** The lines a raw page counts: a last newline ends the last line, as a page drops it. */
function rawLines(text: string): number {
  return newlines(text.replace(/\n$/, '')) + 1
}

/** Where a page of either view lies in the raw view's lines of `raw`. */
function lineRange(page: ViewPage, format: ContextBreakdownFormat, raw: string) {
  const lines = rawLines(raw)
  if (format === 'raw') {
    return { firstLine: page.startLine, lastLine: page.endLine, lines }
  }

  return {
    firstLine: mappedLine(page.startLine, page.lines, lines),
    lastLine: mappedLine(page.endLine, page.lines, lines),
    lines,
  }
}

/**
 * The stored page of an item's text for one source and view; without a
 * view, the item's default. When `from` names a page of the other view, the
 * page shown is the one that holds the line at `share` of that page (its
 * first line by default), and `page` is unused.
 */
export function contentOf(
  item: Item,
  resolved: Resolved,
  source: ContextBreakdownSource,
  page: number,
  isChanged: boolean,
  format?: ContextBreakdownFormat,
  from?: { format: ContextBreakdownFormat; page: number; share?: number },
): ContextBreakdownContent {
  const view = format ?? defaultFormat(item)
  const canToggle = item.disk !== null && item.path !== null && resolved.loaded !== null
  // Without the as-loaded text, a file is shown from disk.
  const shown: ContextBreakdownSource = resolved.loaded === null && item.disk !== null ? 'disk' : source
  const raw = shown === 'disk' ? resolved.disk : resolved.loaded
  let note: string | null = null
  if (shown === 'disk' && resolved.loaded === null) {
    note =
      item.missing ??
      (item.disk === 'memory'
        ? 'Not found in the conversation’s opening reminder: shown from disk.'
        : 'The conversation holds no text for it: shown from disk.')
  }
  if (shown === 'disk' && raw === null) {
    note = 'The file could not be read.'
  }
  const shownText = displayText(raw ?? '')
  // Claude's reply has a Markdown form of its own; a file on disk is itself.
  const hasOwn = shown === 'loaded' && item.formatted !== undefined && (view === 'formatted' || from?.format === 'formatted')
  const own = hasOwn ? displayText(item.formatted!()) : shownText
  let place: Place = page
  if (from !== undefined && from.format !== view) {
    const before = viewPage(item, shownText, own, shown, from.format, from.page)
    const line = Math.round(before.startLine + (from.share ?? 0) * (before.endLine - before.startLine))
    place = { line, lines: before.lines }
  }
  const text = viewPage(item, shownText, own, shown, view, place)
  // A Read result as loaded numbers its own lines: no gutter, no highlighter.
  const isNumbered = shown === 'loaded' && item.isNumbered
  // Colour by the file's type only where the text is the file's own; an Edit
  // or Write result is a sentence about the file.
  const isFileText = shown === 'disk' || item.disk === 'memory'

  return {
    id: item.id,
    title: item.detail === '' ? item.title : `${item.title}  ${item.detail}`,
    tokens: item.tokens,
    path: item.path,
    source: shown,
    canToggle,
    isChanged,
    note,
    format: view,
    page: text.page,
    pages: text.pages,
    ...lineRange(text, view, shownText),
    startLine: isNumbered || view === 'formatted' ? null : text.startLine,
    text: text.text,
    language: isFileText ? item.path : null,
    notice: null,
    atEnd: false,
  }
}

// Moves that read the conversation, the breakdown or a file.

/**
 * Level 2 for a segment, or the servers that are not loaded, from its first
 * page, largest first. With no server, level 1 shows instead, with `none` as
 * its note when it is given (`/ctx not` names a list that is empty).
 */
export function openSegment(io: NavIo, segment: ContextBreakdownListId, none?: string): Promise<void> {
  return retried(async () => {
    const base = await io.view()
    const set = buildItems(segment, await gather(io))
    if (segment === NOT_LOADED && set.items.length === 0) {
      return commit(io, base, { seq: base.seq, gen: base.gen, level: 1, ...(none === undefined ? {} : { note: none }) })
    }

    return commit(io, base, { seq: base.seq, gen: base.gen, level: 2, list: listOf(segment, set, 'size', 0) })
  })
}

/**
 * Whether a list still keeps the focus where the person put it, after the
 * view went from `before` to `after`: `kept`, the answer so far, holds only
 * while the same segment's list stays open. A new level or another segment
 * ends it. Read off the terminal only (register.tsx, `staysOnControl`).
 */
export function keepsFocus(before: ContextBreakdownView, after: ContextBreakdownView, kept: boolean): boolean {
  return kept && before.level === 2 && after.level === 2 && before.list.segment === after.list.segment
}

/** Which row of a new page takes the focus ring: its first or its last that opens. */
export type RingAt = 'first' | 'last'

/** The list again, with another sort or page; `at` puts the ring on the new page's first or last row. */
function relist(io: NavIo, change: (list: ContextBreakdownList) => { sort: ContextBreakdownSort; page: number }, at?: RingAt) {
  return retried(async () => {
    const base = await io.view()
    const list = listOfView(base)
    if (list === null) {
      return null
    }
    const { sort, page } = change(list)
    const set = buildItems(list.segment, await gather(io))
    const next = listOf(list.segment, set, sort, page)
    const ids = next.rows.filter(row => row.isOpenable).map(row => row.id)
    const from = at === undefined ? undefined : at === 'first' ? ids[0] : ids[ids.length - 1]

    return commit(io, base, { seq: base.seq, gen: base.gen, level: 2, list: next, ...(from === undefined ? {} : { from }) })
  })
}

/** Largest first and newest first; for the servers that are not loaded, largest first and most tools first. */
export function toggleSort(io: NavIo): Promise<void> {
  return relist(io, list => ({ sort: list.sort !== 'size' ? 'size' : list.segment === NOT_LOADED ? 'tools' : 'newest', page: 0 }))
}

/** Another page of the list; `at`: j or k crossed into it, so its first or last row takes the ring. */
export function listPage(io: NavIo, delta: number, at?: RingAt): Promise<void> {
  return relist(io, list => ({ sort: list.sort, page: list.page + delta }), at)
}

/** Finds the item again in a fresh build; level 1, with a note, when it is gone. */
async function findItem(
  io: NavIo,
  base: ContextBreakdownView,
  list: ContextBreakdownList,
  id: string,
): Promise<{ item: Item; set: ItemSet } | Outcome> {
  const set = buildItems(list.segment, await gather(io))
  const item = set.items.find(one => one.id === id)
  if (item === undefined) {
    return commit(io, base, { seq: base.seq, gen: base.gen, level: 1, note: GONE_NOTE })
  }

  return { item, set }
}

/**
 * Level 3 for `item` of `list` in the fresh `set`: as loaded, first page,
 * in the item's own default view. Null for an item with no text to show.
 */
async function opened(
  io: NavIo,
  base: ContextBreakdownView,
  list: ContextBreakdownList,
  set: ItemSet,
  item: Item,
): Promise<Outcome | null> {
  if (!opens(item)) {
    return null
  }
  const resolved = await resolveText(io, item, true)
  const isChanged = isChangedOnDisk(item, resolved.loaded, resolved.disk)

  return commit(io, base, {
    seq: base.seq,
    gen: base.gen,
    level: 3,
    ...heldBy(list.segment, set, list.sort, item.id, list.page),
    item: contentOf(item, resolved, 'loaded', 0, isChanged),
  })
}

/** Level 3 for an item of the open list, as loaded, first page. */
export function openItem(io: NavIo, id: string): Promise<void> {
  return retried(async () => {
    const base = await io.view()
    const list = listOfView(base)
    if (list === null) {
      return null
    }
    const found = await findItem(io, base, list, id)
    if (typeof found === 'string') {
      return found
    }

    return opened(io, base, list, found.set, found.item)
  })
}

/**
 * The next item that opens (`delta` 1) or the previous one (-1), in the
 * list's order, across its pages: n and p at the end of an item. The order
 * comes from a fresh build at the press, not from the stored place, which a
 * measurement since may have made stale. Nothing at the list's end.
 */
export function stepItem(io: NavIo, delta: number): Promise<void> {
  return retried(async () => {
    const base = await io.view()
    if (base.level !== 3) {
      return null
    }
    const found = await findItem(io, base, base.list, base.item.id)
    if (typeof found === 'string') {
      return found
    }
    const place = placeOf(base.list.segment, found.set, base.list.sort, base.item.id)
    const id = delta > 0 ? place?.next : place?.prev
    const item = found.set.items.find(one => one.id === id)
    if (item === undefined) {
      return null
    }

    return opened(io, base, base.list, found.set, item)
  })
}

/** The open item again: another page, source or view; `isFresh` compares again. */
function reopen(
  io: NavIo,
  change: (item: ContextBreakdownContent) => {
    source: ContextBreakdownSource
    page: number
    format?: ContextBreakdownFormat
    /** Where in the page the window stands, 0 to 1: a switch of view opens the page that shows it. */
    share?: number
    /** The page opens at its end (k crossed back into it). */
    atEnd?: boolean
  },
  isFresh = false,
): Promise<void> {
  return retried(async () => {
    const base = await io.view()
    if (base.level !== 3) {
      return null
    }
    const found = await findItem(io, base, base.list, base.item.id)
    if (typeof found === 'string') {
      return found
    }
    const { source, page, format = base.item.format, share = 0, atEnd = false } = change(base.item)
    const resolved = await resolveText(io, found.item, isFresh || source === 'disk')
    const isChanged = isFresh ? isChangedOnDisk(found.item, resolved.loaded, resolved.disk) : base.item.isChanged
    const held = heldBy(base.list.segment, found.set, base.list.sort, base.item.id, base.list.page)
    // A switch of view on the same source keeps the place, not the page number.
    const from = source === base.item.source ? { format: base.item.format, page: base.item.page, share } : undefined
    const item = { ...contentOf(found.item, resolved, source, page, isChanged, format, from), atEnd }

    return commit(io, base, { ...base, ...held, item })
  })
}

/** Another page; `atEnd` when k crossed back into the previous one, which then opens at its end. */
export function contentPage(io: NavIo, delta: number, atEnd = false): Promise<void> {
  return reopen(io, item => ({ source: item.source, page: item.page + delta, atEnd }))
}

export function toggleSource(io: NavIo): Promise<void> {
  return reopen(io, item => ({ source: item.source === 'loaded' ? 'disk' : 'loaded', page: 0 }))
}

/**
 * Formatted to raw and back; the page shown holds the line the window showed,
 * at `share` of the last page (0, its top, when the window is not known).
 */
export function toggleFormat(io: NavIo, share = 0): Promise<void> {
  return reopen(io, item => ({
    source: item.source,
    page: item.page,
    format: item.format === 'formatted' ? 'raw' : 'formatted',
    share,
  }))
}

/** After `r` measured: level 3 reads its text and the file again. */
export function refreshItem(io: NavIo): Promise<void> {
  return reopen(io, item => ({ source: item.source, page: item.page, atEnd: item.atEnd }), true)
}

/** Shows the answer of a copy or a mention on the open item. */
export async function notice(io: NavIo, text: string): Promise<void> {
  await io.write(previous =>
    previous.level === 3 ? { ...previous, item: { ...previous.item, notice: text } } : previous,
  )
}

/** The text `m` puts in the prompt: `@path`, quoted when it holds a space. */
export function mention(path: string): string {
  return /\s/.test(path) ? `@"${path}" ` : `@${path} `
}
