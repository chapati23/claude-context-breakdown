// The band above the prompt: one row, the bar, its total and the legend.

import type { Elements, EngineInterface, RenderElement } from 'claude-code'

import type { ContextBreakdownSegmentId, ContextBreakdownSnapshot } from '../types'
import { FILLED, FREE, MIN_CHIP_CELLS, RESERVE, chipForms, chipsToDraw, segmentCells, segmentKey, segmentRuns } from './bar'
import type { Chip } from './bar'
import { inkOn } from './color'
import type { LayoutPart, SegmentPart } from './layout'
import { colorOf, edgeColor } from './palette'
import type { Palette } from './palette'
import { segmentDef } from './segments'
import { SVG_BAR_HEIGHT, SVG_SWATCH_PX, barSvg, svgBarWidth, swatchSvg } from './svgbar'
import type { TokensOf } from './svgbar'
import type { BarClientProps, BarRun, PartIdentity } from './barclient'
import { usedTokens } from './snapshot'
import type { BandModel } from './view'
import { LEGEND_JOIN, bandModel, fit, legendCells } from './view'
import { cellWidth } from './text'

/** The element table of the surface being drawn. */
export type Ui = ReturnType<EngineInterface['ui']['resolve']>

/** The name of a bar cell: a merged cell says how many more segments it holds. */
export function partLabel(part: SegmentPart): string {
  const { label } = segmentDef(part.id as ContextBreakdownSegmentId)
  const more = part.members.length - 1

  return more > 0 ? `${label} and ${more} more` : label
}

/** The key of the desktop band's surface module instance. */
export const BAR_CLIENT = 'context-bar'

/** What a press on a bar cell runs: it is told which cell, or null for the total (level 1). */
export type OpenPane = (part: SegmentPart | null) => unknown

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
 * The row on a surface that draws a picture (the desktop app, the editor, the
 * mobile app): the bar as one SVG, then the total and the legend in the code
 * font. Those surfaces draw a Button as a native button showing only its
 * label, so the bar cannot be a row of segment Buttons there. The total is
 * the one Button, with no label so its own text shows; it opens level 1.
 * With `openPane` null nothing is pressable.
 */
function pictureRow(
  ui: PictureUi,
  model: BandModel,
  palette: Palette,
  figures: PictureFigures,
  openPane: OpenPane | null,
): RenderElement {
  const { Box, Text, Button, Svg } = ui
  const { legend } = model
  const hasBar = model.parts.length > 0
  const total = <Text mono dimColor>{model.label}</Text>

  return (
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      {hasBar && (
        <Svg
          source={barSvg(model.parts, palette, figures.tokensOf, figures.used)}
          alt={`Context window: ${model.label}`}
          width={svgBarWidth(model.parts)}
          height={SVG_BAR_HEIGHT}
          isInteractive
        />
      )}
      {openPane === null ? (
        total
      ) : (
        <Button key="context-total" plain onPress={() => void openPane(null)}>
          {total}
        </Button>
      )}
      {legend !== null && <Text mono dimColor>·</Text>}
      {legend !== null && (
        <Svg source={swatchSvg(legend.cell, palette)} alt={segmentDef(legend.id).label} width={SVG_SWATCH_PX} height={SVG_SWATCH_PX} />
      )}
      {legend !== null && <Text mono dimColor>{legend.text}</Text>}
    </Box>
  )
}

/**
 * The desktop band's row as data for the surface module `barclient.tsx`:
 * the terminal's cells and colours, each run marked with the part a click
 * on it opens, and per segment part which segments it holds and the text
 * that shows while the pointer is on it.
 */
export function barClientProps(model: BandModel, palette: Palette, tokensOf: TokensOf): BarClientProps {
  const runs: BarRun[] = []
  const hovers: Record<string, string> = {}
  const parts: Record<string, PartIdentity> = {}
  const hoverParts: { index: number; forms: string[] }[] = []
  model.parts.forEach((part, index) => {
    if (part.kind === 'free') {
      runs.push({ text: FREE.repeat(part.cells), color: palette.free, target: null })

      return
    }
    if (part.kind === 'reserve') {
      runs.push({ text: RESERVE.repeat(part.cells), color: palette.reserve, target: null })

      return
    }
    const color = colorOf(palette, part.id)
    const { fill, edge } = segmentRuns(part.id, part.cells)
    // No background: the terminal's is there for its inverted highlight, and
    // on a desktop it would stay bright while the rest dims under a hover,
    // and stand taller than the glyphs.
    if (fill !== '') {
      runs.push({ text: fill, color, target: index })
    }
    if (edge !== '') {
      runs.push({ text: edge, color, target: index })
    }
    parts[String(index)] = { id: part.id, members: [...part.members] }
    hoverParts.push({ index, forms: chipForms(part, tokensOf).map(form => form.trim()) })
  })
  const { legend } = model
  // The name shows in the legend's place, so it gets the legend's cells:
  // the longest form that fits, else the shortest cut to fit. With no legend
  // there is no room, and no name shows.
  const room = legend === null ? 0 : legendCells(legend) - LEGEND_JOIN.length
  for (const { index, forms } of hoverParts) {
    const fits = forms.find(form => cellWidth(form) <= room)
    const text = fits ?? (room >= MIN_CHIP_CELLS ? fit(forms[forms.length - 1] ?? '', room).trimEnd() : '')
    if (text !== '') {
      hovers[String(index)] = text
    }
  }
  runs.push({ text: `${model.parts.length > 0 ? ' ' : ''}${model.label}`, dimColor: true, target: 'total' })
  if (legend !== null) {
    runs.push({ text: LEGEND_JOIN, dimColor: true, target: null })
    runs.push({ text: segmentCells(legend.cell, 1), color: colorOf(palette, legend.cell), target: null, isLegend: true })
    runs.push({ text: ` ${legend.text}`, dimColor: true, target: null, isLegend: true })
  }

  return { runs, hovers, parts }
}

/**
 * The part a click the bar Client posted names (see `BarClientPost`): null
 * for the total, the segment part with the posted identity, or undefined
 * when no part has it. A relayout after the drawing can move the indices,
 * so the index alone opens nothing.
 */
export function partOfPost(parts: readonly LayoutPart[], data: unknown): SegmentPart | null | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined
  }
  const post = data as { open?: unknown; id?: unknown; members?: unknown }
  if (post.open === 'total') {
    return null
  }
  const { id, members } = post
  if (typeof post.open !== 'number' || typeof id !== 'string' || !Array.isArray(members)) {
    return undefined
  }

  return parts.find(
    (part): part is SegmentPart =>
      part.kind === 'segment' &&
      part.id === id &&
      part.members.length === members.length &&
      part.members.every((member, index) => member === members[index]),
  )
}

/** The element table of a surface that has `Svg`. */
type PictureUi = Elements['desktop'] | Elements['mobile'] | Elements['vscode']

/**
 * Whether a surface draws the picture row: every surface but the terminal
 * (the only one without `Svg`). Asked of the surface's name: a table may
 * carry more elements than its surface draws.
 */
export function drawsPicture(surface: string): boolean {
  return surface !== 'terminal'
}

/** What the picture's tooltips read: each segment's tokens, and what is used. */
export type PictureFigures = { tokensOf: TokensOf; used: number }

/**
 * The band's row for one model (see `bandModel`). `focused` is the key of
 * the bar Button that holds the keyboard focus, if any: its chip alone shows.
 * The chips are placed in text cells, so only the terminal gets them (see
 * `bandModelFor`). The desktop gets the Client, the only table that has one,
 * unless its Client failed (`clientFailed`). Every other surface with `Svg`
 * gets the picture row.
 */
export function bandTree(
  ui: Ui,
  model: BandModel,
  palette: Palette,
  openPane: OpenPane,
  focused: string | null,
  figures: PictureFigures,
  surface: string,
  clientFailed: boolean,
): RenderElement {
  if (surface === 'desktop' && !clientFailed) {
    const { Client } = ui as Elements['desktop']

    return <Client key={BAR_CLIENT} module="./barclient.tsx" props={barClientProps(model, palette, figures.tokensOf)} />
  }
  if (drawsPicture(surface)) {
    return pictureRow(ui as PictureUi, model, palette, figures, openPane)
  }

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
  surface: string,
): RenderElement {
  const { Text } = ui
  if (snapshot === null) {
    return <Text dimColor>Measuring…</Text>
  }
  const model = bandModel(snapshot, columns)
  if (drawsPicture(surface)) {
    return pictureRow(ui as PictureUi, model, palette, pictureFigures(snapshot), null)
  }

  return row(ui, model, palette, null, null)
}

/** The tooltips' figures for a snapshot. */
export function pictureFigures(snapshot: ContextBreakdownSnapshot): PictureFigures {
  const tokens = new Map<string, number>(
    [...snapshot.baseline, ...snapshot.conversation].map(segment => [segment.id, segment.tokens]),
  )

  return { tokensOf: id => tokens.get(id) ?? 0, used: usedTokens(snapshot) }
}
