// The band above the prompt: one row, the bar, its total and the legend.

import type { EngineInterface, RenderElement } from 'claude-code'

import type { ContextBreakdownSegmentId, ContextBreakdownSnapshot } from '../types'
import { FILLED, FREE, RESERVE, chipsToDraw, segmentCells, segmentKey, segmentRuns } from './bar'
import type { Chip } from './bar'
import { inkOn } from './color'
import type { SegmentPart } from './layout'
import { colorOf, edgeColor } from './palette'
import type { Palette } from './palette'
import { segmentDef } from './segments'
import type { BandModel } from './view'
import { LEGEND_JOIN, bandModel } from './view'

/** The element table of the surface being drawn. */
export type Ui = ReturnType<EngineInterface['ui']['resolve']>

/** The name of a bar cell: a merged cell says how many more segments it holds. */
export function partLabel(part: SegmentPart): string {
  const { label } = segmentDef(part.id as ContextBreakdownSegmentId)
  const more = part.members.length - 1

  return more > 0 ? `${label} and ${more} more` : label
}

/** What a press on a bar cell runs: it is told which cell. */
export type OpenPane = (part: SegmentPart) => unknown

/**
 * A segment's cells. The engine draws a Button under the focus ring or the
 * pointer inverted, each cell's colour and background swapped. Full blocks
 * on their own colour look the same either way. The edge cell's background
 * is `edgeColor`: at rest its last eighth is the thin separator, inverted
 * seven eighths of it take that shade, which marks the segment as the one
 * focused or pointed at without hiding it. The texture keeps no background:
 * inverted it reads as a thinner texture of the same colour.
 */
function segmentText(ui: Ui, palette: Palette, part: SegmentPart) {
  const { Text } = ui
  const color = colorOf(palette, part.id)
  const { fill, edge } = segmentRuns(part.id, part.cells)
  const runs: RenderElement[] = []
  if (fill !== '') {
    // The texture keeps the background showing through it.
    const back = fill.startsWith(FILLED) ? { backgroundColor: color } : {}
    runs.push(
      <Text color={color} {...back}>
        {fill}
      </Text>,
    )
  }
  if (edge !== '') {
    runs.push(
      <Text color={color} backgroundColor={edgeColor(palette, part.id)}>
        {edge}
      </Text>,
    )
  }

  return runs
}

/**
 * The bar's cells. With `openPane` each segment is a button that opens the
 * pane and lights its chip's hover group; without it they are plain text,
 * for a seat clicks may not reach.
 */
function barCells(ui: Ui, model: BandModel, palette: Palette, openPane: OpenPane | null) {
  const { Button, Text } = ui

  return model.parts.map(part => {
    if (part.kind === 'free') {
      return <Text color={palette.free}>{FREE.repeat(part.cells)}</Text>
    }
    if (part.kind === 'reserve') {
      return <Text color={palette.reserve}>{RESERVE.repeat(part.cells)}</Text>
    }
    const cells = segmentText(ui, palette, part)
    if (openPane === null) {
      return cells
    }
    const key = segmentKey(part.id)

    // No hotkey: a bare digit typed into an empty prompt would press it.
    return (
      <Button key={key} label={partLabel(part)} plain hover={{ scope: key }} onPress={() => void openPane(part)}>
        {cells}
      </Button>
    )
  })
}

/**
 * A segment's chip, laid over the cells beside it but one (see `CHIP_GAP`):
 * hidden until the pointer is on the segment (its hover group), or shown
 * from state while the keyboard focus is (`isForced`; see `chipsToDraw`).
 * Absolute, so it takes no room in the row and moves nothing.
 */
function chipBox(ui: Ui, chip: Chip, palette: Palette, isForced: boolean) {
  const { Box, Text } = ui
  const color = colorOf(palette, chip.id)
  const text = (
    <Text color={inkOn(color)} backgroundColor={color}>
      {chip.text}
    </Text>
  )
  if (isForced) {
    return (
      <Box position="absolute" top={0} left={chip.left}>
        {text}
      </Box>
    )
  }

  return (
    <Box
      position="absolute"
      top={0}
      left={chip.left}
      display="none"
      hover={{ scope: segmentKey(chip.id), display: 'flex' }}
    >
      {text}
    </Box>
  )
}

function row(
  ui: Ui,
  model: BandModel,
  palette: Palette,
  openPane: OpenPane | null,
  focused: string | null,
): RenderElement {
  const { Box, Text } = ui
  const { legend } = model

  // The chips come last, so they paint over the cells before them.
  return (
    <Box flexDirection="row">
      {barCells(ui, model, palette, openPane)}
      <Text dimColor>{`${model.parts.length > 0 ? ' ' : ''}${model.label}`}</Text>
      {legend !== null && <Text dimColor>{LEGEND_JOIN}</Text>}
      {legend !== null && <Text color={colorOf(palette, legend.cell)}>{segmentCells(legend.cell, 1)}</Text>}
      {legend !== null && <Text dimColor>{` ${legend.text}`}</Text>}
      {openPane !== null &&
        chipsToDraw(model.chips, focused).map(({ chip, isForced }) => chipBox(ui, chip, palette, isForced))}
    </Box>
  )
}

/**
 * The band's row for one model (see `bandModel`). `focused` is the key of
 * the bar Button that holds the keyboard focus, if any: its chip alone shows.
 * The chips are placed in text cells, so only the terminal gets them (see
 * `bandModelFor`).
 */
export function bandTree(
  ui: Ui,
  model: BandModel,
  palette: Palette,
  openPane: OpenPane,
  focused: string | null,
): RenderElement {
  return row(ui, model, palette, openPane, focused)
}

/**
 * The glance a minimized pane shows (the desktop app's widget seat): the bar,
 * the total and the legend, with nothing to press.
 */
export function glanceTree(
  ui: Ui,
  snapshot: ContextBreakdownSnapshot | null,
  columns: number,
  palette: Palette,
): RenderElement {
  const { Text } = ui
  if (snapshot === null) {
    return <Text dimColor>Measuring…</Text>
  }

  return row(ui, bandModel(snapshot, columns), palette, null, null)
}
