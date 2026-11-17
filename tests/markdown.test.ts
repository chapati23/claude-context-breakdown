import { describe, expect, test } from 'claude-code/testing'

import type { MessageLike } from '../hooks/classify'
import { buildItems } from '../hooks/items'
import type { ItemData } from '../hooks/items'
import {
  defaultFormat,
  escapeMarkdown,
  fenced,
  formattedSource,
  languageOf,
  mappedLine,
  markdownPages,
  pageAtLine,
  stripLineNumbers,
} from '../hooks/markdown'
import { contentOf } from '../hooks/navigate'
import { PAGE_CHARS, PAGE_LINES, TREE_CHARS, displayText } from '../hooks/text'
import { CHAT, SUMMARY, richBreakdown } from './fixtures'

const DATA: ItemData = { breakdown: richBreakdown(), messages: CHAT as unknown as MessageLike[], charsPerToken: 4 }

/** The default view of each item of a segment, by title. */
const defaults = (segment: Parameters<typeof buildItems>[0], data = DATA) =>
  buildItems(segment, data).items.map(item => [item.title, defaultFormat(item)])

/** Lines that open or close a fence. */
const fenceLines = (text: string) => text.split('\n').filter(line => /^\s*(`{3,}|~{3,})/.test(line))

describe('the view an item opens in', () => {
  test('formatted: memory files in Markdown, skill bodies, prompts, Claude output, the summary', () => {
    expect(defaults('project-instructions')).toEqual([['~/project/CLAUDE.md', 'formatted']])
    expect(defaults('global-instructions')).toEqual([['~/.claude/CLAUDE.md', 'formatted']])
    expect(defaults('skill-bodies')).toEqual([['demo-skill', 'formatted']])
    expect(defaults('prompts').every(([, format]) => format === 'formatted')).toBe(true)
    expect(defaults('claude-output').every(([, format]) => format === 'formatted')).toBe(true)
    const summary = { ...DATA, messages: SUMMARY as unknown as MessageLike[] }
    expect(defaults('compaction-summary', summary)).toEqual([['Compaction summary', 'formatted']])
  })

  test('raw: tool results (a Read of a .md file too), task reports, injected text', () => {
    expect(defaults('tool-results')).toEqual([
      ['Read', 'raw'],
      ['Bash', 'raw'],
    ])
    expect(defaults('task-reports')).toEqual([['Build finished', 'raw']])
    expect(defaults('injections').every(([, format]) => format === 'raw')).toBe(true)
    const md = { markup: 'file', path: '/srv/notes.md', isNumbered: true } as const
    expect(defaultFormat(md)).toBe('raw')
    // A memory file that is not Markdown opens raw.
    expect(defaultFormat({ ...md, path: '/srv/rules.txt', isNumbered: false })).toBe('raw')
    expect(defaultFormat({ ...md, isNumbered: false })).toBe('formatted')
  })

  test('contentOf opens the default view, and keeps a view it is given', () => {
    const [project] = buildItems('project-instructions', DATA).items
    const resolved = { loaded: '# Project\n\nUse tabs.', disk: null, isDiskRead: false }
    expect(contentOf(project!, resolved, 'loaded', 0, false)).toMatchObject({ format: 'formatted', startLine: null })
    expect(contentOf(project!, resolved, 'loaded', 0, false, 'raw')).toMatchObject({ format: 'raw', startLine: 1 })
  })
})

describe('the Markdown of the formatted view', () => {
  test('a Read result loses its line numbers, for that view only', () => {
    const read = '     1\t# Notes\n     2\t\n     3\tSome text.\n\n<system-reminder>Mind it.</system-reminder>'
    expect(stripLineNumbers(read)).toBe('# Notes\n\nSome text.\n\n<system-reminder>Mind it.</system-reminder>')
    expect(stripLineNumbers('1→one\n2→two')).toBe('one\ntwo')
    // Numbers that do not run on are not a Read result's: kept.
    expect(stripLineNumbers('     1\ta\n     5\tb')).toBe('     1\ta\n     5\tb')
    const item = { markup: 'file', path: '/srv/notes.md', isNumbered: true } as const
    expect(formattedSource(item, 'loaded', read)).toBe('# Notes\n\nSome text.\n\n\\<system-reminder>Mind it.\\</system-reminder>')
    // The file on disk has no numbers to strip.
    expect(formattedSource(item, 'disk', '     1\t# Notes\n')).toBe('     1\t# Notes')
  })

  test('a file that is not Markdown is fenced in its language; terminal output as plain text', () => {
    const item = { markup: 'file', path: '/srv/run.sh', isNumbered: true } as const
    expect(formattedSource(item, 'loaded', '     1\t#!/bin/sh\n     2\t# say hi\n     3\techo hi')).toBe(
      '```sh\n#!/bin/sh\n# say hi\necho hi\n```',
    )
    const output = { markup: 'output', path: null, isNumbered: false } as const
    expect(formattedSource(output, 'loaded', '# not a heading\n* not a list')).toBe('```\n# not a heading\n* not a list\n```')
    expect(languageOf('/srv/App.TSX')).toBe('tsx')
    expect(languageOf('/srv/Makefile')).toBe('')
    expect(languageOf(null)).toBe('')
  })

  test('a fence is longer than any backtick run inside it', () => {
    expect(fenced('a ``` b', '')).toBe('````\na ``` b\n````')
    expect(fenced('plain', 'json')).toBe('```json\nplain\n```')
  })

  test('frontmatter is fenced as YAML, so its rules do not draw as a heading', () => {
    const prose = { markup: 'prose', path: null, isNumbered: false } as const
    expect(formattedSource(prose, 'loaded', '---\nname: x\n---\n# Title')).toBe('```yaml\nname: x\n```\n# Title')
  })
})

describe('escaping', () => {
  test('tags draw as written; code, autolinks and escaped tags are left alone', () => {
    expect(escapeMarkdown('<system-reminder>\nHello\n</system-reminder>', true)).toBe('\\<system-reminder>\nHello\n\\</system-reminder>')
    expect(escapeMarkdown('a <!-- note --> b <?xml?>', true)).toBe('a \\<!-- note --> b \\<?xml?>')
    expect(escapeMarkdown('use `<div>` here', true)).toBe('use `<div>` here')
    expect(escapeMarkdown('```html\n<div>\n```', true)).toBe('```html\n<div>\n```')
    expect(escapeMarkdown('see <https://example.com/a>', true)).toBe('see <https://example.com/a>')
    expect(escapeMarkdown('kept \\<b>', true)).toBe('kept \\<b>')
    expect(escapeMarkdown('1 < 2 and 3<4', true)).toBe('1 < 2 and 3<4')
    // An indented code block after a blank line is code.
    expect(escapeMarkdown('Text\n\n    <tag>', true)).toBe('Text\n\n    <tag>')
  })

  test('a link definition in text that is not Markdown draws as written', () => {
    expect(escapeMarkdown('Text [one][1].\n\n[1]: https://example.com', true)).toBe('Text [one][1].\n\n\\[1]: https://example.com')
    expect(escapeMarkdown('[a link](https://example.com)', true)).toBe('[a link](https://example.com)')
  })

  test('in Markdown a link definition stays, so a reference link works', () => {
    const source = 'See [docs][1].\n\n[1]: https://example.com'
    expect(escapeMarkdown(source, false)).toBe(source)
    const md = { markup: 'file', path: '/srv/notes.md', isNumbered: false } as const
    expect(formattedSource(md, 'loaded', source)).toBe(source)
    expect(formattedSource(md, 'disk', source)).toBe(source)
    expect(formattedSource({ markup: 'prose', path: null, isNumbered: false }, 'loaded', source)).toBe(source)
    const text = { markup: 'text', path: null, isNumbered: false } as const
    expect(formattedSource(text, 'loaded', source)).toBe('See [docs][1].\n\n\\[1]: https://example.com')
  })
})

describe('pages of the formatted view', () => {
  test('a short text is one page, as written; CRLF folds', () => {
    expect(markdownPages('# Title\n\nText')).toEqual([{ text: '# Title\n\nText', startLine: 1, endLine: 3 }])
    expect(markdownPages('a\r\n\r\n```\r\ncode\r\n```')).toEqual([{ text: 'a\n\n```\ncode\n```', startLine: 1, endLine: 5 }])
    expect(markdownPages('')).toEqual([{ text: '', startLine: 1, endLine: 1 }])
  })

  test('cuts at blank lines between paragraphs', () => {
    const paragraph = (k: number) => Array.from({ length: 7 }, (_, i) => `Paragraph ${k} line ${i}.`).join('\n')
    const source = Array.from({ length: 150 }, (_, k) => paragraph(k)).join('\n\n')
    const lines = source.split('\n')
    const pages = markdownPages(source)
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages.slice(1)) {
      // The line before each page's first line is blank.
      expect(lines[page.startLine - 2]).toBe('')
      expect(page.text.startsWith('Paragraph ')).toBe(true)
      expect(page.text.split('\n').length).toBeLessThanOrEqual(PAGE_LINES)
    }
    expect(pages.map(page => page.text).join('\n\n')).toBe(source)
    // Each page ends in the line before the next one starts; the last ends the text.
    pages.slice(0, -1).forEach((page, k) => expect(pages[k + 1]!.startLine).toBe(page.endLine + 1))
    expect(pages.at(-1)!.endLine).toBe(lines.length)
  })

  test('a typical 300-line instruction file is one page', () => {
    const sections = Array.from({ length: 60 }, (_, k) =>
      [`## Rule ${k + 1}`, '', `Write plain sentences for rule ${k + 1}.`, `- Keep each one short; this is item ${k + 1}.`].join('\n'),
    )
    const source = sections.join('\n\n')
    expect(source.split('\n').length).toBeGreaterThanOrEqual(299)
    expect(markdownPages(source)).toEqual([{ text: source, startLine: 1, endLine: source.split('\n').length }])
  })

  test('the largest page, a table head and one long row, stays well inside a tree', () => {
    const head = `| ${'h'.repeat(4000)} | b |\n| --- | --- |`
    const rows = Array.from({ length: 3 }, (_, i) => `| ${'v'.repeat(PAGE_CHARS - 1000)} | ${i} |`)
    const pages = markdownPages(`${head}\n${rows.join('\n')}`)
    const largest = Math.max(...pages.map(page => page.text.length))
    // A row is never cut: its page grows past PAGE_CHARS by the head.
    expect(largest).toBeGreaterThan(PAGE_CHARS)
    expect(largest).toBeLessThanOrEqual(PAGE_CHARS * 1.25 + 2)
    expect(largest).toBeLessThan(TREE_CHARS / 2)
    for (const page of pages.slice(1)) {
      expect(page.text.startsWith(head)).toBe(true)
    }
  })

  test('a fence across pages is closed and opened again with its info string', () => {
    const code = Array.from({ length: PAGE_LINES * 2 + 400 }, (_, i) => `const x${i} = ${i}`)
    const source = `Intro.\n\n\`\`\`ts\n${code.join('\n')}\n\`\`\`\n\nAfter.`
    const pages = markdownPages(source)
    expect(pages.length).toBeGreaterThanOrEqual(3)
    for (const page of pages) {
      // Each page opens and closes its own fences.
      expect(fenceLines(page.text).length % 2).toBe(0)
    }
    for (const page of pages.slice(1, -1)) {
      expect(page.text.startsWith('```ts\n')).toBe(true)
      expect(page.text.endsWith('\n```')).toBe(true)
    }
    // Every line of code is shown once, in order.
    const shown = pages.flatMap(page => page.text.split('\n')).filter(line => line.startsWith('const '))
    expect(shown).toEqual(code)
    expect(pages.at(-1)!.text.endsWith('After.')).toBe(true)
  })

  test('a table across pages repeats its head; a row is never cut', () => {
    const rows = Array.from({ length: PAGE_LINES * 2 + 300 }, (_, i) => `| row ${i} | ${'v'.repeat(i % 7)} |`)
    const source = `| Name | Value |\n| --- | --- |\n${rows.join('\n')}`
    const pages = markdownPages(source)
    expect(pages.length).toBeGreaterThanOrEqual(3)
    for (const page of pages) {
      const lines = page.text.split('\n')
      expect(lines.slice(0, 2)).toEqual(['| Name | Value |', '| --- | --- |'])
      for (const line of lines.slice(2)) {
        expect(rows).toContain(line)
      }
    }
    expect(pages.flatMap(page => page.text.split('\n').slice(2))).toEqual(rows)
  })

  test('a long paragraph with no blank line is cut between words, never in a link', () => {
    const words = Array.from({ length: 20_000 }, (_, i) => (i % 40 === 39 ? `[link number ${i}](https://example.com/${i})` : `word${i}`))
    const source = words.join(' ')
    const pages = markdownPages(source)
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      expect(page.text.length).toBeLessThanOrEqual(PAGE_CHARS)
      // Every bracket on a page belongs to a whole link.
      const rest = page.text.replace(/\[link number \d+\]\(https:\/\/example\.com\/\d+\)/g, '')
      expect(rest).not.toMatch(/[[\]()]/)
    }
    // Put back together, the pieces are the paragraph.
    expect(pages.map(page => page.text).join(' ')).toBe(source)
  })

  test('many lines with no blank line are cut at line ends, and a page does not start a block', () => {
    const lines = Array.from({ length: PAGE_LINES * 3 + 100 }, (_, i) => `- item ${i}`)
    const pages = markdownPages(lines.join('\n'))
    expect(pages.flatMap(page => page.text.split('\n'))).toEqual(lines)
    // The cut falls before "#": the next page must not draw it as a heading.
    const long = `${'w '.repeat(PAGE_CHARS / 4)}# not a heading ${'w '.repeat(PAGE_CHARS / 4 - 10)}`
    const cut = markdownPages(long)
    expect(cut.length).toBe(2)
    expect(cut[1]!.text.startsWith('\\# not a heading w')).toBe(true)
  })

  test('a fence whose first line is longer than a page starts with that line, not an empty block', () => {
    const json = `{"a":${'"x",'.repeat(PAGE_CHARS / 2)}"b":1}`
    const pages = markdownPages(formattedSource({ markup: 'output', path: null, isNumbered: false }, 'loaded', json))
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      const lines = page.text.split('\n')
      expect(lines[0]).toBe('```')
      expect(lines.at(-1)).toBe('```')
      // Code between the fence lines on every page.
      expect(lines.slice(1, -1).join('').length).toBeGreaterThan(0)
    }
    expect(pages.map(page => page.text.split('\n').slice(1, -1).join('')).join('')).toBe(json)
  })

  test('a page does not end with the opening line of a fence', () => {
    const head = Array.from({ length: PAGE_LINES - 1 }, (_, i) => `line ${i}`)
    const code = Array.from({ length: 10 }, (_, i) => `code ${i}`)
    const pages = markdownPages(`${head.join('\n')}\n\`\`\`js\n${code.join('\n')}\n\`\`\``)
    expect(pages.length).toBe(2)
    expect(pages[0]!.text).toBe(head.join('\n'))
    expect(pages[1]!.text).toBe(`\`\`\`js\n${code.join('\n')}\n\`\`\``)
  })

  test('a page does not start on a line indented four spaces, which would draw as code', () => {
    const pairs = Array.from({ length: PAGE_LINES * 0.6 }, (_, n) => `- Rule ${n}: keep item ${n}.\n    1. Sub step ${n}a.`)
    const source = `## Rules\n\nIntro line.\n${pairs.join('\n')}`
    const pages = markdownPages(escapeMarkdown(source, false))
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      expect(page.text).not.toMatch(/^(?: {4}|\t)/)
    }
    expect(pages.flatMap(page => page.text.split('\n'))).toEqual(source.split('\n'))
  })

  test('a switch keeps the place: the page that holds the same line', () => {
    expect(mappedLine(51, 120, 120)).toBe(51)
    expect(mappedLine(1, 120, 10)).toBe(1)
    expect(mappedLine(120, 120, 10)).toBe(10)
    expect(pageAtLine([1, 51, 101], 60)).toBe(1)
    expect(pageAtLine([1, 51, 101], 1)).toBe(0)
    // One long line cut into pages: the page where the line begins.
    expect(pageAtLine([1, 1, 1, 1], 1)).toBe(0)
    expect(pageAtLine([1, 1, 1, 5], 3)).toBe(2)
    expect(pageAtLine([1, 4, 4, 9], 4)).toBe(1)
  })

  test('a switch to the formatted view inside one long line opens its first page', () => {
    const [prompt] = buildItems('prompts', DATA).items
    const resolved = { loaded: 'word '.repeat(PAGE_CHARS / 2).trim(), disk: null, isDiskRead: false }
    const shown = contentOf(prompt!, resolved, 'loaded', 0, false, 'formatted', { format: 'raw', page: 0 })
    expect(shown.pages).toBeGreaterThan(1)
    expect(shown.page).toBe(0)
  })

  test('display text comes first: control characters do not reach the element', () => {
    const prose = { markup: 'prose', path: null, isNumbered: false } as const
    const text = formattedSource(prose, 'loaded', displayText('# Title\r\n\r\nred \x1b[31mtext\x1b[0m\x07'))
    expect(text).toBe('# Title\n\nred text?')
  })
})
