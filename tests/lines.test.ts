import { describe, expect, test } from 'claude-code/testing'

import type { ContextBreakdownContent, ContextBreakdownView } from '../types'
import {
  blockStarts,
  endTop,
  lineMove,
  markdownUnits,
  rawUnits,
  shownFacts,
  shownFirstLine,
  shownMarkdown,
  shownRuns,
  topAtLine,
  topOf,
  unitFirstLines,
  unitsOf,
} from '../hooks/lines'
import { keepTop } from '../hooks/navigate'
import { CODE_LINE_CHARS } from '../hooks/text'

/** A stored level-3 item, as navigate.ts writes it. */
function itemOf(over: Partial<ContextBreakdownContent>): ContextBreakdownContent {
  return {
    id: 'r:big',
    title: 'Bash',
    tokens: 100,
    path: null,
    source: 'loaded',
    canToggle: false,
    isChanged: false,
    note: null,
    format: 'raw',
    page: 0,
    pages: 1,
    firstLine: 1,
    lastLine: 1,
    lines: 1,
    startLine: 1,
    text: '',
    language: null,
    notice: null,
    atEnd: false,
    ...over,
  }
}

/** Lines "row 1" to "row n". */
const rows = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `row ${from + i}`).join('\n')

/** A paragraph of lines "name 1" to "name n", without blank lines. */
const names = (n: number) => Array.from({ length: n }, (_, i) => `name ${i + 1}`).join('\n')

const LONG_LINE = 'x'.repeat(CODE_LINE_CHARS * 2 + 10)

describe('raw units', () => {
  test('a line is one unit; a line too long for one Code element is one unit per piece', () => {
    expect(rawUnits('a\nb\nc').map(unit => unit.line)).toEqual([0, 1, 2])
    expect(rawUnits(`a\n${LONG_LINE}\nc`).map(unit => unit.line)).toEqual([0, 1, 1, 1, 2])
    expect(rawUnits(`a\n${LONG_LINE}\nc`).map(unit => unit.text.length)).toEqual([1, 1000, 1000, 10, 1])
  })

  test('empty text is one unit, so nothing can step', () => {
    const item = itemOf({ text: '' })
    expect(unitsOf(item)).toBe(1)
    expect(lineMove(item, 1)).toBeNull()
    expect(lineMove(item, -1)).toBeNull()
    expect(unitsOf(itemOf({ text: '', format: 'formatted' }))).toBe(1)
  })
})

describe('lineMove', () => {
  test('j steps until the last line is the first shown, then does nothing on the last page', () => {
    const item = itemOf({ text: rows(3) })
    expect(lineMove(item, 1)).toEqual({ top: 1 })
    expect(lineMove({ ...item, top: 1 }, 1)).toEqual({ top: 2 })
    expect(lineMove({ ...item, top: 2 }, 1)).toBeNull()
  })

  test('k steps back to the first line, then does nothing on the first page', () => {
    const item = itemOf({ text: rows(3), top: 2 })
    expect(lineMove(item, -1)).toEqual({ top: 1 })
    expect(lineMove({ ...item, top: 1 }, -1)).toEqual({ top: 0 })
    expect(lineMove({ ...item, top: 0 }, -1)).toBeNull()
  })

  test('at a page edge j opens the next page and k the previous one', () => {
    const middle = itemOf({ text: rows(3), page: 1, pages: 3 })
    expect(lineMove({ ...middle, top: 2 }, 1)).toEqual({ page: 1 })
    expect(lineMove(middle, -1)).toEqual({ page: -1 })
    expect(lineMove({ ...middle, page: 2, top: 2 }, 1)).toBeNull()
    expect(lineMove({ ...middle, page: 0 }, -1)).toBeNull()
  })

  test('a long line counts its pieces: j stops in it piece by piece', () => {
    const item = itemOf({ text: `a\n${LONG_LINE}` })
    expect(unitsOf(item)).toBe(4)
    expect(lineMove({ ...item, top: 2 }, 1)).toEqual({ top: 3 })
    expect(lineMove({ ...item, top: 3 }, 1)).toBeNull()
  })

  test('a stored top past the page, or not a number, is held to the page', () => {
    expect(topOf(itemOf({ text: rows(3), top: 99 }))).toBe(2)
    expect(topOf(itemOf({ text: rows(3), top: -4 }))).toBe(0)
    expect(topOf(itemOf({ text: rows(3), top: Number.NaN }))).toBe(0)
    // A value stored before the field existed has no top: the page's top.
    expect(topOf(itemOf({ text: rows(3) }))).toBe(0)
  })
})

describe('endTop', () => {
  test('the raw view shows the last `rows` lines; never below 0', () => {
    const item = itemOf({ text: rows(500) })
    expect(endTop(item, 58)).toBe(442)
    expect(endTop(item, 600)).toBe(0)
    expect(endTop(item, Number.POSITIVE_INFINITY)).toBe(0)
    // No room at all: the last line alone.
    expect(endTop(item, 0)).toBe(499)
  })

  test('the formatted view lands on the last line unit that starts a window before the end', () => {
    const text = ['# A', '', 'one', 'two', '', 'three', '', 'four', 'five', 'six'].join('\n')
    const item = itemOf({ text, format: 'formatted' })
    // Units start at lines 0, 2, 3, 5, 7, 8 and 9 of 10.
    expect(endTop(item, 3)).toBe(4)
    expect(endTop(item, 4)).toBe(3)
    expect(endTop(item, 5)).toBe(3)
    expect(endTop(item, 6)).toBe(2)
    expect(endTop(item, 100)).toBe(0)
    expect(endTop(item, 0)).toBe(6)
  })

  test('a paragraph of 430 lines is entered from its end with about `rows` lines showing', () => {
    const item = itemOf({ text: names(430), format: 'formatted' })
    expect(endTop(item, 58)).toBe(372)
    expect(shownMarkdown(item.text, endTop(item, 58)).split('\n').length).toBe(58)
  })
})

describe('markdown units', () => {
  test('each line of a paragraph is a unit: j moves a 430-line paragraph one line per press', () => {
    const text = names(430)
    expect(blockStarts(text)).toEqual(Array.from({ length: 430 }, (_, i) => i))
    const item = itemOf({ text, format: 'formatted' })
    expect(unitsOf(item)).toBe(430)
    expect(lineMove(item, 1)).toEqual({ top: 1 })
    expect(lineMove({ ...item, top: 3 }, 1)).toEqual({ top: 4 })
    expect(shownMarkdown(text, 3).split('\n')[0]).toBe('name 4')
    expect(lineMove({ ...item, top: 429 }, 1)).toBeNull()
  })

  test('each line of a list and of a block quote is a unit; the rest draws as it is', () => {
    const list = ['- one', '- two', '  more', '- three'].join('\n')
    expect(blockStarts(list)).toEqual([0, 1, 2, 3])
    expect(shownMarkdown(list, 1)).toBe('- two\n  more\n- three')
    expect(shownMarkdown(list, 2)).toBe('  more\n- three')
    const quote = ['> a', '> b', '', '> c'].join('\n')
    expect(blockStarts(quote)).toEqual([0, 1, 3])
    expect(shownMarkdown(quote, 1)).toBe('> b\n\n> c')
  })

  test('a blank line is never the first line shown; text of blank lines only is one unit', () => {
    expect(blockStarts('a\nb\n\nc\n\n\nd')).toEqual([0, 1, 3, 6])
    expect(shownMarkdown('a\nb\n\nc\n\n\nd', 2)).toBe('c\n\n\nd')
    // Leading blank lines: the first unit starts at the first line with text.
    expect(blockStarts('\n\na\n\nb')).toEqual([2, 4])
    expect(shownMarkdown('\n\na\n\nb', 1)).toBe('b')
    // A fence after leading blank lines: its first line inside is no unit of its own.
    expect(blockStarts('\n\n```\nx\ny\n```')).toEqual([2, 4])
    expect(blockStarts('')).toEqual([0])
    expect(markdownUnits('\n\n\n')).toEqual([{ start: 0, head: [] }])
    const blank = itemOf({ text: '\n\n\n', format: 'formatted' })
    expect(unitsOf(blank)).toBe(1)
    expect(lineMove(blank, 1)).toBeNull()
  })

  test('a unit inside a table draws the header row and the separator row in front; the separator row is no unit', () => {
    const text = ['intro', '', '| a | b |', '| - | - |', '| 1 | 2 |', '| 3 | 4 |', '', 'end'].join('\n')
    expect(blockStarts(text)).toEqual([0, 2, 4, 5, 7])
    expect(markdownUnits(text)[3]).toEqual({ start: 5, head: ['| a | b |', '| - | - |'] })
    expect(shownMarkdown(text, 1)).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\nend')
    expect(shownMarkdown(text, 2)).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\nend')
    expect(shownMarkdown(text, 3)).toBe('| a | b |\n| - | - |\n| 3 | 4 |\n\nend')
    expect(shownMarkdown(text, 4)).toBe('end')
    // Without outer pipes, and with colons, it is still a table.
    expect(shownMarkdown('a | b\n:-- | --:\n1 | 2\n3 | 4', 2)).toBe('a | b\n:-- | --:\n3 | 4')
    // A line of dashes without a pipe under a line with one is a heading, not a table.
    expect(blockStarts('a | b\n---\nc')).toEqual([0, 1, 2])
  })

  test('each line inside a fence is a unit, blank lines too; the closing line is none', () => {
    const text = ['intro', '', '```js', 'a', '', 'b', '```', '', '~~~~', 'c', '', '~~~', 'd', '~~~~', '', 'end'].join('\n')
    // The first line inside (3, 9) shows what its opening line (2, 8) shows.
    expect(blockStarts(text)).toEqual([0, 2, 4, 5, 8, 10, 11, 12, 15])
    // An unclosed fence runs to the end.
    expect(blockStarts('x\n\n```\na\n\nb')).toEqual([0, 2, 4, 5])
    // A fence opened under a paragraph line: the opening line is a unit, the first line inside none.
    expect(blockStarts('para\n```\na\nb\n```')).toEqual([0, 1, 3])
    // A backtick "fence" whose info holds a backtick is a code span, not a fence.
    expect(blockStarts('```a`\nx\n\ny')).toEqual([0, 1, 3])
  })

  test('markdownUnits puts the opening line of the fence a unit starts inside in front', () => {
    const text = ['~~~ py title', 'a', '', '  b', '~~~', 'after'].join('\n')
    expect(markdownUnits(text)).toEqual([
      { start: 0, head: [] },
      { start: 2, head: ['~~~ py title'] },
      { start: 3, head: ['~~~ py title'] },
      { start: 5, head: [] },
    ])
  })

  test('shownMarkdown drops the lines before the unit, and lines inside a fence under its opening line', () => {
    const text = ['# T', '', '```', 'a', '', 'b', '```', '', 'end'].join('\n')
    expect(shownMarkdown(text, 0)).toBe(text)
    expect(shownMarkdown(text, 1)).toBe('```\na\n\nb\n```\n\nend')
    expect(shownMarkdown(text, 2)).toBe('```\n\nb\n```\n\nend')
    expect(shownMarkdown(text, 3)).toBe('```\nb\n```\n\nend')
    expect(shownMarkdown(text, 4)).toBe('end')
    expect(shownMarkdown(text, 9)).toBe('end')
  })

  test('a ~~~ fence keeps its marker and info string; an unclosed fence stays unclosed', () => {
    expect(shownMarkdown('~~~~ sh\none\ntwo\n~~~~\n\nx', 1)).toBe('~~~~ sh\ntwo\n~~~~\n\nx')
    expect(shownMarkdown('```js\na\nb\nc', 2)).toBe('```js\nc')
  })

  test('a fence as the whole page steps line by line to its last line, then crosses', () => {
    const text = ['```', ...Array.from({ length: 5 }, (_, i) => `row ${i + 1}`), '```'].join('\n')
    const page = itemOf({ text, format: 'formatted', page: 0, pages: 2 })
    // The opening line with row 1, then rows 2 to 5.
    expect(unitsOf(page)).toBe(5)
    expect(lineMove({ ...page, top: 3 }, 1)).toEqual({ top: 4 })
    expect(shownMarkdown(text, 4)).toBe('```\nrow 5\n```')
    expect(lineMove({ ...page, top: 4 }, 1)).toEqual({ page: 1 })
    expect(lineMove({ ...page, top: 1 }, -1)).toEqual({ top: 0 })
    // k into this page from the next lands a window of lines before its end.
    expect(endTop(page, 3)).toBe(3)
  })

  test('text after a fence steps line by line again', () => {
    const text = ['```', 'a', 'b', '```', '', 'one', 'two', '', 'three'].join('\n')
    expect(blockStarts(text)).toEqual([0, 2, 5, 6, 8])
    expect(shownMarkdown(text, 3)).toBe('two\n\nthree')
  })
})

describe('topAtLine', () => {
  test('the raw view finds the line exactly; a long line at its first piece', () => {
    const page = itemOf({ text: rows(500), firstLine: 501, lastLine: 1000, lines: 1200 })
    expect(topAtLine(page, 801)).toBe(300)
    expect(topAtLine(page, 400)).toBe(0)
    expect(topAtLine(page, 5000)).toBe(499)
    const split = itemOf({ text: `a\n${LONG_LINE}\nb`, firstLine: 1, lastLine: 3, lines: 3 })
    expect(topAtLine(split, 2)).toBe(1)
    expect(topAtLine(split, 3)).toBe(4)
  })

  test('the formatted view takes the nearest unit at or before the line', () => {
    const text = ['# A', '', 'one', '', 'two', '', 'three'].join('\n')
    const item = itemOf({ text, format: 'formatted', firstLine: 11, lastLine: 17, lines: 40 })
    expect(unitFirstLines(item)).toEqual([11, 13, 15, 17])
    expect(topAtLine(item, 14)).toBe(1)
    expect(topAtLine(item, 15)).toBe(2)
    expect(shownFirstLine({ ...item, top: topAtLine(item, 16) })).toBe(15)
  })

  test('with line units, raw line N and formatted line N map to each other', () => {
    const text = ['# A', '', 'one', 'two', '', 'three'].join('\n')
    const item = itemOf({ text, format: 'formatted', firstLine: 11, lastLine: 16, lines: 40 })
    expect(unitFirstLines(item)).toEqual([11, 13, 14, 16])
    expect(topAtLine(item, 14)).toBe(2)
    expect(topAtLine(item, 15)).toBe(2)
    const paragraph = itemOf({ text: names(430), format: 'formatted', firstLine: 1, lastLine: 430, lines: 430 })
    for (const line of [1, 2, 200, 429, 430]) {
      expect(shownFirstLine({ ...paragraph, top: topAtLine(paragraph, line) })).toBe(line)
    }
  })
})

describe('shownRuns', () => {
  test('from a line on, the gutter starts at that line', () => {
    expect(shownRuns(rows(5), 101, 2)).toEqual({ runs: [{ source: 'row 3\nrow 4\nrow 5', startLine: 103 }], isSplit: false })
    expect(shownRuns(rows(5), null, 2)).toEqual({ runs: [{ source: 'row 3\nrow 4\nrow 5', startLine: null }], isSplit: false })
    expect(shownRuns(rows(2), 1, 0)).toEqual({ runs: [{ source: rows(2), startLine: 1 }], isSplit: false })
  })

  test('a long line drawn in pieces repeats its number, also when j stops inside it', () => {
    const text = `a\n${LONG_LINE}\nb`
    const at = (top: number) => shownRuns(text, 10, top).runs.map(run => [run.startLine, run.source.length])
    expect(at(0)).toEqual([
      [10, 1],
      [11, 1000],
      [11, 1000],
      [11, 10],
      [12, 1],
    ])
    expect(at(2)).toEqual([
      [11, 1000],
      [11, 10],
      [12, 1],
    ])
    expect(shownRuns(text, 10, 2).isSplit).toBe(true)
    // Without a gutter the pieces are lines of one run.
    expect(shownRuns(text, null, 3).runs).toEqual([{ source: `${'x'.repeat(10)}\nb`, startLine: null }])
  })
})

describe('the facts line', () => {
  const page = itemOf({ text: rows(500), page: 0, pages: 3, firstLine: 1, lastLine: 500, lines: 1200 })

  test('says the first line shown once j moved the text', () => {
    expect(shownFacts(page)).toBe('lines 1-500 of 1,200')
    expect(shownFacts({ ...page, top: 10 })).toBe('lines 11-500 of 1,200')
    expect(shownFacts({ ...page, top: 499 })).toBe('line 500 of 1,200, page 1 of 3')
  })

  test('an item of one page says nothing at its top, and the first line shown below it', () => {
    const one = itemOf({ text: rows(40), firstLine: 1, lastLine: 40, lines: 40 })
    expect(shownFacts(one)).toBe('')
    expect(shownFacts({ ...one, top: 5 })).toBe('lines 6-40 of 40')
    expect(shownFacts({ ...one, top: 39 })).toBe('line 40 of 40')
  })

  test('the formatted view maps its block onto the page’s lines', () => {
    const text = ['# A', '', 'one', '', 'two', '', 'three'].join('\n')
    const item = itemOf({ text, format: 'formatted', firstLine: 11, lastLine: 17, lines: 40 })
    expect(shownFirstLine({ ...item, top: 2 })).toBe(15)
    expect(shownFirstLine({ ...item, top: 3 })).toBe(17)
  })

  test('a paragraph of one page says the line shown first, one line on per j', () => {
    const item = itemOf({ text: names(430), format: 'formatted', firstLine: 1, lastLine: 430, lines: 430 })
    expect(shownFacts(item)).toBe('')
    expect(shownFacts({ ...item, top: 3 })).toBe('lines 4-430 of 430')
    expect(shownFacts({ ...item, top: 429 })).toBe('line 430 of 430')
  })
})

describe('keepTop', () => {
  const view = (item: ContextBreakdownContent): ContextBreakdownView => ({
    seq: 1,
    gen: 0,
    level: 3,
    list: {
      segment: 'tool-results',
      sort: 'size',
      canSort: true,
      page: 0,
      pages: 1,
      rows: [],
      items: 1,
      tokens: 1,
      hiddenItems: 0,
      hiddenTokens: 0,
      note: null,
    },
    item,
  })

  test('a refresh that shows the same text keeps the place; new text starts at the top', () => {
    const before = view(itemOf({ text: rows(9), top: 4 }))
    const same = keepTop(before, view(itemOf({ text: rows(9) })))
    expect(same.level === 3 ? same.item.top : null).toBe(4)
    const changed = keepTop(before, view(itemOf({ text: rows(9, 2) })))
    expect(changed.level === 3 ? changed.item.top : null).toBeUndefined()
    const otherPage = keepTop(before, view(itemOf({ text: rows(9), page: 1, pages: 2 })))
    expect(otherPage.level === 3 ? otherPage.item.top : null).toBeUndefined()
  })
})
