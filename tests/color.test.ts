import { describe, expect, test } from 'claude-code/testing'

import {
  MACHADO,
  contrast,
  deltaE2000,
  distance,
  hexToLab,
  inkOn,
  luminance,
  mix,
  parseHex,
  simulate,
  toHex,
} from '../hooks/color'
import type { Lab } from '../hooks/color'

/** `actual` rounds to `expected` at `places` decimal places. */
function near(actual: number, expected: number, places: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.5 * 10 ** -places)
}

describe('CIEDE2000', () => {
  // Sharma, Wu and Dalal (2005), "The CIEDE2000 color-difference formula:
  // implementation notes, supplementary test data", pairs 1, 2, 7, 13, 15,
  // 17 to 21, 25, 26, 34 and 32.
  const PAIRS: [Lab, Lab, number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
    [[50, 2.5, 0], [58, 24, 15], 19.4535],
    [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ]

  test('matches the published test data to four places', () => {
    for (const [a, b, expected] of PAIRS) {
      near(deltaE2000(a, b), expected, 4)
      // Symmetric.
      near(deltaE2000(b, a), expected, 4)
    }
  })

  test('is zero for one colour', () => {
    expect(deltaE2000([40, 10, -20], [40, 10, -20])).toBe(0)
  })
})

describe('sRGB to CIELAB (D65)', () => {
  test('matches the standard values of the primaries, white and grey', () => {
    const cases: [string, Lab][] = [
      ['#FFFFFF', [100, 0, 0]],
      ['#FF0000', [53.2408, 80.0925, 67.2032]],
      ['#00FF00', [87.7347, -86.1827, 83.1793]],
      ['#0000FF', [32.297, 79.1875, -107.8602]],
      ['#808080', [53.585, 0, 0]],
      ['#000000', [0, 0, 0]],
    ]
    for (const [hex, [l, a, b]] of cases) {
      const lab = hexToLab(hex)
      near(lab[0], l, 2)
      near(lab[1], a, 2)
      near(lab[2], b, 2)
    }
  })

  test('reads short and long hex in any case, and writes it back', () => {
    expect(parseHex('#fff')).toEqual([1, 1, 1])
    expect(toHex(parseHex('#1e1e1e'))).toBe('#1E1E1E')
    expect(() => parseHex('red')).toThrow()
  })
})

describe('WCAG contrast', () => {
  test('matches the WCAG 2 reference figures', () => {
    near(contrast('#000000', '#FFFFFF'), 21, 6)
    expect(contrast('#FFFFFF', '#FFFFFF')).toBe(1)
    near(luminance('#808080'), 0.2159, 4)
    // The usual grey that just misses 4.5:1 on white.
    near(contrast('#777777', '#FFFFFF'), 4.48, 2)
    expect(contrast('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
  })

  test('mixes a partly covered cell in linear light', () => {
    // Half white on black is linear 0.5: sRGB 0.7354, 188 (BC), not 128.
    expect(mix('#FFFFFF', '#000000', 0.5)).toBe('#BCBCBC')
    expect(mix('#49332B', '#F5F5F5', 1)).toBe('#49332B')
    expect(mix('#49332B', '#F5F5F5', 0)).toBe('#F5F5F5')
  })

  test('picks the ink that reads better', () => {
    expect(inkOn('#FFFF00')).toBe('#000000')
    expect(inkOn('#000080')).toBe('#FFFFFF')
  })
})

describe('colour-blind simulation (Machado 2009, severity 1.0)', () => {
  test('each matrix row sums to 1, so white, black and greys stay', () => {
    for (const m of Object.values(MACHADO)) {
      for (const row of m) {
        near(row[0] + row[1] + row[2], 1, 5)
      }
    }
    for (const vision of ['deuteranopia', 'protanopia'] as const) {
      expect(toHex(simulate('#FFFFFF', vision))).toBe('#FFFFFF')
      expect(toHex(simulate('#000000', vision))).toBe('#000000')
      expect(toHex(simulate('#777777', vision))).toBe('#777777')
    }
  })

  test('maps pure red as the published matrices do', () => {
    // Red is (1, 0, 0) in linear RGB, so its image is the matrix's first
    // column, clamped: deuteranopia (0.367322, 0.280085, 0).
    // Gamma-encoded: 0.367322 is 163 (A3), 0.280085 is 144 (90).
    expect(toHex(simulate('#FF0000', 'deuteranopia'))).toBe('#A39000')
    // Protanopia (0.152286, 0.114503, 0): 109 (6D), 95 (5F).
    expect(toHex(simulate('#FF0000', 'protanopia'))).toBe('#6D5F00')
  })

  test('merges the red and green a deuteranope confuses', () => {
    // The critique's measure of the old palette: tool results against
    // Claude output, about 1.0 under deuteranopia, 40 for normal vision.
    expect(distance('#D9661A', '#7F9C0D', 'deuteranopia')).toBeLessThan(1.5)
    expect(distance('#D9661A', '#7F9C0D', 'normal')).toBeGreaterThan(30)
  })
})
