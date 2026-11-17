// Colour maths for the palette and its tests: sRGB hex to CIELAB (D65),
// CIEDE2000 distance, WCAG contrast, and colour-blind simulation after
// Machado, Oliveira and Fernandes (2009) at severity 1.0.

/** sRGB channels, 0 to 1, gamma-encoded. */
export type Rgb = readonly [number, number, number]

/** CIELAB under D65: L* 0 to 100, a* and b* signed. */
export type Lab = readonly [number, number, number]

export type Vision = 'normal' | 'deuteranopia' | 'protanopia'

export const VISIONS: readonly Vision[] = ['normal', 'deuteranopia', 'protanopia']

type Matrix = readonly [Rgb, Rgb, Rgb]

/**
 * Machado 2009, severity 1.0, applied to linear RGB (as colorspacious does).
 * Each row sums to 1, so white and black stay as they are.
 */
export const MACHADO: Record<Exclude<Vision, 'normal'>, Matrix> = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
}

/** "#RRGGBB" or "#RGB", any case. Throws on anything else. */
export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (m === null) {
    throw new Error(`not a hex colour: ${hex}`)
  }
  const digits = m[1]!.length === 3 ? [...m[1]!].map(d => d + d).join('') : m[1]!

  return [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16) / 255) as unknown as Rgb
}

export function toHex(rgb: Rgb): string {
  return `#${rgb
    .map(c => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`
}

export function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function fromLinear(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}

/**
 * What the eye averages a cell to when `fg` covers `coverage` of it and `bg`
 * the rest: the two mixed in linear light.
 */
export function mix(fg: string, bg: string, coverage: number): string {
  const back = parseHex(bg)

  return toHex(parseHex(fg).map((c, i) => fromLinear(coverage * toLinear(c) + (1 - coverage) * toLinear(back[i]!))) as unknown as Rgb)
}

/** WCAG 2 relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(toLinear) as unknown as Rgb

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]

  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The colour between `fg` and `bg`, mixed in linear light, that stands as far
 * from each in contrast: its contrast to both is the square root of theirs.
 */
export function midway(fg: string, bg: string): string {
  const target = Math.sqrt(contrast(fg, bg))
  // Contrast to `bg` grows with the share of `fg`: halve the range.
  let low = 0
  let high = 1
  for (let i = 0; i < 24; i++) {
    const share = (low + high) / 2
    if (contrast(mix(fg, bg, share), bg) < target) {
      low = share
    } else {
      high = share
    }
  }

  return mix(fg, bg, high)
}

/** Black or white, whichever reads better on `hex`. */
export function inkOn(hex: string): '#000000' | '#FFFFFF' {
  return contrast(hex, '#000000') >= contrast(hex, '#FFFFFF') ? '#000000' : '#FFFFFF'
}

// D65 white of the sRGB primaries.
const XN = 0.95047
const ZN = 1.08883

function labF(t: number): number {
  const d = 6 / 29

  return t > d ** 3 ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29
}

export function linearToLab(lin: Rgb): Lab {
  const [r, g, b] = lin
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b
  const fx = labF(x / XN)
  const fy = labF(y)
  const fz = labF(z / ZN)

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function hexToLab(hex: string): Lab {
  return linearToLab(parseHex(hex).map(toLinear) as unknown as Rgb)
}

/** The colour as a viewer with that vision sees it, as gamma-encoded sRGB. */
export function simulate(hex: string, vision: Vision): Rgb {
  const rgb = parseHex(hex)
  if (vision === 'normal') {
    return rgb
  }
  const lin = rgb.map(toLinear)
  const m = MACHADO[vision]

  return m.map(row => fromLinear(Math.min(1, Math.max(0, row[0] * lin[0]! + row[1] * lin[1]! + row[2] * lin[2]!)))) as unknown as Rgb
}

const rad = (deg: number) => (deg * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** CIEDE2000 colour difference (kL = kC = kH = 1). */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [l1, a1, b1] = lab1
  const [l2, a2, b2] = lab2
  const c1 = Math.hypot(a1, b1)
  const c2 = Math.hypot(a2, b2)
  const cBar7 = ((c1 + c2) / 2) ** 7
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)))
  const a1p = (1 + g) * a1
  const a2p = (1 + g) * a2
  const c1p = Math.hypot(a1p, b1)
  const c2p = Math.hypot(a2p, b2)
  const hue = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360)
  const h1p = hue(b1, a1p)
  const h2p = hue(b2, a2p)

  const dLp = l2 - l1
  const dCp = c2p - c1p
  let dhp = 0
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) {
      dhp -= 360
    } else if (dhp < -180) {
      dhp += 360
    }
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dhp / 2))

  const lBarP = (l1 + l2) / 2
  const cBarP = (c1p + c2p) / 2
  let hBarP = h1p + h2p
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) {
      hBarP /= 2
    } else {
      hBarP = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2
    }
  }
  const t =
    1 -
    0.17 * Math.cos(rad(hBarP - 30)) +
    0.24 * Math.cos(rad(2 * hBarP)) +
    0.32 * Math.cos(rad(3 * hBarP + 6)) -
    0.2 * Math.cos(rad(4 * hBarP - 63))
  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2))
  const cBarP7 = cBarP ** 7
  const rc = 2 * Math.sqrt(cBarP7 / (cBarP7 + 25 ** 7))
  const sl = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2)
  const sc = 1 + 0.045 * cBarP
  const sh = 1 + 0.015 * cBarP * t
  const rt = -Math.sin(rad(2 * dTheta)) * rc

  return Math.sqrt((dLp / sl) ** 2 + (dCp / sc) ** 2 + (dHp / sh) ** 2 + rt * (dCp / sc) * (dHp / sh))
}

/** CIEDE2000 between two hex colours as a viewer with `vision` sees them. */
export function distance(a: string, b: string, vision: Vision = 'normal'): number {
  const lab = (hex: string) => linearToLab(simulate(hex, vision).map(toLinear) as unknown as Rgb)

  return deltaE2000(lab(a), lab(b))
}
