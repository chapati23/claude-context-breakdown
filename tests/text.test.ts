import { describe, expect, test } from 'claude-code/testing'

import {
  PAGE_CHARS,
  PAGE_LINES,
  cellWidth,
  displayText,
  firstWords,
  hashText,
  headCells,
  pageStarts,
  shortenPath,
  textPage,
} from '../hooks/text'
import { fit, itemRowText } from '../hooks/view'

describe('displayText', () => {
  test('drops terminal escapes, folds carriage returns, marks other controls', () => {
    expect(displayText('\x1b[31mred\x1b[0m\r\nnext\tline\x07')).toBe('red\nnext\tline?')
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
    expect(textPage('a\nb', 0)).toEqual({ page: 0, pages: 1, text: 'a\nb', startLine: 1 })
    expect(textPage('', 0)).toEqual({ page: 0, pages: 1, text: '', startLine: 1 })
  })

  test('pages by lines, and each page knows its first line', () => {
    const lines = Array.from({ length: PAGE_LINES * 2 + 5 }, (_, i) => `line ${i + 1}`)
    const text = lines.join('\n')
    expect(pageStarts(text)).toHaveLength(3)
    const second = textPage(text, 1)
    expect(second.pages).toBe(3)
    expect(second.startLine).toBe(PAGE_LINES + 1)
    expect(second.text.split('\n')[0]).toBe(`line ${PAGE_LINES + 1}`)
    // A page past the end is the last one.
    expect(textPage(text, 9).page).toBe(2)
  })

  test('cuts a line longer than a page into pieces', () => {
    const text = 'x'.repeat(PAGE_CHARS * 2 + 10)
    const pages = pageStarts(text)
    expect(pages).toEqual([0, PAGE_CHARS, PAGE_CHARS * 2])
    expect(textPage(text, 1).text.length).toBe(PAGE_CHARS)
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
    const row = itemRowText('Read', path, 1200, null, 40, 'detail')
    expect(row.title).toBe('Read')
    expect(row.detail.trimEnd().endsWith('module1.ts')).toBe(true)
    const plain = itemRowText('Read', path, 1200, null, 40)
    expect(plain.detail.includes('module1.ts')).toBe(false)
    expect(cellWidth(row.title + row.detail)).toBe(cellWidth(plain.title + plain.detail))
    const title = itemRowText(path, '', 1200, null, 40, 'title')
    expect(title.title.trimEnd().endsWith('module1.ts')).toBe(true)
  })
})
