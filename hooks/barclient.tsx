// The band's row as a surface module, for the desktop app: the bar's cells,
// the total and the legend drawn in one region whose pointer events say
// which cell is under the pointer. A desktop draws a Button as a native
// button showing only its text, so the segments cannot be Buttons there;
// here a click on a segment posts which segment it is, and the hooks module
// opens it.
// The bar's cells, the join and the legend's swatch are drawn in the code
// font, whose cells the pointer's column counts. The total and the legend's
// words are drawn in the app's own face, so their width in cells is not known.
// While the pointer is on a segment, its name and tokens take the legend's
// place, as the terminal's chip does.

import type { ClientSurface } from 'claude-code'

/** One run of text in the row and what a click on it opens. */
export type BarRun = {
  text: string
  color?: string
  backgroundColor?: string
  dimColor?: boolean
  /** The index of the bar part it belongs to, "total" for the total, or null. */
  target: number | 'total' | null
  /** Part of the legend: hidden while a segment's name shows. */
  isLegend?: boolean
  /**
   * Drawn in the code font, one cell a character: the bar's cells, the space
   * after them, the join, the legend's swatch and the space after it. Any
   * other run is text in the app's face, with tabular digits.
   */
  mono?: boolean
}

/** Which segments a bar part holds: its segment id and its members' ids. */
export type PartIdentity = { id: string; members: string[] }

export type BarClientProps = {
  runs: BarRun[]
  /** What shows in the legend's place while the pointer is on part `i`. */
  hovers: Record<string, string>
  /** Per segment part `i`, which segments it holds. */
  parts: Record<string, PartIdentity>
}

/**
 * What the module posts: "total", or the part index a click landed on with
 * the part's identity. The hooks module opens the part by its identity, as a
 * relayout between the drawing and the click can move the indices.
 */
export type BarClientPost = { open: 'total' } | ({ open: number } & PartIdentity)

/** The pointer's column over the region, or null while it is outside. */
type State = { x: number | null }

/**
 * The target under column `x`. The runs before the total are the bar's cells,
 * one cell a character. The total and what follows it are text in the app's
 * face, of a width the column cannot measure: every column from the total's
 * start on opens it, the legend's included, so a click on any of its text
 * opens level 1.
 */
export function targetAt(runs: readonly BarRun[], x: number): BarRun['target'] {
  let start = 0
  for (const run of runs) {
    if (run.target === 'total') {
      return x >= start ? 'total' : null
    }
    const width = [...run.text].length
    if (x >= start && x < start + width) {
      return run.target
    }
    start += width
  }

  return null
}

/**
 * Whether a run fades: while the pointer is on a segment, every other
 * segment's cells are drawn dim, so the one pointed at stands out in its
 * own colour.
 */
export function isFaded(run: BarRun, hover: number | null): boolean {
  return hover !== null && typeof run.target === 'number' && run.target !== hover
}

/**
 * The segment part under the pointer's column, or null. Worked out from the
 * current runs on every call, so a relayout never leaves a stale part.
 */
export function hoveredPart(runs: readonly BarRun[], x: number | null): number | null {
  const target = x === null ? null : targetAt(runs, x)

  return typeof target === 'number' ? target : null
}

export default function ContextBar(props: BarClientProps, surface: ClientSurface<State>) {
  const { Box, Text } = surface.elements
  const x = surface.state?.x ?? null
  surface.onPointer(event => {
    // An "enter" carries the last column a move reported, not the pointer's:
    // the next move places it. Every other event does, a press too: a
    // pointer that jumps onto the total and presses it reports no move first.
    if (event.type === 'enter') {
      return
    }
    const next = event.type === 'leave' ? null : event.x
    if (next !== x) {
      surface.setState({ x: next })
    }
    if (event.type !== 'down' || event.button !== 'left') {
      return
    }
    const target = targetAt(props.runs, event.x)
    const identity = typeof target === 'number' ? props.parts[String(target)] : undefined
    if (target === 'total') {
      surface.post({ open: 'total' } satisfies BarClientPost)
    } else if (typeof target === 'number' && identity !== undefined) {
      surface.post({ open: target, ...identity } satisfies BarClientPost)
    }
  })
  const hover = hoveredPart(props.runs, x)
  const label = hover === null ? undefined : props.hovers[String(hover)]

  return (
    <Box flexDirection="row">
      {props.runs
        .filter(run => !(label !== undefined && run.isLegend === true))
        .map(run => (
          <Text
            {...(run.mono === true ? { mono: true } : { tabular: true })}
            {...(run.color === undefined ? {} : { color: run.color })}
            {...(run.backgroundColor === undefined ? {} : { backgroundColor: run.backgroundColor })}
            {...(run.dimColor === true || isFaded(run, hover) ? { dimColor: true } : {})}
          >
            {run.text}
          </Text>
        ))}
      {label !== undefined && <Text tabular>{label}</Text>}
    </Box>
  )
}
