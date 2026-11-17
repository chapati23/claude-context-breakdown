import { describe, expect, test } from 'claude-code/testing'

import type { ContextBreakdownSnapshot } from '../types'
import { CHIP_GAP, EDGE, FILLED, TEXTURE, barChips, chipForms, chipsToDraw, placeChip, segmentCells, segmentRuns } from '../hooks/bar'
import type { SegmentPart } from '../hooks/layout'
import { LEGEND_JOIN, LEGEND_SWATCH_CELLS, MIN_BAR_WITH_LEGEND, bandModel, bandModelFor, legendCells, legendForms } from '../hooks/view'

const part = (id: string, cells: number, members = [id], tokens = 1000): SegmentPart => ({
  kind: 'segment',
  id,
  members,
  tokens,
  cells,
})

describe('segmentCells', () => {
  test('full blocks with a seven-eighths edge at the end', () => {
    expect(segmentCells('tool-results', 4)).toBe(`${FILLED}${FILLED}${FILLED}${EDGE}`)
    expect(segmentCells('system', 2)).toBe(`${FILLED}${EDGE}`)
  })

  test('a one-cell segment is the edge alone', () => {
    expect(segmentCells('prompts', 1)).toBe(EDGE)
  })

  test('the compaction summary is its texture, with no edge', () => {
    expect(segmentCells('compaction-summary', 3)).toBe(TEXTURE.repeat(3))
    expect(segmentCells('compaction-summary', 1)).toBe(TEXTURE)
  })

  test('no cells, no text; the scale is the cells given', () => {
    expect(segmentCells('system', 0)).toBe('')
    for (const cells of [1, 2, 7, 40]) {
      expect([...segmentCells('system', cells)]).toHaveLength(cells)
    }
  })
})

describe('segmentRuns', () => {
  // Two runs, so the band can give the fill its own colour as background
  // (it then reads the same inverted) and the edge a shade of it.
  test('splits the full blocks from the edge', () => {
    expect(segmentRuns('tool-results', 4)).toEqual({ fill: FILLED.repeat(3), edge: EDGE })
    expect(segmentRuns('prompts', 1)).toEqual({ fill: '', edge: EDGE })
    expect(segmentRuns('compaction-summary', 3)).toEqual({ fill: TEXTURE.repeat(3), edge: '' })
    expect(segmentRuns('system', 0)).toEqual({ fill: '', edge: '' })
  })
})

describe('chipForms', () => {
  const tokens: Record<string, number> = { 'tool-results': 114_000, injections: 65_000, prompts: 2900, 'task-reports': 100 }
  const tokensOf = (id: string) => tokens[id] ?? 0

  test('one segment: its name and its tokens, then its short name', () => {
    expect(chipForms(part('tool-results', 3), tokensOf)).toEqual([' Tool results 114k ', ' Tool results 114k '])
    expect(chipForms(part('injections', 3), tokensOf)).toEqual([' System notifications 65k ', ' Notifications 65k '])
  })

  test('a merged cell lists its members, then shortens to "name +N more" and the cell’s total', () => {
    expect(chipForms(part('injections', 3, ['injections', 'prompts'], 67_900), tokensOf)).toEqual([
      ' System notifications 65k + Your prompts 2.9k ',
      ' System notifications +1 more 68k ',
      ' Notifications +1 more 68k ',
    ])
    // The figure is the whole cell's, never the first member's alone.
    const [, short] = chipForms(part('tool-results', 3, ['tool-results', 'prompts', 'task-reports'], 117_000), tokensOf)
    expect(short).toBe(' Tool results +2 more 117k ')
  })

  test('the drawn segment comes first, wherever it stands among the members', () => {
    // A whole tiny group takes its largest member's place and colour.
    const [first] = chipForms(part('tool-results', 1, ['task-reports', 'tool-results']), tokensOf)
    expect(first).toBe(' Tool results 114k + Task reports 100 ')
  })
})

describe('placeChip', () => {
  const forms = [' Tool results 114k ']
  const width = forms[0]!.length

  test('right of the segment, one cell after it ends', () => {
    expect(CHIP_GAP).toBe(1)
    expect(placeChip(10, 5, 80, 100, forms)).toEqual({ text: forms[0], left: 16, side: 'right' })
  })

  test('flips to the left when it would run past the end of the bar', () => {
    // The segment ends at 75; 19 cells after the gap would end at 95.
    expect(placeChip(60, 15, 80, 100, forms)).toEqual({ text: forms[0], left: 59 - width, side: 'left' })
  })

  test('ends exactly at the bar end when that is all the room there is', () => {
    expect(placeChip(30, 5, 36 + width, 80, forms)).toEqual({ text: forms[0], left: 36, side: 'right' })
    // One cell less, and it flips: it ends one cell before the segment starts.
    expect(placeChip(30, 5, 35 + width, 80, forms)).toEqual({ text: forms[0], left: 29 - width, side: 'left' })
  })

  test('takes a shorter form inside the bar before it reaches over the total', () => {
    const merged = [' System notifications 65k + Your prompts 2.9k ', ' System notifications +1 more 68k ']
    // The long form would fit the row, but only over the total.
    expect(placeChip(0, 4, 40, 60, merged)).toEqual({ text: merged[1], left: 5, side: 'right' })
  })

  test('reaching over the total, it covers the total and the legend to the end of the row', () => {
    // Bar 24 cells, row 50: the segment ends at 20, the chip fits neither
    // side inside the bar, so it runs from 21 to the row's end at 50.
    const place = placeChip(4, 16, 24, 50, forms)
    expect(place).toEqual({ text: forms[0]!.padEnd(29), left: 21, side: 'right' })
    expect(place!.left + place!.text.length).toBe(50)
  })

  test('cuts the shortest form to the wider side when no form fits', () => {
    const place = placeChip(4, 20, 30, 36, forms)
    // Right has 12 cells to the row end, the gap takes one: cut to 11, and
    // it ends at the row's end.
    expect(place).toEqual({ text: ' Tool res… ', left: 25, side: 'right' })
    // Cut on the left, inside the bar: 13 cells before the segment.
    expect(placeChip(14, 4, 20, 24, forms)).toEqual({ text: ' Tool resul… ', left: 0, side: 'left' })
  })

  test('draws no chip where neither side has room to say anything', () => {
    expect(placeChip(2, 30, 32, 34, forms)).toBeNull()
    // Four cells beside the segment, one of them the gap: too few.
    expect(placeChip(4, 26, 30, 34, forms)).toBeNull()
  })

  // A shown chip holds its segment's hover group and the pointer: the cell
  // beside the segment stays uncovered, so a pointer walking along the bar
  // reaches the neighbour's Button there, and the chip moves on with it.
  test('never covers its segment or the cell beside it, never passes either end of the row', () => {
    const many = [' System notifications 65k + Your prompts 2.9k ', ' System notifications +1 more 68k ', ' Notifications +1 more 68k ']
    for (const row of [10, 20, 33, 47, 80]) {
      for (const label of [0, 5, 14]) {
        const bar = row - label
        for (let start = 0; start < bar; start += 1) {
          for (const cells of [1, 2, 5, 13]) {
            if (start + cells > bar) {
              continue
            }
            const place = placeChip(start, cells, bar, row, many)
            if (place === null) {
              continue
            }
            const end = place.left + place.text.length
            expect(place.left).toBeGreaterThanOrEqual(0)
            expect(end).toBeLessThanOrEqual(row)
            expect(end <= start - CHIP_GAP || place.left >= start + cells + CHIP_GAP).toBe(true)
            // Inside the bar, or over all of the total and legend: never a
            // part of them left beside it.
            expect(end <= bar || end === row).toBe(true)
          }
        }
      }
    }
  })
})

describe('barChips', () => {
  test('one chip per segment, placed from each segment’s own column', () => {
    const parts = [part('system', 3), part('tool-results', 4), { kind: 'free' as const, cells: 20 }]
    const chips = barChips(parts, 40, () => 2000)

    expect(chips.map(chip => [chip.id, chip.left, chip.side])).toEqual([
      ['system', 4, 'right'],
      ['tool-results', 8, 'right'],
    ])
  })

  test('a chip that cannot stay inside the bar covers the label to the row end', () => {
    // Bar 12 cells, then a space and an 18-cell total and legend: row 31.
    const parts = [part('tool-results', 10), { kind: 'free' as const, cells: 2 }]
    const [chip] = barChips(parts, 31, () => 114_000)
    expect(chip).toMatchObject({ left: 11, side: 'right' })
    expect(chip!.left + chip!.text.length).toBe(31)
    expect(chip!.text.trimEnd()).toBe(' Tool results 114k')
  })
})

describe('chipsToDraw', () => {
  const chips = barChips([part('system', 3), part('tool-results', 4), { kind: 'free' as const, cells: 30 }], 50, () => 2000)

  test('with the keyboard on a segment, that chip alone, shown', () => {
    expect(chips.map(chip => chip.id)).toEqual(['system', 'tool-results'])
    expect(chipsToDraw(chips, 'seg-tool-results')).toEqual([{ chip: chips[1], isForced: true }])
  })

  test('without it, every chip, each left to its hover group', () => {
    expect(chipsToDraw(chips, null)).toEqual(chips.map(chip => ({ chip, isForced: false })))
    // A key that names no chip (another mod's, or a segment with no room).
    expect(chipsToDraw(chips, 'seg-prompts')).toEqual(chips.map(chip => ({ chip, isForced: false })))
  })
})

/** 66k used of 200k: 26k baseline, 40k conversation, tool results the largest. */
function snapshot(over: Partial<ContextBreakdownSnapshot> = {}): ContextBreakdownSnapshot {
  return {
    window: 200_000,
    reserve: 33_000,
    baseline: [
      { id: 'system', tokens: 20_000 },
      { id: 'project-instructions', tokens: 4000 },
      { id: 'skills-agents', tokens: 2000 },
    ],
    conversation: [
      { id: 'tool-results', tokens: 30_000 },
      { id: 'prompts', tokens: 2000 },
      { id: 'claude-output', tokens: 8000 },
    ],
    deferred: [],
    notLoadedServers: [],
    isEstimate: false,
    staleTokens: null,
    charsPerToken: null,
    measuredAt: 0,
    ...over,
  }
}

/** The same fill, with injections in place of tool results: a long name and a short one. */
const INJECTIONS: Partial<ContextBreakdownSnapshot> = {
  conversation: [
    { id: 'injections', tokens: 30_000 },
    { id: 'prompts', tokens: 2000 },
    { id: 'claude-output', tokens: 8000 },
  ],
}

describe('the legend', () => {
  test('names the largest conversation segment and its share of what is used', () => {
    // 30k of 66k used: 45%, though it is 15% of the window.
    expect(legendForms(snapshot())).toEqual([{ id: 'tool-results', cell: 'tool-results', text: 'Tool results 45%' }])
    const forms = legendForms(snapshot(INJECTIONS))
    expect(forms.map(form => form.text)).toEqual(['System notifications 45%', 'Notifications 45%'])
  })

  test('marks its share with ~ while the figures are estimated, as the total is', () => {
    expect(legendForms(snapshot({ isEstimate: true }))[0]?.text).toBe('Tool results ~45%')
    expect(bandModel(snapshot({ isEstimate: true }), 80).label).toBe('~66k/200k 33%')
  })

  test('takes the colour of the cell that holds its segment when that one is merged', () => {
    // A 1M window: the conversation's segments are each under half a cell.
    // Claude output goes into Your prompts, then Tool results (the first)
    // into its right neighbour, Your prompts again.
    const s = snapshot({
      window: 1_000_000,
      reserve: 0,
      baseline: [{ id: 'system', tokens: 40_000 }],
      conversation: [
        { id: 'tool-results', tokens: 8000 },
        { id: 'prompts', tokens: 7000 },
        { id: 'claude-output', tokens: 6000 },
      ],
    })
    for (const columns of [60, 80]) {
      const model = bandModel(s, columns)
      const drawn = model.parts.flatMap(p => (p.kind === 'segment' ? [p] : []))
      expect(drawn.map(p => p.id)).toEqual(['system', 'prompts'])
      expect(drawn[1]?.members).toContain('tool-results')
      // It still names the largest segment, in the colour of the cell it is in.
      expect(model.legend).toMatchObject({ id: 'tool-results', cell: 'prompts' })
      expect(model.legend?.text).toMatch(/^Tool results /)
    }
    // A segment drawn as itself keeps its own colour.
    expect(bandModel(snapshot(), 80).legend?.cell).toBe('tool-results')
  })

  test('says nothing while no conversation is used', () => {
    expect(legendForms(snapshot({ conversation: [{ id: 'conversation', tokens: 0 }] }))).toEqual([])
  })

  test('sits right of the total while the bar keeps its cells', () => {
    const model = bandModel(snapshot(), 80)
    expect(model.label).toBe('66k/200k 33%')
    expect(model.legend?.text).toBe('Tool results 45%')
    const bar = model.parts.reduce((sum, p) => sum + p.cells, 0)
    // The join, the swatch and a space, then the words.
    expect(legendCells(model.legend!)).toBe(LEGEND_JOIN.length + LEGEND_SWATCH_CELLS + 'Tool results 45%'.length)
    expect(bar + 1 + model.label.length + legendCells(model.legend!)).toBe(79)
  })

  test('steps down to the short name, then goes first when the row is narrow', () => {
    const s = snapshot(INJECTIONS)
    const full = 'System notifications 45%'.length
    const short = 'Notifications 45%'.length
    const label = '66k/200k 33%'.length
    // Room for the bar's floor with the long name, then with the short one.
    const longFits = label + LEGEND_JOIN.length + LEGEND_SWATCH_CELLS + full + 2 + MIN_BAR_WITH_LEGEND
    const shortFits = label + LEGEND_JOIN.length + LEGEND_SWATCH_CELLS + short + 2 + MIN_BAR_WITH_LEGEND
    expect(bandModel(s, longFits).legend?.text).toBe('System notifications 45%')
    expect(bandModel(s, longFits - 1).legend?.text).toBe('Notifications 45%')
    expect(bandModel(s, shortFits).legend?.text).toBe('Notifications 45%')
    const narrow = bandModel(s, shortFits - 1)
    expect(narrow.legend).toBeNull()
    expect(narrow.label).toBe('66k/200k 33%')
    expect(narrow.parts.length).toBeGreaterThan(0)
    // Then as before: the bar goes, then the percent.
    expect(bandModel(s, 17).parts).toEqual([])
    expect(bandModel(s, 17).label).toBe('66k/200k 33%')
    expect(bandModel(s, 12).label).toBe('66k/200k')
  })

  test('no chip ever reaches past the row it is drawn on', () => {
    for (let columns = 5; columns <= 160; columns += 1) {
      const model = bandModel(snapshot(), columns)
      const row =
        model.parts.reduce((sum, p) => sum + p.cells, 0) +
        (model.parts.length > 0 ? 1 : 0) +
        model.label.length +
        (model.legend === null ? 0 : legendCells(model.legend))
      expect(row).toBeLessThan(Math.max(columns, 1))
      const bar = model.parts.reduce((sum, p) => sum + p.cells, 0)
      for (const chip of model.chips) {
        expect(chip.left).toBeGreaterThanOrEqual(0)
        expect(chip.left + chip.text.length).toBeLessThanOrEqual(row)
        // No fragment of the total or the legend beside a chip.
        expect(chip.left + chip.text.length <= bar || chip.left + chip.text.length === row).toBe(true)
      }
    }
  })
})

describe('bandModelFor', () => {
  test('only the terminal gets chips: elsewhere a segment is a native button, not text cells', () => {
    const s = snapshot()
    expect(bandModelFor(s, 80, 'terminal').chips.length).toBeGreaterThan(0)
    for (const surface of ['desktop', 'mobile', 'vscode', 'some-new-surface']) {
      const model = bandModelFor(s, 80, surface)
      expect(model.chips).toEqual([])
      // Everything else is the terminal's model.
      expect({ ...model, chips: undefined }).toEqual({ ...bandModel(s, 80), chips: undefined })
    }
  })
})
