// Moves between the pane's levels. Each move reads what it needs through
// closures a hook hands over (the engine wants `$` spelled at the call site)
// and stores only the visible page of the result.

import type { SessionUsage } from 'claude-code'

import type {
  ContextBreakdownContent,
  ContextBreakdownList,
  ContextBreakdownSegmentId,
  ContextBreakdownSnapshot,
  ContextBreakdownSort,
  ContextBreakdownSource,
  ContextBreakdownView,
} from '../types'
import type { MessageLike } from './classify'
import { buildItems, listOf } from './items'
import type { Item, ItemBreakdown, ItemData, ItemSet } from './items'
import { compareFile, compareRead } from './reminder'
import { displayText, textPage } from './text'

export const LEVEL_1: ContextBreakdownView = { seq: 0, gen: 0, level: 1 }

/** The level-1 line when an open item is no longer in the context. */
export const GONE_NOTE = 'The item that was open is no longer in the context.'

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

/** One level back: an item to its list, a list to the segments. */
export function back(view: ContextBreakdownView): ContextBreakdownView {
  if (view.level === 3) {
    return { seq: view.seq + 1, gen: view.gen, level: 2, list: view.list }
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
    return { ...view, gen, list }
  }
  const item = set.items.find(one => one.id === view.item.id)
  if (item === undefined) {
    return { seq: view.seq, gen, level: 1, note: GONE_NOTE }
  }

  return { ...view, gen, list, item: { ...view.item, tokens: item.tokens } }
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

/** The stored page of an item's text for one source. */
export function contentOf(
  item: Item,
  resolved: Resolved,
  source: ContextBreakdownSource,
  page: number,
  isChanged: boolean,
): ContextBreakdownContent {
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
  const text = textPage(displayText(raw ?? ''), page)
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
    page: text.page,
    pages: text.pages,
    startLine: isNumbered ? null : text.startLine,
    text: text.text,
    language: isFileText ? item.path : null,
    notice: null,
  }
}

// Moves that read the conversation, the breakdown or a file.

/** Level 2 for a segment, from its first page, largest first. */
export function openSegment(io: NavIo, segment: ContextBreakdownSegmentId): Promise<void> {
  return retried(async () => {
    const base = await io.view()
    const set = buildItems(segment, await gather(io))

    return commit(io, base, { seq: base.seq, gen: base.gen, level: 2, list: listOf(segment, set, 'size', 0) })
  })
}

/** The list again, with another sort or page. */
function relist(io: NavIo, change: (list: ContextBreakdownList) => { sort: ContextBreakdownSort; page: number }) {
  return retried(async () => {
    const base = await io.view()
    const list = listOfView(base)
    if (list === null) {
      return null
    }
    const { sort, page } = change(list)
    const set = buildItems(list.segment, await gather(io))

    return commit(io, base, { seq: base.seq, gen: base.gen, level: 2, list: listOf(list.segment, set, sort, page) })
  })
}

export function toggleSort(io: NavIo): Promise<void> {
  return relist(io, list => ({ sort: list.sort === 'size' ? 'newest' : 'size', page: 0 }))
}

export function listPage(io: NavIo, delta: number): Promise<void> {
  return relist(io, list => ({ sort: list.sort, page: list.page + delta }))
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
    const { item, set } = found
    if (item.loaded === null && item.disk === null) {
      return null
    }
    const resolved = await resolveText(io, item, true)
    const isChanged = isChangedOnDisk(item, resolved.loaded, resolved.disk)

    return commit(io, base, {
      seq: base.seq,
      gen: base.gen,
      level: 3,
      list: listOf(list.segment, set, list.sort, list.page),
      item: contentOf(item, resolved, 'loaded', 0, isChanged),
    })
  })
}

/** The open item again: another page or source; `isFresh` compares again. */
function reopen(
  io: NavIo,
  change: (item: ContextBreakdownContent) => { source: ContextBreakdownSource; page: number },
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
    const { source, page } = change(base.item)
    const resolved = await resolveText(io, found.item, isFresh || source === 'disk')
    const isChanged = isFresh ? isChangedOnDisk(found.item, resolved.loaded, resolved.disk) : base.item.isChanged
    const list = listOf(base.list.segment, found.set, base.list.sort, base.list.page)

    return commit(io, base, { ...base, list, item: contentOf(found.item, resolved, source, page, isChanged) })
  })
}

export function contentPage(io: NavIo, delta: number): Promise<void> {
  return reopen(io, item => ({ source: item.source, page: item.page + delta }))
}

export function toggleSource(io: NavIo): Promise<void> {
  return reopen(io, item => ({ source: item.source === 'loaded' ? 'disk' : 'loaded', page: 0 }))
}

/** After `r` measured: level 3 reads its text and the file again. */
export function refreshItem(io: NavIo): Promise<void> {
  return reopen(io, item => ({ source: item.source, page: item.page }), true)
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
