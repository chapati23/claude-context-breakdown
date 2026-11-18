// j and k: the pane's body one row down or up, and on to the next or the
// previous page at a page's edge. Level 3 uses this on the terminal only:
// elsewhere j and k there move where the text starts (lines.ts).
//
// `$.ui.scroll` takes no row number, only a thing to reveal. So a press asks
// for the pane's `start`, and this mod's own `ui.scroll` hook rewrites the
// offset the engine resolved to the row after (or before) the one the window
// shows. The engine hands that hook its own window (`offset - by`), so a step
// continues from wherever the wheel or the arrows left it. The same numbers
// say when the window already stands at the bottom (or the top), or the tree
// fits whole: the step then asks for the next (or the previous) page.
//
// The call must come from a registered `ui.press` hook, not from a Button's
// onPress: the engine leaves out every hook of a plugin for an event that
// plugin's own unframed code raised, so this mod's `ui.scroll` hook would
// never see a scroll that onPress asked for.
//
// That link is not proven outside a live session. Each step therefore says
// whether the hook saw it (`seen`). Once a step moved the window without the
// hook, a press asks for no scroll at all: without the hook, a step to
// `start` would jump to the top. The wheel and the arrows need no hook.
//
// The engine's own window can lag behind (seen on the desktop app, where the
// window lives in another process): a quick second press then reads a row
// between the one the first press started from and the one it went to. So a
// step continues from the mod's own last target while the engine still
// reports a row on that way (`last` in `Steps`). The render props do not end
// that: they can show the target before the engine's own row has caught up.
// A row off that way, a new tree, or any scroll that is not a step (the
// person's wheel, arrows and page keys too) ends it, so those always win.
//
// The engine also keeps a pane's window across a new tree (it only clamps
// it), so a page or level change asks for `TOP_SCROLL` itself. It also
// brings the focus ring into view on a new tree, so the ring starts where the
// window should be: above the text, or under it after k crossed back
// (pane.tsx, `ringKey`). A switch of
// view (f) instead reads where the window stands (`measure`) and puts it at
// the same place in the other view (`place`), by the same hook.

import { PANE_ID } from './state'

/** The keys of the two Buttons at level 3, as the `ui.press` hook matches them. */
export const SCROLL_DOWN = 'scroll-down'
export const SCROLL_UP = 'scroll-up'

/**
 * The same two Buttons at levels 1 and 2, under keys of their own. After an
 * open, `$.ui.focus` asks for level 3's first control. While the old tree
 * still holds an element under that key, the ring goes there, and the new
 * tree puts it on whatever stands at that place: the ring seen live on k, on
 * n or nowhere fits that. A key the old tree lacks makes the engine wait for
 * the new tree (the declarations of `UiFocusArgs.key`).
 */
export const LIST_DOWN = 'list-down'
export const LIST_UP = 'list-up'

/** What a step asks `$.ui.scroll` for; the `ui.scroll` hook then moves it one row. */
export const STEP_SCROLL = { in: PANE_ID, to: 'start' } as const

/** The top of the pane, for a page, view or level change. */
export const TOP_SCROLL = { in: PANE_ID, to: 'start' } as const

/**
 * The bottom of the pane, for k into the previous page. `end` also follows
 * the tree while it grows, until the next move: that keeps the bottom while
 * the new page is drawn, and a level-3 tree does not grow after that, so the
 * follow does no harm.
 */
export const END_SCROLL = { in: PANE_ID, to: 'end' } as const

/** Rows a press of the Button keyed `element` moves: 1 down, -1 up, 0 for any other. */
export function stepOf(element: string): number {
  return element === SCROLL_DOWN || element === LIST_DOWN ? 1 : element === SCROLL_UP || element === LIST_UP ? -1 : 0
}

/** The numbers of a `ui.scroll` event this mod reads. */
export type ScrollWindow = {
  /** Where the engine resolved the move to. */
  offset: number
  /** How far that is from where the window stands. */
  by: number
  bodyRows: number
  contentRows: number
}

/** The window's last offset: 0 when the tree fits. */
function lastOffset(window: ScrollWindow): number {
  return Math.max(0, window.contentRows - window.bodyRows)
}

/** Where the window stands, as a share of its last offset: 0 at the top, 1 at the bottom. */
export function shareOf(window: ScrollWindow): number {
  const last = lastOffset(window)
  const standing = window.offset - window.by

  return last === 0 ? 0 : Math.min(1, Math.max(0, standing / last))
}

/** The lines a page shows, in the raw view's lines, as the stored item gives them. */
export type LineSpan = { firstLine: number; lastLine: number }

/**
 * The share of the new page's tree that shows the line the window showed at
 * `share` of the old page's tree. Lines stand in for rows: both views count
 * the raw view's lines, and rows are not known before the tree is drawn.
 */
export function shareAcross(before: LineSpan, share: number, after: LineSpan): number {
  const line = before.firstLine + share * (before.lastLine - before.firstLine)
  const span = after.lastLine - after.firstLine

  return span <= 0 ? 0 : Math.min(1, Math.max(0, (line - after.firstLine) / span))
}

/** Where the engine says the window stands before a scroll. */
export function standingOf(window: ScrollWindow): number {
  return window.offset - window.by
}

/**
 * The offset one step moves the window to: one row past `from`, clamped to
 * the tree. `from` is where the window stands, unless the mod knows better.
 */
export function stepOffset(window: ScrollWindow, step: number, from = standingOf(window)): number {
  const wanted = Math.round(from + step)

  return Math.min(lastOffset(window), Math.max(0, wanted))
}

/** Which page a step asks for: the next from the bottom (or a tree that fits), the previous from the top. */
export type Crossing = 'next' | 'prev' | null

/** Whether a step from `from` crosses a page's edge; `from` as for `stepOffset`. */
export function crossingOf(window: ScrollWindow, step: number, from = standingOf(window)): Crossing {
  if (step > 0 && from >= lastOffset(window)) {
    return 'next'
  }
  if (step < 0 && from <= 0) {
    return 'prev'
  }

  return null
}

/**
 * The page move a crossing makes on an item of `pages` pages that shows
 * `page`: 1 or -1, or 0 when there is no page that way.
 */
export function crossDelta(cross: Crossing, page: number, pages: number): number {
  const delta = cross === 'next' ? 1 : cross === 'prev' ? -1 : 0

  return page + delta >= 0 && page + delta < pages ? delta : 0
}

/** Where the window goes on the page a step crossed into: the next page's top, the previous page's bottom. */
export function crossScroll(delta: number): typeof TOP_SCROLL | typeof END_SCROLL {
  return delta > 0 ? TOP_SCROLL : END_SCROLL
}

/**
 * What one scroll of ours is for: a j or k `step`; a `probe`, a scroll to the
 * top that only tells whether the hook runs; a `measure`, which reads where
 * the window stands and leaves it there; a `place`, which puts the window at
 * a share of its tree.
 */
export type StepKind = 'step' | 'probe' | 'measure' | 'place'

/**
 * One scroll of ours under way. The hook fills `seen`, `cross` (a step at a
 * page's edge) and, for a measure, `share` when it takes the token.
 */
export type StepToken = { readonly step: number; readonly kind: StepKind; share: number; seen: boolean; cross: Crossing }

/**
 * The rows the window has been asked through since the engine last agreed
 * with us: `lo` and `hi`, the smallest and largest of every row the engine
 * reported and every target since the lag began, and `to`, the last target.
 * A lagging engine reports a row from `lo` to `hi`.
 */
export type LastStep = { lo: number; hi: number; to: number }

/**
 * The scrolls of ours the engine has not raised yet, oldest first. A press
 * adds one and drops it when its call settles, so a call the engine refused
 * leaves nothing for a later scroll to pick up.
 *
 * `last` is the range of the steps under lag, until the engine reports a row
 * off it (`stepBase`) or a new tree or another scroll moves the window (`forget`).
 */
export type Steps = {
  push: (step: number, kind?: StepKind, share?: number) => StepToken
  take: () => StepToken | undefined
  drop: (token: StepToken) => void
  size: () => number
  last: () => LastStep | null
  setLast: (move: LastStep | null) => void
  /** A new tree or a scroll that is not a step: no step to continue from. */
  forget: () => void
}

/**
 * Where a step starts. The engine's row, unless it reports a row inside the
 * range of the steps under lag and not yet their last target: then the engine
 * lags, and the step continues from that target. A row off the range means
 * something else moved the window: it wins.
 */
export function stepBase(standing: number, last: LastStep | null): number {
  if (last === null || standing === last.to) {
    return standing
  }

  return standing >= last.lo && standing <= last.hi ? last.to : standing
}

/**
 * The record after a step from the engine's row `standing` to `to`. A row
 * inside the range is lag: the range grows to take in the row and the target.
 * The engine at the last target (the lag is over) or a row off the range
 * (something else moved the window) starts the range again at that row.
 */
export function nextStep(standing: number, last: LastStep | null, to: number): LastStep {
  const isLag = last !== null && standing !== last.to && standing >= last.lo && standing <= last.hi
  const lo = isLag ? Math.min(last.lo, standing) : standing
  const hi = isLag ? Math.max(last.hi, standing) : standing

  return { lo: Math.min(lo, to), hi: Math.max(hi, to), to }
}

export function createSteps(): Steps {
  const queue: StepToken[] = []
  let last: LastStep | null = null

  return {
    push: (step, kind = 'step', share = 0) => {
      const token: StepToken = { step, kind, share, seen: false, cross: null }
      queue.push(token)

      return token
    },
    take: () => queue.shift(),
    drop: token => {
      const index = queue.indexOf(token)
      if (index !== -1) {
        queue.splice(index, 1)
      }
    },
    size: () => queue.length,
    last: () => last,
    setLast: move => {
      last = move
    },
    forget: () => {
      last = null
    },
  }
}

/**
 * Runs presses one after the other, at most `depth` at once (one running,
 * the rest waiting). The engine reads where the window stands when
 * `$.ui.scroll` is called, so two calls in flight would both step from the
 * same row. A press past `depth` is dropped (null), so a held key that
 * outruns the round trip stops when it is released, with no backlog.
 */
export type Lane = { run: <T>(work: () => Promise<T>) => Promise<{ value: T } | null> }

export function createLane(depth: number): Lane {
  let tail: Promise<unknown> = Promise.resolve()
  let held = 0

  return {
    run: <T>(work: () => Promise<T>) => {
      if (held >= depth) {
        return Promise.resolve(null)
      }
      held += 1
      const turn = tail.then(work).finally(() => {
        held -= 1
      })
      // A failed press does not stop the next one.
      tail = turn.catch(() => undefined)

      return turn.then(value => ({ value }))
    },
  }
}

/**
 * Whether this mod's `ui.scroll` hook sees the scrolls its press hook asks
 * for: not known yet, seen, or not seen (a scroll moved the window without it).
 */
export type Link = 'unknown' | 'works' | 'absent'

/**
 * What one settled scroll of ours says about the link. A seen token proves
 * it. An unseen scroll that the engine answered `{}` disproves it only when
 * it had to move the window: a step or a measure (both resolved to `start`)
 * while the window stood below the top. `standing` is the offset the pane's
 * render hook last read. A probe, a window at the top, or a refused or failed
 * call (`answer` null) says nothing: the engine may answer `{}` without
 * raising the event when the window is already where it asked.
 *
 * The same holds for the retry to `end` (`needsRetry`): seen, it proves the
 * link; unseen and answered `{}` from below the top, it disproves it. From
 * the top it says nothing, as a tree that fits the window has its end there.
 */
export function learnLink(link: Link, token: StepToken, answer: { deny?: string } | null, standing: number): Link {
  // Once proven, an unseen scroll does not undo it: on the desktop a quick
  // press can find the engine's window behind, and `start` then moves nothing.
  if (token.seen || link === 'works') {
    return 'works'
  }
  const hadToMove = (token.kind === 'step' || token.kind === 'measure') && standing > 0

  return hadToMove && answer !== null && answer.deny === undefined ? 'absent' : link
}

/**
 * What the press hooks know of the pane's window between drawings: whether
 * the hook sees our scrolls (`link`), and the window's offset as the render
 * hook last read it (`shown`), for `learnLink`. Hints only, never drawn from.
 */
export type PaneScroll = { link: Link; shown: number }

export function createPaneScroll(): PaneScroll {
  return { link: 'unknown', shown: 0 }
}

/**
 * A new tree asks for its top. No step to continue from, and the offset is
 * the top's from now on: a quick press before the next drawing must not read
 * the old tree's offset and conclude the link is absent. The link stays as
 * it is: a step at the top of the new tree proves nothing, and a proven link
 * must still ask again for `end` (`needsRetry`).
 */
export function atNewTop(pane: PaneScroll, steps: Steps): void {
  steps.forget()
  pane.shown = 0
}

/**
 * Whether a settled step should ask again, once, for the pane's `end`. The
 * hook did not see it, yet the engine answered `{}`: the engine believed the
 * window already stood at `start`, so it raised no event. `end` resolves to
 * another row, so the engine raises the event and the hook moves it one row.
 *
 * Also while the link is not known yet: at row 0 of a new tree a step to
 * `start` cannot prove it, so without this j would do nothing there until
 * the wheel moves the window. The retry settles it: seen, the link works.
 * The one cost: if the hook link is truly absent, that single retry jumps
 * the window to the end once before the link is known to be absent (the
 * next step finds the window off the top and `learnLink` concludes it).
 * Never once it is absent: `end` would jump to the bottom each time.
 */
export function needsRetry(token: StepToken, answer: { deny?: string } | null, link: Link): boolean {
  return token.kind === 'step' && token.step !== 0 && !token.seen && link !== 'absent' && answer !== null && answer.deny === undefined
}

/** The fields of a `ui.scroll` event that say who moves the window. */
export type ScrollEvent = ScrollWindow & { origin: { kind: 'person' } | { kind: 'plugin'; name: string } }

function isOurs(e: ScrollEvent, plugin: string): boolean {
  return e.origin.kind === 'plugin' && e.origin.name === plugin
}

/**
 * The offset this mod's `ui.scroll` hook passes on, or null to pass the event
 * on as it came. Only a scroll of ours with a token under way is moved: the
 * person's wheel and arrows, and our own `TOP_SCROLL`, go through unchanged.
 * The token taken is marked seen; a step at the page's edge asks to cross.
 */
export function stepAnswer(e: ScrollEvent, plugin: string, steps: Steps): number | null {
  if (!isOurs(e, plugin)) {
    return null
  }
  const token = steps.take()
  if (token === undefined) {
    // Our own top or bottom: a step after it starts from where it went.
    steps.forget()

    return null
  }
  token.seen = true
  if (token.kind !== 'step') {
    steps.forget()
  }
  switch (token.kind) {
    case 'probe':
      return null
    case 'measure':
      token.share = shareOf(e)

      return stepOffset(e, 0)
    case 'place':
      return Math.round(token.share * lastOffset(e))
    case 'step': {
      const standing = standingOf(e)
      const from = stepBase(standing, steps.last())
      token.cross = crossingOf(e, token.step, from)
      const to = stepOffset(e, token.step, from)
      steps.setLast(nextStep(standing, steps.last(), to))

      return to
    }
  }
}

/**
 * The offset to pass on when this mod's `ui.scroll` hook failed: a scroll of
 * ours stays where the window stands, as most are j or k steps resolved to
 * `start`; any other goes where the engine resolved it.
 */
export function heldOffset(e: ScrollEvent, plugin: string): number {
  return isOurs(e, plugin) ? Math.max(0, e.offset - e.by) : e.offset
}
