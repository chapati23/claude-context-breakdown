// The band above the prompt: one row, the bar and its total.

import type { EngineInterface, RenderElement } from 'claude-code'

import type { ContextBreakdownSegmentId, ContextBreakdownSnapshot } from '../types'
import type { SegmentPart } from './layout'
import { segmentDef } from './segments'
import type { BandModel } from './view'
import { bandModel } from './view'

/** The element table of the surface being drawn. */
export type Ui = ReturnType<EngineInterface['ui']['resolve']>

const FILLED = '█'
const FREE = '·'
const RESERVE = '▒'

/** The name of a bar cell: a merged cell says how many more segments it holds. */
export function partLabel(part: SegmentPart): string {
  const { label } = segmentDef(part.id as ContextBreakdownSegmentId)
  const more = part.members.length - 1

  return more > 0 ? `${label} and ${more} more` : label
}

/** What a press on a bar cell runs: it is told which cell. */
export type OpenPane = (part: SegmentPart) => unknown

/**
 * The bar's cells. With `openPane` each segment is a button that opens the
 * pane; without it they are plain text, for a seat clicks may not reach.
 */
function barCells(ui: Ui, model: BandModel, openPane: OpenPane | null) {
  const { Button, Text } = ui

  return model.parts.map(part => {
    if (part.kind === 'free') {
      return <Text dimColor>{FREE.repeat(part.cells)}</Text>
    }
    if (part.kind === 'reserve') {
      return <Text dimColor>{RESERVE.repeat(part.cells)}</Text>
    }
    const { color } = segmentDef(part.id as ContextBreakdownSegmentId)
    const cells = <Text color={color}>{FILLED.repeat(part.cells)}</Text>
    if (openPane === null) {
      return cells
    }

    // No hotkey: a bare digit typed into an empty prompt would press it.
    return (
      <Button key={`seg-${part.id}`} label={partLabel(part)} plain onPress={() => void openPane(part)}>
        {cells}
      </Button>
    )
  })
}

function row(ui: Ui, model: BandModel, openPane: OpenPane | null): RenderElement {
  const { Box, Text } = ui

  return (
    <Box flexDirection="row">
      {barCells(ui, model, openPane)}
      <Text dimColor>{`${model.parts.length > 0 ? ' ' : ''}${model.label}`}</Text>
    </Box>
  )
}

/** The band's row for one model (see `bandModel`). */
export function bandTree(ui: Ui, model: BandModel, openPane: OpenPane): RenderElement {
  return row(ui, model, openPane)
}

/**
 * The glance a minimized pane shows (the desktop app's widget seat): the bar
 * and the total, with nothing to press.
 */
export function glanceTree(
  ui: Ui,
  snapshot: ContextBreakdownSnapshot | null,
  columns: number,
): RenderElement {
  const { Text } = ui
  if (snapshot === null) {
    return <Text dimColor>Measuring…</Text>
  }

  return row(ui, bandModel(snapshot, columns), null)
}
