// The bar as one SVG picture, for the surfaces that draw text in a
// proportional face and a Button as a native button (the desktop app, the
// editor, the mobile app). Worked out without drawing.
//
// The picture carries both palettes and picks one with
// `prefers-color-scheme`: the surface draws it in the page's colour scheme,
// while the Claude Code theme name, which picks the terminal's palette, need
// not follow the desktop app's light or dark look.

import type { ContextBreakdownSegmentId } from '../types'
import { formatPercent, formatTokens } from './format'
import type { LayoutPart } from './layout'
import { DARK, LIGHT, colorOf } from './palette'
import type { Palette } from './palette'
import { segmentDef } from './segments'

/** CSS pixels a bar cell takes: under the code font's advance, so the row fits its cells. */
export const SVG_CELL_PX = 7
/** The bar's height in CSS pixels. */
export const SVG_BAR_HEIGHT = 10
/** The swatch before the legend, square. */
export const SVG_SWATCH_PX = 10
/** The space left between two segments, in CSS pixels. */
const SEPARATOR_PX = 1.5
/** The bar's corner radius, in CSS pixels. */
const RADIUS_PX = 3

/** Names the picture's classes by: a segment id, or "free" and "reserve". */
function classOf(id: string): string {
  return `c-${id.replace(/[^a-z0-9-]/gi, '')}`
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** One palette's fills as CSS rules for the classes `ids` name. */
function rules(palette: Palette, ids: readonly string[]): string {
  const free = `.${classOf('free')}{fill:${palette.free};fill-opacity:${palette.name === 'light' ? 0.55 : 0.8}}`
  const reserve = `.${classOf('reserve')}{fill:${palette.reserve}}`
  const segments = ids.map(id => `.${classOf(id)}{fill:${colorOf(palette, id)}}`).join('')

  return free + reserve + segments
}

/** Both palettes, the light one by default and the dark one where the page is dark. */
function styleFor(ids: readonly string[]): string {
  return `<style>${rules(LIGHT, ids)}@media (prefers-color-scheme: dark){${rules(DARK, ids)}}</style>`
}

/** A segment's tooltip: "Tool results: 40k, 19% of used" (a merged cell names each member). */
export type TokensOf = (id: string) => number

function tooltip(members: readonly string[], tokensOf: TokensOf, used: number): string {
  return members
    .map(id => {
      const tokens = tokensOf(id)
      const { label } = segmentDef(id as ContextBreakdownSegmentId)

      return `${label}: ${formatTokens(tokens)}, ${formatPercent(tokens, used)} of used`
    })
    .join('\n')
}

/** The bar's width in CSS pixels for its parts. */
export function svgBarWidth(parts: readonly LayoutPart[]): number {
  return parts.reduce((sum, part) => sum + part.cells, 0) * SVG_CELL_PX
}

/**
 * The bar as an SVG document: one rounded track in the free colour, each
 * segment a rectangle with a thin space before the next, the reserve at the
 * right end. Every segment carries a `<title>`, which the surface shows as a
 * tooltip where it draws the picture interactive.
 */
export function barSvg(parts: readonly LayoutPart[], tokensOf: TokensOf, used: number): string {
  const width = svgBarWidth(parts)
  const height = SVG_BAR_HEIGHT
  const ids = [...new Set(parts.flatMap(part => (part.kind === 'segment' ? [part.id] : [])))]
  const shapes: string[] = []
  let x = 0
  parts.forEach((part, index) => {
    const w = part.cells * SVG_CELL_PX
    if (part.kind === 'segment') {
      const next = parts[index + 1]
      // A space before the next segment or the reserve; the free track needs none.
      const gap = next !== undefined && next.kind !== 'free' ? SEPARATOR_PX : 0
      const title = escapeXml(tooltip(part.members, tokensOf, used))
      shapes.push(
        `<rect class="${classOf(part.id)}" x="${x}" y="0" width="${Math.max(1, w - gap)}" height="${height}"><title>${title}</title></rect>`,
      )
    } else if (part.kind === 'reserve') {
      shapes.push(
        `<rect class="${classOf('reserve')}" x="${x}" y="0" width="${w}" height="${height}"><title>Reserve: kept free for compaction</title></rect>`,
      )
    }
    x += w
  })

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    styleFor(ids) +
    `<clipPath id="r"><rect width="${width}" height="${height}" rx="${RADIUS_PX}" ry="${RADIUS_PX}"/></clipPath>` +
    `<g clip-path="url(#r)"><rect class="${classOf('free')}" width="${width}" height="${height}"/>${shapes.join('')}</g>` +
    `</svg>`
  )
}

/** The legend's swatch: a small rounded square in the colour of the cell `id` names. */
export function swatchSvg(id: string): string {
  const size = SVG_SWATCH_PX

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    styleFor([id]) +
    `<rect class="${classOf(id)}" width="${size}" height="${size}" rx="2" ry="2"/></svg>`
  )
}
