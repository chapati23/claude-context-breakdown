import { describe, expect, test } from 'claude-code/testing'

import type { ContextBreakdownSnapshot } from '../types'
import {
  ADDED_CELLS,
  TABLE_MAX_COLUMNS,
  columnHeader,
  crumbFor,
  factsRow,
  figuresText,
  headingText,
  largestOf,
  lengthBar,
  lengthBarParts,
  lineFacts,
  listFacts,
  nameAndBarCells,
  notLoadedHeading,
  notLoadedRows,
  rowCells,
  serverNames,
  serversCrumb,
  serversRowText,
  tableLayout,
  windowText,
  withAdded,
} from '../hooks/table'
import { cellWidth } from '../hooks/text'
import { LOW_FREE_SHARE, fit, headingLine, isLowFree, paneHeading } from '../hooks/view'

/** The session the critique looked at: 283k of 1M used, 33k reserve. */
const REAL: ContextBreakdownSnapshot = {
  window: 1_000_000,
  reserve: 33_000,
  baseline: [
    { id: 'system', tokens: 24_300 },
    { id: 'mcp', tokens: 5500 },
    { id: 'global-instructions', tokens: 7900 },
    { id: 'project-instructions', tokens: 0 },
    { id: 'auto-memory', tokens: 976 },
    { id: 'skills-agents', tokens: 9100 },
  ],
  conversation: [
    { id: 'compaction-summary', tokens: 7800 },
    { id: 'tool-results', tokens: 114_400 },
    { id: 'injections', tokens: 65_000 },
    { id: 'prompts', tokens: 2900 },
    { id: 'claude-output', tokens: 45_000 },
  ],
  deferred: [],
  notLoadedServers: [],
  isEstimate: false,
  staleTokens: null,
  charsPerToken: 1,
  measuredAt: 0,
}
const USED = 282_876

describe('lengthBar', () => {
  test('the largest row fills the bar', () => {
    expect(lengthBar(114_400, 114_400, 12)).toBe('████████████')
    expect(lengthBar(114_400, 114_400, 8)).toBe('████████')
  })

  test('the rest of a cell is an eighth block', () => {
    // 65k of 114.4k in 12 cells: 54.5 eighths, 55 drawn: six cells and seven eighths.
    expect(lengthBar(65_000, 114_400, 12)).toBe('██████▉     ')
    expect(lengthBar(50, 100, 12)).toBe('██████      ')
    expect(lengthBar(1, 16, 2)).toBe('▏ ')
    expect(lengthBar(3, 16, 2)).toBe('▍ ')
  })

  test('a tiny row above zero gets one eighth; a zero row none', () => {
    expect(lengthBar(1, 1_000_000, 12)).toBe(`▏${' '.repeat(11)}`)
    expect(lengthBar(0, 114_400, 12)).toBe(' '.repeat(12))
    expect(lengthBar(5, 0, 12)).toBe(' '.repeat(12))
    expect(lengthBar(5, 10, 0)).toBe('')
  })

  test('the compaction summary draws whole cells in its texture and its rest as an eighth', () => {
    expect(lengthBar(114_400, 114_400, 12, 'compaction-summary')).toBe('▓'.repeat(12))
    expect(lengthBar(65_000, 114_400, 12, 'compaction-summary')).toBe('▓▓▓▓▓▓▉     ')
    // Under one cell there is no texture to draw: the same eighth as a plain row.
    expect(lengthBar(7800, 114_400, 12, 'compaction-summary')).toBe(`▉${' '.repeat(11)}`)
    expect(lengthBar(1, 114_400, 12, 'compaction-summary')).toBe(`▏${' '.repeat(11)}`)
  })

  test('the bars keep the order of the tokens, the textured one too', () => {
    // Eighths a bar draws: a whole cell (plain or textured) is eight.
    const eighthsOf = (bar: string) =>
      [...bar].reduce((sum, glyph) => sum + (glyph === '█' || glyph === '▓' ? 8 : Math.max(0, ' ▏▎▍▌▋▊▉'.indexOf(glyph))), 0)
    const rows = [...REAL.baseline, ...REAL.conversation].sort((a, b) => a.tokens - b.tokens)
    for (const cells of [4, 8, 12]) {
      const drawn = rows.map(row => eighthsOf(lengthBar(row.tokens, 114_400, cells, row.id)))
      for (let k = 1; k < drawn.length; k += 1) {
        expect(drawn[k]!).toBeGreaterThanOrEqual(drawn[k - 1]!)
      }
    }
    // Global instructions 7.9k against the summary's 7.8k in 4 cells: never shorter.
    expect(eighthsOf(lengthBar(7900, 114_400, 4))).toBeGreaterThanOrEqual(eighthsOf(lengthBar(7800, 114_400, 4, 'compaction-summary')))
  })

  test('always as wide as asked', () => {
    for (const cells of [1, 4, 8, 12]) {
      for (const tokens of [0, 1, 999, 57_200, 114_400]) {
        expect(cellWidth(lengthBar(tokens, 114_400, cells))).toBe(cells)
      }
    }
  })
})

describe('lengthBarParts', () => {
  // Three runs, so the pane can draw whole cells on their own colour and
  // leave the padding uncoloured: a row Button is drawn inverted under the
  // focus ring or the pointer.
  test('whole cells, the eighth block and the padding apart', () => {
    expect(lengthBarParts(65_000, 114_400, 12)).toEqual({ full: '██████', rest: '▉', pad: '     ' })
    expect(lengthBarParts(114_400, 114_400, 4)).toEqual({ full: '████', rest: '', pad: '' })
    expect(lengthBarParts(1, 16, 2)).toEqual({ full: '', rest: '▏', pad: ' ' })
    expect(lengthBarParts(0, 114_400, 3)).toEqual({ full: '', rest: '', pad: '   ' })
    expect(lengthBarParts(65_000, 114_400, 12, 'compaction-summary')).toEqual({ full: '▓▓▓▓▓▓', rest: '▉', pad: '     ' })
  })
})

describe('tableLayout', () => {
  // The real level 1: the widest name is "System prompt and built-in tools".
  const WIDEST = 32

  test('the widths at 24, 45, 64, 88 and 140 columns', () => {
    expect(tableLayout(24, WIDEST)).toEqual({ mark: 0, lead: 3, name: 14, bar: 0, share: false })
    expect(tableLayout(45, WIDEST)).toEqual({ mark: 3, lead: 0, name: 20, bar: 8, share: true })
    for (const columns of [64, 88, 140]) {
      expect(tableLayout(columns, WIDEST)).toEqual({ mark: 3, lead: 0, name: 32, bar: 12, share: true })
      expect(rowCells(tableLayout(columns, WIDEST))).toBe(60)
    }
  })

  test('the bar narrows before the names, and goes before the share', () => {
    expect(tableLayout(49, WIDEST).bar).toBe(12)
    expect(tableLayout(48, WIDEST).bar).toBe(11)
    expect(tableLayout(34, WIDEST)).toMatchObject({ bar: 4, name: 13, share: true })
    expect(tableLayout(33, WIDEST)).toMatchObject({ bar: 0, lead: 3, share: true })
    expect(tableLayout(28, WIDEST)).toMatchObject({ bar: 0, share: false })
  })

  test('level 2 draws no swatch when the bar is dropped: the names get its cells', () => {
    expect(tableLayout(24, WIDEST, false)).toEqual({ mark: 0, lead: 0, name: 17, bar: 0, share: false })
    expect(tableLayout(33, WIDEST, false)).toEqual({ mark: 3, lead: 0, name: 17, bar: 0, share: true })
    // With a bar there is never a swatch.
    expect(tableLayout(88, WIDEST, false)).toEqual(tableLayout(88, WIDEST))
    for (let columns = 20; columns <= 60; columns += 1) {
      expect(rowCells(tableLayout(columns, 200, false))).toBeLessThan(columns)
    }
  })

  test('a row never reaches the pane edge, and stops at the cap in a wide pane', () => {
    for (let columns = 20; columns <= 160; columns += 1) {
      for (const widest of [8, WIDEST, 200]) {
        const cells = rowCells(tableLayout(columns, widest))
        expect(cells).toBeLessThan(columns)
        expect(cells).toBeLessThanOrEqual(TABLE_MAX_COLUMNS)
      }
    }
    expect(rowCells(tableLayout(88, 200))).toBe(TABLE_MAX_COLUMNS)
    expect(rowCells(tableLayout(140, 200))).toBe(TABLE_MAX_COLUMNS)
  })
})

describe('the column added', () => {
  const WIDEST = 32

  test('narrows the length bar, never the names, to make room in a side pane', () => {
    // A terminal of 150 columns gives the side pane about 64: the bar gives
    // up 4 cells there, the names keep theirs.
    for (const [columns, bar] of [
      [64, 8],
      [67, 11],
    ] as const) {
      const plain = tableLayout(columns, WIDEST)
      const table = withAdded(plain, columns)
      expect(table.added).toBe(true)
      expect(table.bar).toBe(bar)
      expect(table.name).toBe(plain.name)
      expect(rowCells(table)).toBe(Math.min(columns - 1, TABLE_MAX_COLUMNS))
    }
    // Where the bar would fall below its narrowest, the column does not show.
    expect(withAdded(tableLayout(45, WIDEST), 45).added).toBeUndefined()
    expect(withAdded(tableLayout(45, WIDEST), 45)).toEqual(tableLayout(45, WIDEST))
  })

  test('joins the table without a cut where it has 7 cells to spare inside the cap and the pane', () => {
    for (const columns of [68, 76, 88, 140]) {
      const table = withAdded(tableLayout(columns, WIDEST), columns)
      expect(table.added).toBe(true)
      // The other columns keep their cells: the column comes on top.
      expect(rowCells(table)).toBe(rowCells(tableLayout(columns, WIDEST)) + ADDED_CELLS)
    }
    // Without a share column there is no room to speak of.
    expect(withAdded({ ...tableLayout(88, WIDEST), share: false }, 88).added).toBeUndefined()
  })

  test('a row with the column never reaches the pane edge or passes the cap', () => {
    for (let columns = 20; columns <= 160; columns += 1) {
      for (const widest of [8, WIDEST, 200]) {
        const cells = rowCells(withAdded(tableLayout(columns, widest), columns))
        expect(cells).toBeLessThan(columns)
        expect(cells).toBeLessThanOrEqual(TABLE_MAX_COLUMNS)
      }
    }
  })

  test('the figure of growth follows the share, or blanks hold its place', () => {
    const table = withAdded(tableLayout(88, WIDEST), 88)
    expect(figuresText(table, 114_400, USED, 14_200)).toBe('  114k   40%   +14k')
    expect(figuresText(table, 2900, USED, 38)).toBe('  2.9k  1.0%    +38')
    expect(figuresText(table, 2900, USED)).toBe(`  2.9k  1.0%${' '.repeat(ADDED_CELLS)}`)
    expect(figuresText(table, 684_124, null)).toBe(`  684k${' '.repeat(6 + ADDED_CELLS)}`)
    // A table without the column ignores the figure.
    expect(figuresText(tableLayout(88, WIDEST), 114_400, USED, 14_200)).toBe('  114k   40%')
    for (const added of [undefined, 5, 4600, 14_200, 1_000_000]) {
      expect(cellWidth(figuresText(table, 114_400, USED, added))).toBe(rowCells(table) - nameAndBarCells(table) - table.mark)
    }
  })

  test('the header names the column over it', () => {
    const table = withAdded(tableLayout(88, WIDEST), 88)
    const header = columnHeader(table, '1M window', '% of used')
    expect(header.endsWith('% of used  added')).toBe(true)
    expect(cellWidth(header)).toBe(rowCells(table) - table.mark)
  })
})

describe('figures and headings', () => {
  const table = tableLayout(88, 32)

  test('shares are of what is used; Free space and Reserve leave the share blank', () => {
    expect(figuresText(table, 114_400, USED)).toBe('  114k   40%')
    expect(figuresText(table, 976, USED)).toBe('   976  0.3%')
    expect(figuresText(table, 2900, USED)).toBe('  2.9k  1.0%')
    expect(figuresText(table, 684_124, null)).toBe('  684k      ')
    expect(figuresText(tableLayout(24, 32), 114_400, USED)).toBe('  114k')
  })

  test('the column header says once what the share is, over the share column', () => {
    const header = columnHeader(table, '1M window', '% of used')
    expect(header.startsWith('1M window ')).toBe(true)
    expect(header.endsWith('% of used')).toBe(true)
    expect(cellWidth(header)).toBe(rowCells(table) - table.mark)
    expect(columnHeader(tableLayout(24, 32), '1M window', '% of used')).toBe('1M window')
  })

  test('the heading says what is used and what is free before compaction', () => {
    expect(paneHeading(REAL, 88)).toEqual({ used: '283k used', free: '684k free before compaction' })
    expect(headingLine(paneHeading(REAL, 88))).toBe('283k used · 684k free before compaction')
    expect(paneHeading(REAL, 30)).toEqual({ used: '283k used', free: '684k free' })
    expect(paneHeading(REAL, 12)).toEqual({ used: '283k used', free: '' })
    expect(headingLine(paneHeading(REAL, 12))).toBe('283k used')
    expect(paneHeading({ ...REAL, isEstimate: true }, 88)).toEqual({ used: '~283k used', free: '~684k free before compaction' })
  })

  // 340k less 283k used and 33k reserve: 24k free, 7% of the window.
  const LOW = { ...REAL, window: 340_000 }

  test('while free space is low, the narrowest heading keeps the free figure, not the used one', () => {
    expect(isLowFree(LOW)).toBe(true)
    expect(isLowFree(REAL)).toBe(false)
    expect(paneHeading(LOW, 88)).toEqual({ used: '283k used', free: '24k free before compaction' })
    expect(paneHeading(LOW, 30)).toEqual({ used: '283k used', free: '24k free' })
    expect(paneHeading(LOW, 12)).toEqual({ used: '', free: '24k free' })
    expect(headingLine(paneHeading(LOW, 12))).toBe('24k free')
    expect(paneHeading({ ...LOW, isEstimate: true }, 12)).toEqual({ used: '', free: '~24k free' })
  })

  test('free space at exactly a tenth of the window is not low; one token less is', () => {
    expect(LOW_FREE_SHARE).toBe(0.1)
    // 400k less 283k used and 77k reserve: 40,000 free, exactly 10%.
    expect(isLowFree({ ...REAL, window: 400_000, reserve: 77_124 })).toBe(false)
    expect(isLowFree({ ...REAL, window: 400_000, reserve: 77_125 })).toBe(true)
    // No free space at all is low; a window of nothing has nothing to warn about.
    expect(isLowFree({ ...REAL, window: 300_000 })).toBe(true)
    expect(isLowFree({ ...REAL, window: 0 })).toBe(false)
  })

  test('while free space is low, the column header names the largest segment and its share of used', () => {
    const toolResults = largestOf([...LOW.baseline, ...LOW.conversation])
    expect(windowText(table, LOW, toolResults, USED)).toBe('340k window · largest: Tool results 40%')
    // Not low: the window alone, however wide the table.
    expect(windowText(table, REAL, toolResults, USED)).toBe('1M window')
    expect(windowText(table, LOW, null, USED)).toBe('340k window')
    // A 1M window with a 650k reserve leaves 67k free, 6.7%. With the full
    // name the text takes 45 cells: all of an 88-column pane's name and bar
    // columns. A 60-column pane has 44, so the short name stands in.
    const lowMillion = { ...REAL, reserve: 650_000 }
    const injections = { id: 'injections', tokens: 65_000 } as const
    const narrower = tableLayout(60, 32)
    expect(nameAndBarCells(table)).toBe(45)
    expect(windowText(table, lowMillion, injections, USED)).toBe('1M window · largest: System notifications 23%')
    expect(nameAndBarCells(narrower)).toBe(44)
    expect(windowText(narrower, lowMillion, injections, USED)).toBe('1M window · largest: Notifications 23%')
    // Too narrow for either: the window alone, never a cut name.
    expect(windowText(tableLayout(24, 32), LOW, toolResults, USED)).toBe('340k window')
    // The share is marked as the heading is.
    expect(windowText(table, { ...LOW, isEstimate: true }, toolResults, USED)).toBe('340k window · largest: Tool results ~40%')
    // It fits the name and bar columns, so the share column keeps its place.
    const header = columnHeader(table, windowText(table, LOW, toolResults, USED), '% of used')
    expect(header).toMatch(/^340k window · largest: Tool results 40% +% of used$/)
    expect(cellWidth(header)).toBe(rowCells(table) - table.mark)
  })

  test('the largest row is the first of the largest, never a zero one', () => {
    expect(largestOf([...REAL.baseline, ...REAL.conversation])?.id).toBe('tool-results')
    expect(largestOf([{ id: 'a', tokens: 5 }, { id: 'b', tokens: 5 }])?.id).toBe('a')
    expect(largestOf([{ id: 'a', tokens: 0 }])).toBeNull()
  })

  test('the level 3 facts line says which lines of the whole item a page shows', () => {
    expect(lineFacts({ firstLine: 1, lastLine: 400, lines: 1230, page: 0, pages: 4 })).toBe('lines 1-400 of 1,230')
    // One page: the whole item shows, nothing to say.
    expect(lineFacts({ firstLine: 1, lastLine: 300, lines: 300, page: 0, pages: 1 })).toBe('')
    // Pages inside one long line: the page number tells them apart.
    expect(lineFacts({ firstLine: 1, lastLine: 1, lines: 1, page: 1, pages: 3 })).toBe('line 1 of 1, page 2 of 3')
  })

  test('the level 2 facts line takes the longest form that fits', () => {
    expect(listFacts('72 items', 'largest first', 0, 4, 88)).toBe('72 items · largest first · page 1 of 4')
    expect(listFacts('72 items', 'largest first', 0, 4, 30)).toBe('72 items · page 1 of 4')
    expect(listFacts('72 items', 'largest first', 0, 4, 24)).toBe('72 items · page 1 of 4')
    expect(listFacts('72 items', 'largest first', 0, 4, 20)).toBe('72 items · 1/4')
    expect(listFacts('72 items', 'largest first', 0, 4, 12)).toBe('72 items')
    expect(listFacts('2 items', 'largest first', 0, 1, 24)).toBe('2 items · largest first')
    expect(listFacts('2 items', null, 0, 1, 88)).toBe('2 items')
    for (const columns of [16, 24, 45]) {
      expect(cellWidth(listFacts('72 items', 'largest first', 3, 4, columns))).toBeLessThan(columns)
    }
  })

  test('the level 2 breadcrumb carries the segment total and its share of what is used', () => {
    expect(crumbFor('Context', 'Tool results', 'Tool results', 114_400, USED, false, 88)).toEqual({
      trail: 'Context › ',
      name: 'Tool results',
      figures: '114k · 40% of used',
    })
    expect(crumbFor('Context', 'System prompt and built-in tools', 'System', 24_300, USED, false, 45)).toEqual({
      trail: 'Context › ',
      name: 'System',
      figures: '24k · 8.6% of used',
    })
    expect(crumbFor('Context', 'Tool results', 'Tool results', 114_400, USED, true, 88).figures).toBe(
      '~114k · ~40% of used',
    )
    expect(crumbFor('Context', 'Tool results', 'Tool results', 114_400, null, false, 88).figures).toBe('114k')
    for (const columns of [16, 24, 45]) {
      const crumb = crumbFor('Context', 'Tool results', 'Tool results', 114_400, USED, false, columns)
      const width = cellWidth(crumb.trail) + 3 + cellWidth(crumb.name) + (crumb.figures === '' ? 0 : 2 + cellWidth(crumb.figures))
      expect(width).toBeLessThan(columns)
    }
  })
})

describe('Not loaded by server', () => {
  const isMcp = (name: string) => name.startsWith('MCP ')
  const server = (name: string, tools: number, tokens: number) => ({ name, tools, tokens })
  const DEFERRED = [
    { name: 'MCP tools (deferred)', tokens: 130_000 },
    { name: 'System tools (deferred)', tokens: 32_000 },
  ]

  test('puts the servers under MCP tools only', () => {
    const servers = [server('tickets', 40, 90_000), server('notes', 12, 40_000)]

    expect(notLoadedRows(DEFERRED, servers, isMcp)).toEqual([
      { name: 'MCP tools (deferred)', tokens: 130_000, servers },
      { name: 'System tools (deferred)', tokens: 32_000, servers: [] },
    ])
    expect(notLoadedRows(DEFERRED, [], isMcp)).toEqual([
      { name: 'MCP tools (deferred)', tokens: 130_000, servers: [] },
      { name: 'System tools (deferred)', tokens: 32_000, servers: [] },
    ])
  })

  test('keeps every server on the MCP tools row: the row counts them all', () => {
    const servers = Array.from({ length: 30 }, (_, i) => server(`server-${i}`, 2, 1000 * (30 - i)))

    expect(notLoadedRows(DEFERRED, servers, isMcp)[0]!.servers).toEqual(servers)
  })

  test('keeps MCP tools with no figure of its own when it has servers', () => {
    const servers = [server('notes', 3, 0)]
    const zero = [{ name: 'MCP tools (deferred)', tokens: 0 }]

    expect(notLoadedRows(zero, servers, isMcp)).toEqual([{ name: 'MCP tools (deferred)', tokens: null, servers }])
    expect(notLoadedRows(zero, [], isMcp)).toEqual([])
    // No such category at all: the servers get a row of that name.
    expect(notLoadedRows([{ name: 'System tools (deferred)', tokens: 32_000 }], servers, isMcp)).toEqual([
      { name: 'System tools (deferred)', tokens: 32_000, servers: [] },
      { name: 'MCP tools', tokens: null, servers },
    ])
  })

  test('without a category figure the MCP tools row shows the servers’ sum, as their list does', () => {
    const servers = [server('tickets', 4, 4000), server('notes', 2, 1000)]

    expect(notLoadedRows([{ name: 'MCP tools (deferred)', tokens: 0 }], servers, isMcp)).toEqual([
      { name: 'MCP tools (deferred)', tokens: 5000, servers },
    ])
    expect(notLoadedRows([{ name: 'System tools (deferred)', tokens: 32_000 }], servers, isMcp)).toEqual([
      { name: 'System tools (deferred)', tokens: 32_000, servers: [] },
      { name: 'MCP tools', tokens: 5000, servers },
    ])
  })

  test('the MCP tools row counts servers and tools, and drops the tools, then the counts, where they do not fit', () => {
    const servers = [server('tickets', 690, 400_000), ...Array.from({ length: 29 }, (_, i) => server(`s${i}`, i === 0 ? 6 : 0, 100))]
    const row = (columns: number) => serversRowText(tableLayout(columns, 32), 'MCP tools', servers).trimEnd()
    expect(row(88)).toBe('MCP tools · 30 servers, 696 tools')
    expect(row(45)).toBe('MCP tools · 30 servers')
    expect(row(24)).toBe('MCP tools')
    expect(serversRowText(tableLayout(88, 32), 'MCP tools', [server('one', 1, 5)]).trimEnd()).toBe('MCP tools · 1 server, 1 tool')
    for (const columns of [24, 45, 88]) {
      const table = tableLayout(columns, 32)
      expect(cellWidth(serversRowText(table, 'MCP tools', servers))).toBe(nameAndBarCells(table) - table.lead)
    }
  })
})

describe('the longer forms of the names', () => {
  test('a group heading says what its group holds where the name and bar columns have room', () => {
    expect(headingText(tableLayout(88, 32), 'Baseline', 'Baseline · before your first prompt').trimEnd()).toBe(
      'Baseline · before your first prompt',
    )
    expect(headingText(tableLayout(45, 32), 'Baseline', 'Baseline · before your first prompt').trimEnd()).toBe('Baseline')
  })

  test('the Not loaded heading says the block is outside the window where a row has room', () => {
    expect(notLoadedHeading(tableLayout(45, 32), 'Not loaded', 'Not loaded · outside the window')).toBe('Not loaded · outside the window')
    expect(notLoadedHeading(tableLayout(24, 32), 'Not loaded', 'Not loaded · outside the window')).toBe('Not loaded')
  })

  test('the facts and the column name share a row, the name at the share column’s end, or need two rows', () => {
    const table = tableLayout(88, 50, false)
    const joined = factsRow(table, '13 items · largest first', '% of segment')!
    expect(joined.startsWith('13 items · largest first  ')).toBe(true)
    expect(joined.endsWith('% of segment')).toBe(true)
    expect(cellWidth(joined)).toBe(rowCells(table))
    expect(factsRow(tableLayout(45, 50, false), '2,048 items · largest first · page 1 of 103', '% of segment')).toBeNull()
    // No share column: nothing to name.
    expect(factsRow(tableLayout(24, 50, false), '13 items', '% of segment')).toBeNull()
  })

  test('the servers’ title line shortens as the breadcrumb does, with no swatch', () => {
    const crumb = (columns: number) => serversCrumb('Context', 'Not loaded', 'MCP tools', 414_000, columns)
    expect(crumb(88)).toEqual({ trail: 'Context › Not loaded › ', name: 'MCP tools', figures: '414k once loaded' })
    expect(crumb(45)).toEqual({ trail: 'Not loaded › ', name: 'MCP tools', figures: '414k once loaded' })
    expect(crumb(30)).toEqual({ trail: '', name: 'MCP tools', figures: '414k once loaded' })
    expect(crumb(16)).toEqual({ trail: '', name: 'MCP tools', figures: '414k' })
    expect(serversCrumb('Context', 'Not loaded', 'MCP tools', null, 88).figures).toBe('')
  })

  test('a server row keeps its name left and its tool count in one column at the name column’s end', () => {
    const rows = [
      { title: 'tickets', detail: '130 tools' },
      { title: 'a-server-name-far-too-long-for-any-pane-to-show-whole', detail: '2 tools' },
      { title: '漢字のサーバー名がとても長いです', detail: '1 tool' },
    ]
    for (const columns of [24, 45, 68, 100]) {
      const table = tableLayout(columns, 40, false)
      const names = serverNames(table, rows)
      for (const name of names) {
        expect(cellWidth(name.title + name.detail)).toBe(table.name)
      }
      expect(names[1]!.title).toMatch(/…/)
    }
    // Room enough: the count names its unit, singular for one.
    const wide = serverNames(tableLayout(100, 40, false), rows)
    expect(wide[0]!.detail).toBe('  130 tools')
    expect(wide[2]!.detail).toBe('     1 tool')
    // Short names whole beside the counts: the column fits them, the word stays.
    const short = serverNames(tableLayout(68, 16, false), [
      { title: 'tickets', detail: '4 tools' },
      { title: 'notes', detail: '2 tools' },
    ])
    expect(short).toEqual([
      { title: 'tickets', detail: '  4 tools' },
      { title: 'notes  ', detail: '  2 tools' },
    ])
    // A narrow pane keeps the name and shows the number alone, on every row.
    const narrow = serverNames(tableLayout(24, 40, false), rows)
    expect(narrow[0]!.detail).toBe('  130')
    expect(narrow[1]!.detail).toBe('    2')
  })

  test('a server row too narrow for its name and its count shows the name alone, cut to the column', () => {
    const rows = [
      { title: 'tickets', detail: '130 tools' },
      { title: 'notes', detail: '2 tools' },
    ]
    // Name columns of 1 to 6 cells: the count and its gap would leave the
    // name fewer than two cells. From 7 cells the count shows.
    for (const columns of [8, 9, 10, 11, 12, 13]) {
      const table = tableLayout(columns, 40, false)
      expect({ columns, names: serverNames(table, rows) }).toEqual({
        columns,
        names: rows.map(row => ({ title: fit(row.title, table.name), detail: '' })),
      })
    }
    expect(tableLayout(13, 40, false).name).toBe(6)
    expect(serverNames(tableLayout(14, 40, false), rows)).toEqual([
      { title: 't…', detail: '  130' },
      { title: 'n…', detail: '    2' },
    ])
  })
})
