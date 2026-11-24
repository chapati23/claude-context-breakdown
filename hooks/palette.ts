// The bar's colours: one palette for dark themes and one for light ones,
// chosen by the name of the Claude Code theme.
//
// Baseline segments keep cool hues (blue, teal, violet, green) and
// conversation segments warm ones (orange, red, pink, gold, brown), so the
// two groups read apart. Within that, lightness steps up and down along the
// bar order, so neighbours differ in lightness as well as hue: the part of a
// colour that survives colour blindness. palette.test.ts holds every pair
// that can become neighbours to a minimum CIEDE2000 distance for normal
// vision, deuteranopia and protanopia, each colour to 3:1 contrast against
// its backgrounds (the summary's texture with the background showing
// through a quarter of each cell), and the two groups' hues apart.

import type { ContextBreakdownSegmentId } from '../types'
import { midway } from './color'

export type PaletteName = 'dark' | 'light'

export type Palette = {
  name: PaletteName
  segments: Record<ContextBreakdownSegmentId, string>
  /** The free dots and the reserve: quieter than every segment. */
  free: string
  reserve: string
  /**
   * The length bars of the servers that are not loaded: a grey that is no
   * segment's colour, as that content is outside the window, and that still
   * holds 3:1 on the backgrounds.
   */
  notLoaded: string
  /**
   * The two strokes of the scale break in the bar's picture: the grey of
   * Not loaded, which is no segment's colour and holds 3:1, the threshold
   * for a graphic that is not text, on the backgrounds.
   */
  scaleBreak: string
  /** The terminal backgrounds the palette is made for, the two ends of a range. */
  backgrounds: readonly [string, string]
}

export const DARK: Palette = {
  name: 'dark',
  segments: {
    system: '#3A87FE',
    mcp: '#08ECE5',
    'global-instructions': '#745ABA',
    'project-instructions': '#4CC8FF',
    'auto-memory': '#B08DC4',
    'skills-agents': '#0B7B3C',
    other: '#B2B3B8',
    'compaction-summary': '#907D67',
    'tool-results': '#E27117',
    'skill-bodies': '#C42977',
    'task-reports': '#DAD6A6',
    injections: '#DD958F',
    prompts: '#D01F29',
    'claude-output': '#F1AE00',
    // Alone when the messages could not be read: never beside a split segment.
    conversation: '#E27117',
  },
  free: '#4A4A4A',
  reserve: '#5A5A5A',
  notLoaded: '#8A8A8A',
  scaleBreak: '#8A8A8A',
  backgrounds: ['#000000', '#1E1E1E'],
}

export const LIGHT: Palette = {
  name: 'light',
  segments: {
    system: '#4B5FCA',
    mcp: '#099A98',
    'global-instructions': '#5F297E',
    'project-instructions': '#146B89',
    'auto-memory': '#A576D7',
    'skills-agents': '#0E511A',
    other: '#68646D',
    // Dark: the ▓ texture lets a quarter of the light background through.
    'compaction-summary': '#49332B',
    'tool-results': '#D36C41',
    'skill-bodies': '#8B1649',
    'task-reports': '#948E61',
    injections: '#885555',
    prompts: '#8B010B',
    'claude-output': '#9C6F00',
    conversation: '#D36C41',
  },
  free: '#B8B8B8',
  reserve: '#A8A8A8',
  notLoaded: '#7A7A7A',
  scaleBreak: '#7A7A7A',
  backgrounds: ['#FFFFFF', '#F5F5F5'],
}

/**
 * The palette for a Claude Code theme name: a name that contains "light"
 * selects the light one; any other name, or none yet, the dark one.
 *
 * "auto" takes the dark one too, as a known limit: Claude Code resolves it
 * from the terminal's reported background, and the API gives a mod only the
 * setting's literal value, not the resolved light or dark.
 */
export function paletteFor(theme: string | null | undefined): Palette {
  return typeof theme === 'string' && theme.toLowerCase().includes('light') ? LIGHT : DARK
}

/** A segment's colour; an id the palette does not know takes Other's. */
export function colorOf(palette: Palette, id: string): string {
  return (palette.segments as Record<string, string>)[id] ?? palette.segments.other
}

/**
 * The background of a segment's edge cell, whose last eighth is the thin
 * separator: midway between the segment's colour and the theme's background.
 * The engine draws a focused or hovered Button inverted, so this colour then
 * fills seven eighths of the cell. Midway, it still reads as the segment's
 * (a one-cell segment does not vanish) and still differs from it (the
 * focused segment shows); at rest the eighth it shows reads as a gap.
 */
export function edgeColor(palette: Palette, id: string): string {
  return midway(colorOf(palette, id), palette.backgrounds[0])
}
