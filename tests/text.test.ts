import { describe, expect, test } from 'claude-code/testing'

import {
  CODE_LINE_CHARS,
  PAGE_CHARS,
  PAGE_LINES,
  cellWidth,
  codeRuns,
  displayText,
  firstWords,
  hashText,
  headCells,
  NAME_MAX_CHARS,
  pageStarts,
  plainName,
  shortenPath,
  textPage,
} from '../hooks/text'
import { itemNames, tableLayout } from '../hooks/table'
import { fit } from '../hooks/view'

describe('displayText', () => {
  test('drops terminal escapes, folds carriage returns, marks other controls', () => {
    expect(displayText('\x1b[31mred\x1b[0m\r\nnext\tline\x07')).toBe('red\nnext\tline?')
  })
})

describe('plainName', () => {
  test('drops escapes and control characters, keeps one line, and caps the length', () => {
    expect(plainName('\x1b[31mred\x1b[0m\tteam\nnotes\x07')).toBe('red team notes')
    expect(plainName('  docs  ')).toBe('docs')
    expect(plainName('\x00\x1b[0m')).toBe('?')
    expect(plainName('a'.repeat(500))).toHaveLength(NAME_MAX_CHARS)
  })

  test('drops invisible format characters and 8-bit CSI parameters, so a name measures as it draws', () => {
    expect(plainName('zero​width')).toBe('zerowidth')
    expect(plainName('a‮b⁦c‏d﻿e')).toBe('abcde')
    expect(plainName('\x9b31mX')).toBe('X')
    // A joined emoji sequence becomes its separate emoji, each two cells.
    const family = plainName('\u{1f468}‍\u{1f469}‍\u{1f467}')
    expect(family).toBe('\u{1f468}\u{1f469}\u{1f467}')
    expect(cellWidth(family)).toBe(6)
    expect(plainName('❤️')).toBe('❤')
    expect(plainName('​‮')).toBe('?')
  })
})

describe('firstWords', () => {
  test('collapses white space and tags, and cuts with an ellipsis', () => {
    expect(firstWords('<system-reminder>\n  Some   words\n</system-reminder>')).toBe('Some words')
    expect(firstWords('one two three four', 10)).toBe('one two t…')
    expect(firstWords('short', 10)).toBe('short')
  })
})

describe('hashText', () => {
  test('is stable and tells texts apart', () => {
    expect(hashText('abc')).toBe(hashText('abc'))
    expect(hashText('abc')).not.toBe(hashText('abd'))
  })
})

describe('shortenPath', () => {
  test('writes the home folder as ~', () => {
    expect(shortenPath('/home/user/project/CLAUDE.md')).toBe('~/project/CLAUDE.md')
    expect(shortenPath('/Users/someone/notes.md')).toBe('~/notes.md')
    expect(shortenPath('/srv/app/README.md')).toBe('/srv/app/README.md')
  })

  test('keeps the last parts of a long path', () => {
    const short = shortenPath('/srv/one/two/three/four/five/six/seven/file.md', 24)
    expect(short.length).toBeLessThanOrEqual(24)
    expect(short.startsWith('…/')).toBe(true)
    expect(short.endsWith('/file.md')).toBe(true)
  })
})

describe('pages', () => {
  test('one page for a short text, with line 1 first', () => {
    expect(textPage('a\nb', 0)).toEqual({ page: 0, pages: 1, text: 'a\nb', startLine: 1, endLine: 2 })
    expect(textPage('', 0)).toEqual({ page: 0, pages: 1, text: '', startLine: 1, endLine: 1 })
    // A last newline ends the last line; it starts no line of its own.
    expect(textPage('a\nb\n', 0).endLine).toBe(2)
  })

  test('a typical 300-line instruction file is one page', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `- Rule ${i + 1}: write plain, short sentences in the active voice, one per line.`)
    const text = lines.join('\n')
    expect(text.length).toBeGreaterThan(20_000)
    expect(textPage(text, 0)).toMatchObject({ pages: 1, startLine: 1, endLine: 300 })
  })

  test('pages by lines, and each page knows its first line', () => {
    const lines = Array.from({ length: PAGE_LINES * 2 + 5 }, (_, i) => `line ${i + 1}`)
    const text = lines.join('\n')
    expect(pageStarts(text)).toHaveLength(3)
    const second = textPage(text, 1)
    expect(second.pages).toBe(3)
    expect(second.startLine).toBe(PAGE_LINES + 1)
    expect(second.endLine).toBe(PAGE_LINES * 2)
    expect(second.text.split('\n')[0]).toBe(`line ${PAGE_LINES + 1}`)
    // A page past the end is the last one.
    expect(textPage(text, 9).page).toBe(2)
  })

  test('cuts a line longer than a page into pieces', () => {
    const text = 'x'.repeat(PAGE_CHARS * 2 + 10)
    const pages = pageStarts(text)
    expect(pages).toEqual([0, PAGE_CHARS, PAGE_CHARS * 2])
    expect(textPage(text, 1).text.length).toBe(PAGE_CHARS)
    // Every piece is in line 1.
    expect(textPage(text, 1)).toMatchObject({ startLine: 1, endLine: 1 })
  })

  test('never splits a surrogate pair', () => {
    const text = `${'x'.repeat(PAGE_CHARS - 1)}😀tail`
    const [, second] = pageStarts(text)
    expect(second).toBe(PAGE_CHARS - 1)
  })
})

describe('cells and cuts', () => {
  test('wide characters take two cells; cuts never split a character', () => {
    expect(cellWidth('abc')).toBe(3)
    expect(cellWidth('日本語')).toBe(6)
    // Format characters take no cell.
    expect(cellWidth('a​b‮c')).toBe(3)
    expect(headCells('日本語', 3)).toBe('日')
    expect(firstWords(`${'x'.repeat(8)}😀tail`, 10)).toBe(`${'x'.repeat(8)}…`)
    // The cut lands inside a pair: the lone second half is dropped.
    const short = shortenPath(`/srv/${'😀'.repeat(30)}`, 6)
    expect(short).toBe(`…${'😀'.repeat(2)}`)
  })

  test('fit counts cells, so a row of wide text keeps its width', () => {
    const cut = fit('日本語のテキスト', 9)
    expect(cellWidth(cut)).toBe(9)
    expect(cut.startsWith('日本語の…')).toBe(true)
    expect(fit('ab', 4)).toBe('ab  ')
  })

  test('a row whose detail is a path keeps the file name when it is cut', () => {
    const path = '~/work/structure/module-one/handlers/module1.ts'
    const table = tableLayout(40, 999)
    const row = itemNames(table, 'Read', path, 'detail')
    expect(row.title).toBe('Read')
    expect(row.detail.trimEnd().endsWith('module1.ts')).toBe(true)
    const plain = itemNames(table, 'Read', path)
    expect(plain.detail.includes('module1.ts')).toBe(false)
    expect(cellWidth(row.title + row.detail)).toBe(cellWidth(plain.title + plain.detail))
    const title = itemNames(table, path, '', 'title')
    expect(title.title.trimEnd().endsWith('module1.ts')).toBe(true)
  })
})

describe('codeRuns', () => {
  test('a text with no long line is one run, as it came', () => {
    expect(codeRuns('a\nb', 7)).toEqual({ runs: [{ source: 'a\nb', startLine: 7 }], isSplit: false })
    expect(codeRuns('x'.repeat(CODE_LINE_CHARS), null).isSplit).toBe(false)
  })

  test('with a gutter, each piece of a long line repeats its number and the next lines keep theirs', () => {
    const long = 'x'.repeat(2500)
    const { runs, isSplit } = codeRuns(`a\n${long}\nb\nc`, 10, 1000)
    expect(isSplit).toBe(true)
    expect(runs.map(run => [run.source.length, run.startLine])).toEqual([
      [1, 10],
      [1000, 11],
      [1000, 11],
      [500, 11],
      [3, 12],
    ])
    // Every character is still there, in order.
    expect(runs.map(run => run.source).join('\n')).toBe(`a\n${'x'.repeat(1000)}\n${'x'.repeat(1000)}\n${'x'.repeat(500)}\nb\nc`)
  })

  test('without a gutter the pieces are lines of one run', () => {
    const { runs } = codeRuns(`     1\t${'y'.repeat(1500)}\n     2\tz`, null, 1000)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.source.split('\n').map(line => line.length)).toEqual([1000, 507, 8])
    expect(runs[0]!.startLine).toBeNull()
  })

  test('never splits a surrogate pair', () => {
    const { runs } = codeRuns(`a${'😀'.repeat(10)}`, 1, 4)
    for (const run of runs) {
      expect(run.source).not.toMatch(/^[\udc00-\udfff]|[\ud800-\udbff]$/)
    }
    expect(runs.map(run => run.source).join('')).toBe(`a${'😀'.repeat(10)}`)
  })
})
