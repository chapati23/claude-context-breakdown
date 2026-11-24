import { describe, expect, test } from 'claude-code/testing'

import { TEXTURED, TEXTURE_COVERAGE } from '../hooks/bar'
import { VISIONS, contrast, distance, hexToLab, inkOn, mix } from '../hooks/color'
import { DARK, LIGHT, colorOf, edgeColor, paletteFor } from '../hooks/palette'
import type { Palette } from '../hooks/palette'
import { BASELINE, CONVERSATION, SPLIT_IDS } from '../hooks/segments'

/**
 * The least CIEDE2000 distance between two segments that can become
 * neighbours, per vision. The light palette has less room: every colour must
 * be darker than L* 59 to keep 3:1 on #f5f5f5.
 */
const MIN_DISTANCE: Record<Palette['name'], Record<(typeof VISIONS)[number], number>> = {
  dark: { normal: 20, deuteranopia: 10, protanopia: 10 },
  light: { normal: 15, deuteranopia: 7, protanopia: 7 },
}
/** Least contrast of a segment against any background of its palette. */
const MIN_CONTRAST = 3
/** Least lightness step between segments next to each other in bar order. */
const MIN_LADDER_STEP = 11

const BASELINE_IDS = BASELINE.map(def => def.id)
const CONVERSATION_IDS = CONVERSATION.map(def => def.id)
const isSplit = (id: string) => (SPLIT_IDS as readonly string[]).includes(id)

/**
 * Every pair of segments that can be drawn side by side: absent and merged
 * segments drop out of the bar, so any two of one group can meet, and the
 * last baseline segment drawn can meet the first conversation one. The one
 * exception: "conversation" stands alone, never beside a split segment.
 */
function neighbourPairs(): [string, string][] {
  const ids = [...BASELINE_IDS, ...CONVERSATION_IDS]
  const pairs: [string, string][] = []
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const [a, b] = [ids[i]!, ids[j]!]
      if ((a === 'conversation' && isSplit(b)) || (b === 'conversation' && isSplit(a))) {
        continue
      }
      pairs.push([a, b])
    }
  }

  return pairs
}

for (const palette of [DARK, LIGHT]) describe(`the ${palette.name} palette`, () => {
  test('has a colour for every segment', () => {
    for (const id of [...BASELINE_IDS, ...CONVERSATION_IDS]) {
      expect(palette.segments[id]).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  test('keeps neighbours apart for normal vision, deuteranopia and protanopia', () => {
    const pairs = neighbourPairs()
    // 7 baseline and 8 conversation ids, less the 7 impossible pairs.
    expect(pairs).toHaveLength(98)
    const failures: string[] = []
    for (const vision of VISIONS) {
      const min = MIN_DISTANCE[palette.name][vision]
      for (const [a, b] of pairs) {
        const d = distance(colorOf(palette, a), colorOf(palette, b), vision)
        if (d < min) {
          failures.push(`${vision} ${a}/${b} ${d.toFixed(1)} < ${min}`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  test('gives every segment 3:1 contrast on its backgrounds, a texture as the eye averages it', () => {
    for (const id of [...BASELINE_IDS, ...CONVERSATION_IDS]) {
      for (const background of palette.backgrounds) {
        const color = colorOf(palette, id)
        // A texture lets the background through part of each cell.
        const seen = TEXTURED.has(id) ? mix(color, background, TEXTURE_COVERAGE) : color
        expect(contrast(seen, background)).toBeGreaterThanOrEqual(MIN_CONTRAST)
      }
    }
  })

  test('names each segment in black or white at 4.5:1 or more', () => {
    for (const id of [...BASELINE_IDS, ...CONVERSATION_IDS]) {
      const color = colorOf(palette, id)
      expect(contrast(inkOn(color), color)).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('draws the free dots and the reserve quieter than every segment, yet visible', () => {
    for (const background of palette.backgrounds) {
      const quietest = Math.min(
        ...[...BASELINE_IDS, ...CONVERSATION_IDS].map(id => contrast(colorOf(palette, id), background)),
      )
      for (const color of [palette.free, palette.reserve]) {
        expect(contrast(color, background)).toBeLessThan(quietest)
        expect(contrast(color, background)).toBeGreaterThanOrEqual(1.4)
      }
    }
  })

  test('draws the bars of the servers not loaded in a neutral that is no segment’s colour, at 3:1', () => {
    const segments = [...BASELINE_IDS, ...CONVERSATION_IDS].map(id => colorOf(palette, id))
    expect(palette.notLoaded).toMatch(/^#[0-9A-F]{6}$/)
    expect(segments).not.toContain(palette.notLoaded)
    expect([palette.free, palette.reserve]).not.toContain(palette.notLoaded)
    // A grey: no hue that could be read as a baseline or a conversation segment.
    const [, a, b] = hexToLab(palette.notLoaded)
    expect(Math.hypot(a, b)).toBeLessThan(2)
    for (const background of palette.backgrounds) {
      expect(contrast(palette.notLoaded, background)).toBeGreaterThanOrEqual(MIN_CONTRAST)
    }
  })

  test('steps lightness between segments next to each other in bar order', () => {
    // The summary is drawn in a texture, which sets it apart by itself; and
    // most sessions have none, so the segments either side of it meet.
    const order = [...BASELINE_IDS, ...CONVERSATION_IDS].filter(
      id => id !== 'conversation' && id !== 'compaction-summary',
    )
    for (let i = 1; i < order.length; i += 1) {
      const step = Math.abs(hexToLab(colorOf(palette, order[i - 1]!))[0] - hexToLab(colorOf(palette, order[i]!))[0])
      expect(step).toBeGreaterThanOrEqual(MIN_LADDER_STEP)
    }
  })

  test('keeps baseline in cool hues and conversation in warm ones', () => {
    const hue = (hex: string) => {
      const [, a, b] = hexToLab(hex)

      return { chroma: Math.hypot(a, b), angle: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }
    }
    // A gap of 25 degrees between the windows: a pink baseline segment
    // would read as conversation.
    for (const id of BASELINE_IDS) {
      const { chroma, angle } = hue(colorOf(palette, id))
      // Other is a grey: no hue to keep.
      if (chroma >= 10) {
        expect(angle).toBeGreaterThanOrEqual(130)
        expect(angle).toBeLessThanOrEqual(320)
      }
    }
    for (const id of CONVERSATION_IDS) {
      const { angle } = hue(colorOf(palette, id))
      expect(angle >= 345 || angle <= 110).toBe(true)
    }
  })
})

describe('edgeColor', () => {
  // The edge cell's background. At rest it is the separator's eighth: it
  // must stand apart from the segment. Under the engine's inversion of a
  // focused or hovered Button it fills seven eighths of the cell: it must
  // stand apart from the terminal, so a one-cell segment does not vanish.
  test('stands apart from the segment and from every background of its palette', () => {
    for (const palette of [DARK, LIGHT]) {
      for (const id of [...BASELINE_IDS, ...CONVERSATION_IDS]) {
        const edge = edgeColor(palette, id)
        expect(contrast(edge, colorOf(palette, id))).toBeGreaterThanOrEqual(1.5)
        for (const background of palette.backgrounds) {
          expect(contrast(edge, background)).toBeGreaterThanOrEqual(1.5)
        }
      }
    }
  })
})

describe('paletteFor', () => {
  test('a theme name with "light" in it picks the light palette', () => {
    for (const theme of ['light', 'light-daltonized', 'light-ansi', 'Light']) {
      expect(paletteFor(theme).name).toBe('light')
    }
  })

  test('any other name, and no name yet, pick the dark palette', () => {
    for (const theme of ['dark', 'dark-daltonized', 'dark-ansi', '', null, undefined]) {
      expect(paletteFor(theme).name).toBe('dark')
    }
  })

  test('"auto" picks the dark palette: the API does not say what it resolved to', () => {
    // A known limit, not a choice made for light terminals: see paletteFor.
    expect(paletteFor('auto').name).toBe('dark')
  })

  test('an unknown segment takes the colour of Other', () => {
    expect(colorOf(DARK, 'not-a-segment')).toBe(DARK.segments.other)
  })
})
