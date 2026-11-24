// Lays the bar out in cells: one linear scale over the window, a minimum of
// one cell per drawn segment, tiny segments merged into a neighbour. In a
// large window while use is low, the bar draws free space at a small fraction
// of its size and a scale break stands for the free space it leaves out.

import { SCALE_BREAK_CELLS } from './bar'

export type LayoutSegment = {
  id: string
  tokens: number
}

export type LayoutInput = {
  /** Cells the bar may take. */
  width: number
  /** The window in tokens: the full bar. */
  window: number
  /** Segments by group, in bar order (baseline first, then conversation). */
  groups: readonly (readonly LayoutSegment[])[]
  /** The compaction reserve in tokens, drawn at the right end. */
  reserve: number
}

export type SegmentPart = {
  kind: 'segment'
  /** The segment drawn; `members` lists every segment whose tokens it holds. */
  id: string
  members: string[]
  tokens: number
  cells: number
}

/**
 * The scale break: it stands where the bar leaves out free space. `omitted`
 * is the number of free tokens it leaves out.
 */
export type BreakPart = { kind: 'break'; cells: number; omitted: number }

export type LayoutPart =
  | SegmentPart
  | { kind: 'free'; cells: number }
  | BreakPart
  | { kind: 'reserve'; cells: number }

type Drawn = { id: string; members: string[]; tokens: number }

/** Merges a group's segments that would get under half a cell. */
function mergeGroup(group: readonly LayoutSegment[], scale: number): Drawn[] {
  const segments: Drawn[] = group
    .filter(segment => segment.tokens > 0)
    .map(segment => ({ id: segment.id, members: [segment.id], tokens: segment.tokens }))
  if (segments.length === 0) {
    return []
  }
  const total = segments.reduce((sum, segment) => sum + segment.tokens, 0)
  if (total * scale < 0.5) {
    // A whole group under half a cell still gets one cell, in the colour of
    // its largest segment.
    const largest = segments.reduce((a, b) => (b.tokens > a.tokens ? b : a))

    return [{ id: largest.id, members: segments.map(s => s.id), tokens: total }]
  }
  while (segments.length > 1) {
    let smallest = -1
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i]!
      if (segment.tokens * scale < 0.5 && (smallest < 0 || segment.tokens < segments[smallest]!.tokens)) {
        smallest = i
      }
    }
    if (smallest < 0) {
      break
    }
    // The left neighbour takes it; the first segment goes to its right.
    const into = segments[smallest > 0 ? smallest - 1 : 1]!
    const gone = segments[smallest]!
    into.tokens += gone.tokens
    into.members.push(...gone.members)
    segments.splice(smallest, 1)
  }

  return segments
}

/** The index of the segment with the most cells, past the floor of one. */
function widest(cells: readonly number[]): number {
  let best = -1
  for (let i = 0; i < cells.length; i += 1) {
    if (cells[i]! > 1 && (best < 0 || cells[i]! > cells[best]!)) {
      best = i
    }
  }

  return best
}

/**
 * Lays the bar out. The parts always sum to the width (for a width of at
 * least the number of drawn segments): free space absorbs rounding, and an
 * over-full window takes cells from the reserve, then from the widest
 * segments, then drops the smallest, so the row never overflows.
 */
export function layoutBar(input: LayoutInput): LayoutPart[] {
  const width = Math.max(0, Math.floor(input.width))
  if (width === 0) {
    return []
  }
  if (!(input.window > 0)) {
    return [{ kind: 'free', cells: width }]
  }
  const scale = width / input.window
  const drawn = input.groups.flatMap(group => mergeGroup(group, scale))
  const cells = drawn.map(segment => Math.max(1, Math.round(segment.tokens * scale)))
  const used = drawn.reduce((sum, segment) => sum + segment.tokens, 0)
  const reserveTokens = Math.max(0, input.reserve)
  let reserve = reserveTokens > 0 ? Math.max(1, Math.round(reserveTokens * scale)) : 0
  const freeTokens = Math.max(0, input.window - used - reserveTokens)
  const sum = () => cells.reduce((acc, n) => acc + n, 0) + reserve
  let free = width - sum()

  if (free < 0) {
    // Over-full: the reserve gives way first (wholly once the used content
    // alone fills the window), then the widest segments, then the smallest.
    const floor = used >= input.window ? 0 : Math.min(reserve, 1)
    reserve = Math.max(floor, reserve + free)
    free = width - sum()
    while (free < 0) {
      const index = widest(cells)
      if (index < 0) {
        break
      }
      cells[index]! -= 1
      free += 1
    }
    if (free < 0 && reserve > 0) {
      free += reserve
      reserve = 0
    }
    while (free < 0 && drawn.length > 0) {
      let smallest = 0
      drawn.forEach((segment, i) => {
        if (segment.tokens < drawn[smallest]!.tokens) {
          smallest = i
        }
      })
      drawn.splice(smallest, 1)
      cells.splice(smallest, 1)
      free += 1
    }
    free = Math.max(0, free)
  } else if (free > 0 && freeTokens === 0) {
    // Nothing is free: rounding's spare cells go to the reserve, or else to
    // the widest segment, so no false free space is drawn.
    if (reserve > 0) {
      reserve += free
    } else if (cells.length > 0) {
      const index = cells.indexOf(Math.max(...cells))
      cells[index]! += free
    }
    free = cells.length > 0 || reserve > 0 ? 0 : free
  }

  const parts: LayoutPart[] = drawn.map((segment, i) => ({
    kind: 'segment',
    id: segment.id,
    members: segment.members,
    tokens: segment.tokens,
    cells: cells[i]!,
  }))
  if (free > 0) {
    parts.push({ kind: 'free', cells: free })
  }
  if (reserve > 0) {
    parts.push({ kind: 'reserve', cells: reserve })
  }

  return parts
}

/**
 * The smallest window the bar compresses. Below it the used part already gets
 * enough cells: at 200k, 69k used is a third of the bar.
 */
export const COMPRESS_MIN_WINDOW = 500_000

/**
 * How much smaller a compressed bar draws free space: one token of every 32.
 * The segments, the reserve and that free part keep one scale, so the used
 * part gets most of the bar. At 1M with a 33k reserve the segments take about
 * 40 % of it at 41k used and about 53 % at 69k, against 4 % and 7 % at true
 * scale, and free space keeps about a fifth of the bar or more.
 */
export const COMPRESS_FREE_SCALE = 32

/**
 * The largest share of the window that use and the reserve may fill while
 * the bar compresses: an eighth, so about 92k used in a 1M window.
 */
export const COMPRESS_MAX_SHARE = 0.125

/**
 * The narrowest bar that compresses. Under it the three cells of the scale
 * break cost too much of the bar. Kept equal to view.ts MIN_BAR_WITH_LEGEND,
 * the narrowest bar the band draws beside a legend (a test holds them
 * equal); layout.ts does not import view.ts.
 */
export const COMPRESS_MIN_CELLS = 20

/**
 * Whether the bar compresses: a window of COMPRESS_MIN_WINDOW or more, a bar
 * of COMPRESS_MIN_CELLS or more, and use and the reserve within
 * COMPRESS_MAX_SHARE of the window (exactly that share compresses). The
 * compressed layout must also keep free space in one cell or more: the
 * one-cell floor of many small segments can take it all. `groups` are the
 * segments the bar draws; without them, one segment of `used` tokens stands
 * for them.
 */
export function isCompressed(
  used: number,
  reserve: number,
  window: number,
  width: number,
  groups: LayoutInput['groups'] = [[{ id: 'used', tokens: used }]],
): boolean {
  const cells = Math.floor(width)
  const held = used + Math.max(0, reserve)
  if (!(window >= COMPRESS_MIN_WINDOW) || cells < COMPRESS_MIN_CELLS || held > window * COMPRESS_MAX_SHARE) {
    return false
  }
  const shown = layoutBar({ width: cells - SCALE_BREAK_CELLS, window: shownWindow(held, window), groups, reserve })
  const free = shown.find(part => part.kind === 'free')?.cells ?? 0

  return free >= 1
}

/** The tokens a compressed bar draws: all that is held, and the free space at COMPRESS_FREE_SCALE. */
function shownWindow(held: number, window: number): number {
  return held + (window - held) / COMPRESS_FREE_SCALE
}

/**
 * The compressed bar: `layoutBar` over the held tokens and a 32nd of the free
 * space, in the width less the scale break's cells, so the segments, free
 * space and the reserve keep one scale. The break follows the free part,
 * before the reserve (or at the end without one). Call it only where
 * `isCompressed` holds: then the free part exists and the break leaves out
 * free tokens only.
 */
export function layoutCompressed(input: LayoutInput): LayoutPart[] {
  const used = input.groups.flat().reduce((sum, segment) => sum + segment.tokens, 0)
  const shown = shownWindow(used + Math.max(0, input.reserve), input.window)
  const parts = layoutBar({ ...input, width: Math.floor(input.width) - SCALE_BREAK_CELLS, window: shown })
  const mark: BreakPart = { kind: 'break', cells: SCALE_BREAK_CELLS, omitted: input.window - shown }
  const free = parts.findIndex(part => part.kind === 'free')
  const reserve = parts.findIndex(part => part.kind === 'reserve')
  const at = free >= 0 ? free + 1 : reserve >= 0 ? reserve : parts.length

  return [...parts.slice(0, at), mark, ...parts.slice(at)]
}
