// The bar as one SVG picture, for the surfaces that draw text in a
// proportional face and a Button as a native button (the desktop app, the
// editor, the mobile app), and the pane's pictures there. Worked out without
// drawing. The fills come from the palette of the Claude Code theme, as the
// bar's do.

import type { ContextBreakdownSegmentId } from '../types'
import { TEXTURE_COVERAGE, TEXTURED } from './bar'
import { formatPercent, formatTokens } from './format'
import type { LayoutPart } from './layout'
import { colorOf } from './palette'
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

/** The palette's fills as a style sheet for the classes `ids` name. */
function styleFor(palette: Palette, ids: readonly string[]): string {
  const free = `.${classOf('free')}{fill:${palette.free};fill-opacity:${palette.name === 'light' ? 0.55 : 0.8}}`
  const reserve = `.${classOf('reserve')}{fill:${palette.reserve}}`
  const segments = ids.map(id => `.${classOf(id)}{fill:${colorOf(palette, id)}}`).join('')

  return `<style>${free}${reserve}${segments}</style>`
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
export function barSvg(parts: readonly LayoutPart[], palette: Palette, tokensOf: TokensOf, used: number): string {
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
    styleFor(palette, ids) +
    `<clipPath id="r"><rect width="${width}" height="${height}" rx="${RADIUS_PX}" ry="${RADIUS_PX}"/></clipPath>` +
    `<g clip-path="url(#r)"><rect class="${classOf('free')}" width="${width}" height="${height}"/>${shapes.join('')}</g>` +
    `</svg>`
  )
}

/** The legend's swatch: a small rounded square in the colour of the cell `id` names. */
export function swatchSvg(id: string, palette: Palette): string {
  const size = SVG_SWATCH_PX

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    styleFor(palette, [id]) +
    `<rect class="${classOf(id)}" width="${size}" height="${size}" rx="2" ry="2"/></svg>`
  )
}

// The pane's pictures on the same surfaces: a swatch per row, a length bar
// per row and the bar on top of level 1. A Box's width counts in cells, an
// Svg's in CSS pixels, and the declarations state no size for a cell. These
// pictures are drawn for the cell measured in the desktop app; the pane sets
// no `width` on the length bars and the bar on top, so each takes the
// markup's own width up to its Box (see `grid.tsx`).

/** CSS pixels of one Box cell, measured in the desktop app on one Mac at 100 % zoom: the cell the pane's pictures are drawn for. */
export const MEASURED_CELL_PX = 8.8
/** A row's length bar: its height in CSS pixels, and the fewest pixels a row with tokens gets. */
export const LENGTH_BAR_HEIGHT = 6
const LENGTH_BAR_MIN_PX = 2
/** The bar on top: a thin space between two segments, and the fewest pixels a part with tokens gets. */
const PART_MIN_PX = 3

/**
 * The textures of the bar's text cells, as pictures: `striped` for the
 * compaction summary (▓), `dotted` for free space (·), `shaded` for the
 * reserve (▒).
 */
export type Texture = 'striped' | 'dotted' | 'shaded'

/**
 * The ground under free space's dots and the reserve's stripes: a mid grey,
 * part see-through. A picture cannot read the theme, and this grey shows on
 * a light and on a dark background alike.
 */
const DOTTED_GROUND = 'fill="#808080" fill-opacity="0.3"'
const SHADED_GROUND = 'fill="#808080" fill-opacity="0.18"'

/** The texture of a segment's picture: the compaction summary's, or none. */
export function segmentTexture(id: string): Texture | null {
  return TEXTURED.has(id) ? 'striped' : null
}

/** A number for SVG markup: at most two decimals. */
function px(value: number): number {
  return Math.round(value * 100) / 100
}

/** The pattern `id` of a texture in `color`. The striped one covers TEXTURE_COVERAGE of its ground, as ▓ does. */
function patternOf(texture: Texture, color: string, id: string, dotX = 0.5): string {
  if (texture === 'striped') {
    return `<pattern id="${id}" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="${px(3 * TEXTURE_COVERAGE)}" height="3" fill="${color}"/></pattern>`
  }
  if (texture === 'shaded') {
    return `<pattern id="${id}" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="1.5" height="3" fill="${color}"/></pattern>`
  }

  return `<pattern id="${id}" width="4" height="10" patternUnits="userSpaceOnUse" x="${dotX}" y="0"><circle cx="2" cy="5" r="1" fill="${color}"/></pattern>`
}

/** One rectangle in `color`, or in its texture over the texture's ground. */
function paintOf(texture: Texture | null, color: string, id: string, x: number, width: number, height: number): string {
  const box = `x="${px(x)}" y="0" width="${px(width)}" height="${height}"`
  if (texture === null) {
    return `<rect ${box} fill="${color}"/>`
  }
  const ground = texture === 'dotted' ? DOTTED_GROUND : texture === 'shaded' ? SHADED_GROUND : null

  return `${ground === null ? '' : `<rect ${box} ${ground}/>`}<rect ${box} fill="url(#${id})"/>`
}

/** An SVG document `width` by `height`; `stretches` lets a narrower box squeeze it across, as a bar must. */
function svgDocument(width: number, height: number, body: string, stretches = false): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px(width)}" height="${height}" viewBox="0 0 ${px(width)} ${height}"` +
    `${stretches ? ' preserveAspectRatio="none"' : ''}>${body}</svg>`
  )
}

/** A row's swatch: a small rounded square in `color`, or in its texture. */
export function swatchPicture(color: string, texture: Texture | null): string {
  const size = SVG_SWATCH_PX
  const defs = texture === null ? '' : `<defs>${patternOf(texture, color, 't', 1)}</defs>`

  return svgDocument(
    size,
    size,
    `${defs}<clipPath id="r"><rect width="${size}" height="${size}" rx="2" ry="2"/></clipPath>` +
      `<g clip-path="url(#r)">${paintOf(texture, color, 't', 0, size, size)}</g>`,
  )
}

/**
 * A row's length bar, `width` pixels: only the filled part, left-aligned,
 * `tokens` against `largest`, which fills it. A row with tokens gets at
 * least LENGTH_BAR_MIN_PX. No track behind it.
 */
export function lengthBarPicture(tokens: number, largest: number, color: string, width: number): string {
  const fill = tokens > 0 && largest > 0 ? Math.max(LENGTH_BAR_MIN_PX, Math.min(1, tokens / largest) * width) : 0
  const body = fill > 0 ? `<rect width="${px(fill)}" height="${LENGTH_BAR_HEIGHT}" rx="1" ry="1" fill="${color}"/>` : ''

  return svgDocument(width, LENGTH_BAR_HEIGHT, body, true)
}

/** One stretch of the bar on top: a segment, free space or the reserve. */
export type WindowPart = { kind: 'segment' | 'free' | 'reserve'; color: string; tokens: number; texture: Texture | null }

/**
 * The bar on top of level 1, `width` pixels: one stretch per part with
 * tokens, in their order, each as wide as its share of all the parts' tokens
 * and at least PART_MIN_PX, taken from the wider parts, where the bar has
 * room for every part to have that minimum. A thin space follows
 * a segment, except before free space. Corner radius 2.
 */
export function windowBarPicture(parts: readonly WindowPart[], width: number): string {
  const drawn = parts.filter(part => part.tokens > 0)
  const total = drawn.reduce((sum, part) => sum + part.tokens, 0)
  const height = SVG_BAR_HEIGHT
  const exact = drawn.map(part => (total > 0 ? (part.tokens / total) * width : 0))
  const added = exact.reduce((sum, w) => sum + (w < PART_MIN_PX ? PART_MIN_PX - w : 0), 0)
  const wide = exact.reduce((sum, w) => sum + (w < PART_MIN_PX ? 0 : w), 0)
  // In a bar too short for every part to have PART_MIN_PX, each part keeps its exact share.
  const keepsMin = drawn.length * PART_MIN_PX <= width
  const widths = exact.map(w => (!keepsMin ? w : w < PART_MIN_PX ? PART_MIN_PX : wide > 0 ? Math.max(0, w - (added * w) / wide) : w))
  const defs: string[] = []
  const shapes: string[] = []
  let x = 0
  drawn.forEach((part, index) => {
    const next = drawn[index + 1]
    const gap = part.kind === 'segment' && next !== undefined && next.kind !== 'free' ? SEPARATOR_PX : 0
    const w = widths[index] ?? 0
    const id = `t${index}`
    if (part.texture !== null) {
      defs.push(patternOf(part.texture, part.color, id))
    }
    shapes.push(paintOf(part.texture, part.color, id, x, Math.max(1, w - gap), height))
    x += w
  })

  return svgDocument(
    width,
    height,
    `<defs>${defs.join('')}</defs><clipPath id="r"><rect width="${px(width)}" height="${height}" rx="2" ry="2"/></clipPath>` +
      `<g clip-path="url(#r)">${shapes.join('')}</g>`,
    true,
  )
}
