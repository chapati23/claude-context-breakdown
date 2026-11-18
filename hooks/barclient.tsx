// The band's row as a surface module, for the desktop app: the bar's cells,
// the total and the legend drawn in one region whose pointer events say
// which cell is under the pointer. A desktop draws a Button as a native
// button showing only its text, so the segments cannot be Buttons there;
// here a click on a segment posts its index, and the hooks module opens it.
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
}

export type BarClientProps = {
  runs: BarRun[]
  /** What shows in the legend's place while the pointer is on part `i`. */
  hovers: Record<string, string>
}

/** What the module posts: the part index or "total" a click landed on. */
export type BarClientPost = { open: number | 'total' }

type State = { hover: number | null }

/** The target under column `x`: every run is counted one cell a character. */
export function targetAt(runs: readonly BarRun[], x: number): BarRun['target'] {
  let start = 0
  for (const run of runs) {
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

export default function ContextBar(props: BarClientProps, surface: ClientSurface<State>) {
  const { Box, Text } = surface.elements
  const hover = surface.state?.hover ?? null
  surface.onPointer(event => {
    const target = targetAt(props.runs, event.x)
    // Every event moves the name, a press too: a pointer that jumps onto the
    // total and presses it reports no move first.
    const next = event.type === 'leave' || typeof target !== 'number' || props.hovers[String(target)] === undefined ? null : target
    if (next !== hover) {
      surface.setState({ hover: next })
    }
    if (event.type === 'down' && event.button === 'left' && target !== null) {
      surface.post({ open: target } satisfies BarClientPost)
    }
  })
  const label = hover === null ? undefined : props.hovers[String(hover)]

  return (
    <Box flexDirection="row">
      {props.runs
        .filter(run => !(label !== undefined && run.isLegend === true))
        .map(run => (
          <Text
            mono
            {...(run.color === undefined ? {} : { color: run.color })}
            {...(run.backgroundColor === undefined ? {} : { backgroundColor: run.backgroundColor })}
            {...(run.dimColor === true || isFaded(run, hover) ? { dimColor: true } : {})}
          >
            {run.text}
          </Text>
        ))}
      {label !== undefined && <Text mono>{label}</Text>}
    </Box>
  )
}
