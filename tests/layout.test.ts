import { describe, expect, test } from 'claude-code/testing'

import { SCALE_BREAK_CELLS } from '../hooks/bar'
import {
  COMPRESS_FREE_SCALE,
  COMPRESS_MAX_SHARE,
  COMPRESS_MIN_CELLS,
  COMPRESS_MIN_WINDOW,
  isCompressed,
  layoutBar,
  layoutCompressed,
} from '../hooks/layout'
import type { LayoutInput, LayoutPart, SegmentPart } from '../hooks/layout'
import { MIN_BAR_WITH_LEGEND } from '../hooks/view'

const cellsOf = (parts: readonly LayoutPart[]) => parts.reduce((sum, part) => sum + part.cells, 0)
const segmentsOf = (parts: readonly LayoutPart[]) =>
  parts.filter((part): part is SegmentPart => part.kind === 'segment')
const find = (parts: readonly LayoutPart[], kind: LayoutPart['kind']) =>
  parts.find(part => part.kind === kind)

describe('layoutBar', () => {
  test('sums to the width on a 200,000 window', () => {
    const input: LayoutInput = {
      width: 60,
      window: 200_000,
      groups: [
        [
          { id: 'system', tokens: 24_000 },
          { id: 'project-instructions', tokens: 3000 },
        ],
        [
          { id: 'tool-results', tokens: 40_000 },
          { id: 'claude-output', tokens: 9000 },
        ],
      ],
      reserve: 33_000,
    }
    const parts = layoutBar(input)

    expect(cellsOf(parts)).toBe(60)
    expect(segmentsOf(parts).map(part => part.id)).toEqual([
      'system',
      'project-instructions',
      'tool-results',
      'claude-output',
    ])
    // 24k of 200k over 60 cells is 7.2 cells.
    expect(segmentsOf(parts)[0]?.cells).toBe(7)
    expect(find(parts, 'reserve')?.cells).toBe(10)
    expect(find(parts, 'free')?.cells).toBeGreaterThan(0)
  })

  test('sums to the width on a 1,000,000 window', () => {
    const parts = layoutBar({
      width: 50,
      window: 1_000_000,
      groups: [
        [
          { id: 'system', tokens: 24_000 },
          { id: 'mcp', tokens: 4500 },
          { id: 'global-instructions', tokens: 7900 },
        ],
        [{ id: 'tool-results', tokens: 117_000 }],
      ],
      reserve: 33_000,
    })

    expect(cellsOf(parts)).toBe(50)
    expect(find(parts, 'reserve')?.cells).toBe(2)
  })

  test('gives every drawn segment at least one cell', () => {
    const parts = layoutBar({
      width: 40,
      window: 1_000_000,
      groups: [
        [
          { id: 'system', tokens: 30_000 },
          { id: 'auto-memory', tokens: 15_000 },
        ],
        [{ id: 'prompts', tokens: 15_000 }],
      ],
      reserve: 0,
    })

    // 15k of 1M over 40 cells is 0.6 of a cell: rounded up to the floor of one.
    for (const part of segmentsOf(parts)) {
      expect(part.cells).toBeGreaterThanOrEqual(1)
    }
    expect(cellsOf(parts)).toBe(40)
  })

  test('merges a segment under half a cell into its neighbour in the group', () => {
    const parts = layoutBar({
      width: 40,
      window: 1_000_000,
      groups: [
        [
          { id: 'system', tokens: 30_000 },
          { id: 'mcp', tokens: 5000 },
          { id: 'global-instructions', tokens: 30_000 },
        ],
        [{ id: 'tool-results', tokens: 60_000 }],
      ],
      reserve: 0,
    })
    const segments = segmentsOf(parts)

    // 5k is 0.2 of a cell: the segment to its left takes its tokens.
    expect(segments.map(part => part.id)).toEqual(['system', 'global-instructions', 'tool-results'])
    expect(segments[0]?.members).toEqual(['system', 'mcp'])
    expect(segments[0]?.tokens).toBe(35_000)
  })

  test('merges the first segment of a group into its right neighbour', () => {
    const parts = layoutBar({
      width: 40,
      window: 1_000_000,
      groups: [
        [{ id: 'system', tokens: 30_000 }],
        [
          { id: 'compaction-summary', tokens: 2000 },
          { id: 'tool-results', tokens: 60_000 },
        ],
      ],
      reserve: 0,
    })

    expect(segmentsOf(parts).map(part => part.id)).toEqual(['system', 'tool-results'])
    expect(segmentsOf(parts)[1]?.members).toEqual(['tool-results', 'compaction-summary'])
  })

  test('never merges across groups', () => {
    const parts = layoutBar({
      width: 40,
      window: 1_000_000,
      groups: [
        [
          { id: 'system', tokens: 30_000 },
          { id: 'other', tokens: 3000 },
        ],
        [
          { id: 'prompts', tokens: 3000 },
          { id: 'claude-output', tokens: 30_000 },
        ],
      ],
      reserve: 0,
    })

    expect(segmentsOf(parts).map(part => part.members)).toEqual([
      ['system', 'other'],
      ['claude-output', 'prompts'],
    ])
  })

  test('draws a whole group under half a cell as one cell', () => {
    const parts = layoutBar({
      width: 40,
      window: 1_000_000,
      groups: [
        [{ id: 'system', tokens: 300_000 }],
        [
          { id: 'prompts', tokens: 3000 },
          { id: 'claude-output', tokens: 5000 },
        ],
      ],
      reserve: 0,
    })
    const conversation = segmentsOf(parts)[1]

    expect(conversation?.id).toBe('claude-output')
    expect(conversation?.members).toEqual(['prompts', 'claude-output'])
    expect(conversation?.cells).toBe(1)
    expect(cellsOf(parts)).toBe(40)
  })

  test('draws only free space for an empty window', () => {
    expect(
      layoutBar({ width: 30, window: 0, groups: [[{ id: 'system', tokens: 10 }]], reserve: 0 }),
    ).toEqual([{ kind: 'free', cells: 30 }])
    expect(layoutBar({ width: 0, window: 1000, groups: [], reserve: 0 })).toEqual([])
  })

  test('draws an empty conversation as free space up to the reserve', () => {
    const parts = layoutBar({ width: 20, window: 200_000, groups: [[], []], reserve: 20_000 })

    expect(parts).toEqual([
      { kind: 'free', cells: 18 },
      { kind: 'reserve', cells: 2 },
    ])
  })

  test('keeps an over-full window inside the row', () => {
    const parts = layoutBar({
      width: 30,
      window: 200_000,
      groups: [
        [{ id: 'system', tokens: 100_000 }],
        [
          { id: 'tool-results', tokens: 120_000 },
          { id: 'claude-output', tokens: 20_000 },
        ],
      ],
      reserve: 33_000,
    })

    expect(cellsOf(parts)).toBe(30)
    expect(find(parts, 'free')).toBeUndefined()
    expect(find(parts, 'reserve')).toBeUndefined()
  })

  test('shrinks the reserve to one cell when the used content alone still fits', () => {
    // 90 used of 100, plus a reserve of 33: over-full by the reserve only.
    const parts = layoutBar({
      width: 20,
      window: 100,
      groups: [[{ id: 'system', tokens: 60 }], [{ id: 'tool-results', tokens: 30 }]],
      reserve: 33,
    })

    expect(cellsOf(parts)).toBe(20)
    expect(find(parts, 'free')).toBeUndefined()
    expect(find(parts, 'reserve')?.cells).toBeGreaterThanOrEqual(1)
    expect(segmentsOf(parts).map(part => part.id)).toEqual(['system', 'tool-results'])
  })

  test('drops the smallest segments when the row is narrower than their count', () => {
    const parts = layoutBar({
      width: 2,
      window: 100,
      groups: [
        [
          { id: 'system', tokens: 50 },
          { id: 'mcp', tokens: 30 },
        ],
        [{ id: 'prompts', tokens: 20 }],
      ],
      reserve: 0,
    })

    expect(cellsOf(parts)).toBe(2)
  })

  test('hands rounding spare to the reserve when nothing is free', () => {
    // 3.4, 3.3 and 3.3 cells all round down, leaving one spare cell.
    const parts = layoutBar({
      width: 10,
      window: 100,
      groups: [
        [
          { id: 'system', tokens: 34 },
          { id: 'mcp', tokens: 33 },
        ],
      ],
      reserve: 33,
    })

    expect(cellsOf(parts)).toBe(10)
    expect(find(parts, 'free')).toBeUndefined()
    expect(find(parts, 'reserve')?.cells).toBe(4)
  })
})

/**
 * The early session of a 1M window: 69k used (System 24k, MCP 2.8k, Global
 * instructions 8.2k, Skills 9.5k; Tool results 7k, System notifications
 * 17k, Your prompts 77, Claude output 80), scaled to `used` tokens.
 */
function early(used: number): LayoutInput['groups'] {
  const k = used / 68_657
  const scaled = (pairs: [string, number][]) => pairs.map(([id, tokens]) => ({ id, tokens: tokens * k }))

  return [
    scaled([
      ['system', 24_000],
      ['mcp', 2800],
      ['global-instructions', 8200],
      ['skills-agents', 9500],
    ]),
    scaled([
      ['tool-results', 7000],
      ['injections', 17_000],
      ['prompts', 77],
      ['claude-output', 80],
    ]),
  ]
}

describe('the compressed bar', () => {
  test('starts compressing at the same bar width as the legend', () => {
    // A bar the band draws beside a legend can always hold the break.
    expect(COMPRESS_MIN_CELLS).toBe(MIN_BAR_WITH_LEGEND)
  })

  test('holds its invariants over widths 20 to 200 and use up to 125k, with and without a reserve', () => {
    let compressed = 0
    for (const reserve of [0, 33_000]) {
      for (let used = 0; used <= 125_000; used += 2500) {
        for (let width = 20; width <= 200; width += 1) {
          const groups = early(used)
          if (!isCompressed(used, reserve, 1_000_000, width, groups)) {
            continue
          }
          compressed += 1
          const parts = layoutCompressed({ width, window: 1_000_000, groups, reserve })
          const at = parts.findIndex(part => part.kind === 'break')
          const mark = parts[at]
          // (a) The cells sum to the width.
          expect(cellsOf(parts)).toBe(width)
          // (b) The segments, the free part and the reserve come from one
          // scale: the same layout of the held tokens and a 32nd of the free
          // space, less the break's cells.
          const held = used + reserve
          const shown = held + (1_000_000 - held) / COMPRESS_FREE_SCALE
          const scaled = layoutBar({ width: width - SCALE_BREAK_CELLS, window: shown, groups, reserve })
          expect(parts.filter(part => part.kind !== 'break')).toEqual(scaled)
          // (c) One break, after a free part of at least a cell, before the reserve.
          expect(parts.filter(part => part.kind === 'break')).toHaveLength(1)
          expect(parts[at - 1]?.kind).toBe('free')
          expect(parts[at - 1]!.cells).toBeGreaterThanOrEqual(1)
          expect(parts.slice(at + 1).every(part => part.kind === 'reserve')).toBe(true)
          expect(find(parts, 'reserve') === undefined).toBe(reserve === 0)
          // (d) It leaves out free tokens only.
          expect(mark?.kind === 'break' && mark.omitted).toBe(1_000_000 - shown)
          expect(held).toBeLessThanOrEqual(1_000_000 * COMPRESS_MAX_SHARE)
          // (e) Once use and the reserve pass 40k, they get more cells than free space.
          if (held >= 40_000) {
            expect(cellsOf(parts.filter(part => part.kind === 'segment' || part.kind === 'reserve'))).toBeGreaterThan(parts[at - 1]!.cells)
          }
        }
      }
    }
    expect(compressed).toBeGreaterThan(1000)
  })

  test('compresses while use and the reserve fill an eighth of the window or less', () => {
    const at = (used: number, reserve: number, window = 1_000_000, width = 100) => isCompressed(used, reserve, window, width)
    // Exactly an eighth compresses; one token more does not.
    expect(at(92_000, 33_000)).toBe(true)
    expect(at(92_001, 33_000)).toBe(false)
    expect(at(125_000, 0)).toBe(true)
    expect(at(125_001, 0)).toBe(false)
    // A reserve below zero counts as none.
    expect(at(125_000, -5)).toBe(true)
    // Only a window of 500k or more.
    expect(at(10_000, 0, COMPRESS_MIN_WINDOW)).toBe(true)
    expect(at(10_000, 0, 499_999)).toBe(false)
    expect(at(0, 0, 200_000)).toBe(false)
    // Only a bar of 20 cells or more.
    expect(at(10_000, 33_000, 1_000_000, 20)).toBe(true)
    expect(at(10_000, 33_000, 1_000_000, 19)).toBe(false)
    expect(at(10_000, 33_000, 1_000_000, 19.9)).toBe(false)
  })

  test('does not compress when the compressed bar would keep no free cell', () => {
    // Seventeen segments, each under a cell of the compressed bar's 17: each
    // takes its one-cell floor, and no free cell is left, though their tokens
    // leave free space.
    const groups = [Array.from({ length: 17 }, (_, i) => ({ id: `s${i}`, tokens: 7000 }))]
    const used = 17 * 7000
    expect(used).toBeLessThanOrEqual(1_000_000 * COMPRESS_MAX_SHARE)
    const shown = used + (1_000_000 - used) / COMPRESS_FREE_SCALE
    expect(layoutBar({ width: 17, window: shown, groups, reserve: 0 }).find(part => part.kind === 'free')).toBeUndefined()
    expect(isCompressed(used, 0, 1_000_000, 20, groups)).toBe(false)
    // One segment of the same tokens leaves room.
    expect(isCompressed(used, 0, 1_000_000, 20)).toBe(true)
  })

  test('draws the early 1M session with the break between free space and the reserve', () => {
    // The band at 150 columns: a bar of 105 cells, 102 of them at one scale.
    const parts = layoutCompressed({ width: 105, window: 1_000_000, groups: early(68_657), reserve: 33_000 })
    expect(parts.map(part => (part.kind === 'segment' ? `${part.id} ${part.cells}` : `${part.kind} ${part.cells}`))).toEqual([
      'system 19',
      'mcp 2',
      'global-instructions 6',
      'skills-agents 7',
      'tool-results 6',
      'injections 13',
      'free 23',
      'break 3',
      'reserve 26',
    ])
    // The segments get 53 cells, most of the bar; at true scale they get 8.
    const linear = layoutBar({ width: 105, window: 1_000_000, groups: early(68_657), reserve: 33_000 })
    expect(segmentsOf(parts).reduce((sum, part) => sum + part.cells, 0)).toBe(53)
    expect(segmentsOf(linear).reduce((sum, part) => sum + part.cells, 0)).toBe(8)
  })

  test('puts the break at the end when there is no reserve', () => {
    const parts = layoutCompressed({ width: 40, window: 1_000_000, groups: early(50_000), reserve: 0 })
    expect(parts.map(part => part.kind).slice(-2)).toEqual(['free', 'break'])
    expect(cellsOf(parts)).toBe(40)
  })
})
