import { describe, expect, test } from 'claude-code/testing'

import { layoutBar } from '../hooks/layout'
import type { LayoutInput, LayoutPart, SegmentPart } from '../hooks/layout'

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
