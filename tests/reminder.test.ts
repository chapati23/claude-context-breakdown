import { describe, expect, test } from 'claude-code/testing'

import type { MessageLike } from '../hooks/classify'
import { compareFile, compareRead, loadedFileText, readLines, sectionOf } from '../hooks/reminder'

const A = '/home/user/.claude/CLAUDE.md'
const B = '/home/user/project/CLAUDE.md'

const REMINDER = [
  '<system-reminder>',
  "As you answer the user's questions, you can use the following context:",
  '# claudeMd',
  'Codebase and user instructions are shown below.',
  '',
  `Contents of ${A} (user's private global instructions for all projects):`,
  '',
  '# Global',
  '',
  '- Be brief.',
  '',
  `Contents of ${B}.bak (an old copy):`,
  '',
  'old',
  '',
  `Contents of ${B} (project instructions, checked into the codebase):`,
  '',
  '# Project',
  'Use tabs.',
  '# currentDate',
  "Today's date is 2000-01-01.",
  '',
  '      IMPORTANT: this context may or may not be relevant to your tasks.',
  '</system-reminder>',
].join('\n')

describe('sectionOf', () => {
  test('reads each file up to the next section', () => {
    expect(sectionOf(REMINDER, A)).toBe('# Global\n\n- Be brief.')
    expect(sectionOf(REMINDER, B)).toBe('# Project\nUse tabs.')
    expect(sectionOf(REMINDER, `${B}.bak`)).toBe('old')
  })

  test('finds no section for a path that is only a prefix', () => {
    expect(sectionOf(REMINDER, '/home/user/project/CLAUDE')).toBeNull()
  })
})

describe('loadedFileText', () => {
  const messages: MessageLike[] = [
    { role: 'user', content: [{ type: 'text', text: REMINDER }, { type: 'text', text: `Contents of ${A}: a quote` }] },
    { role: 'assistant', content: [{ type: 'text', text: `Contents of ${A}:` }] },
  ]

  test('reads the opening reminder', () => {
    expect(loadedFileText(messages, A)).toBe('# Global\n\n- Be brief.')
  })

  test('is null for a file no reminder carries', () => {
    expect(loadedFileText(messages, '/home/user/other.md')).toBeNull()
  })
})

describe('compareFile', () => {
  test('the same text, or one that differs in line ends and trailing space, is the same', () => {
    expect(compareFile('# Global\n\n- Be brief.', '# Global\r\n\r\n- Be brief.  \n')).toBe('same')
  })

  test('HTML comments and frontmatter do not count', () => {
    expect(compareFile('Rule one.', '---\npaths: src\n---\nRule one.<!-- note -->\n')).toBe('same')
  })

  test('a changed line is a change', () => {
    expect(compareFile('Use tabs.', 'Use spaces.')).toBe('changed')
  })

  test('a cut or a truncation note is unknown, never a change', () => {
    expect(compareFile('line 1\nline 2', 'line 1\nline 2\nline 3')).toBe('unknown')
    expect(compareFile('line 1\n\n> This file was truncated.', 'line 1\nline 2')).toBe('unknown')
  })

  // The engine's own note under a MEMORY.md it cut at load (2.1.325).
  const cutNote = (lines: number) =>
    `\n\n> WARNING: MEMORY.md is ${lines} lines (limit: 200). Only part of it was loaded: ` +
    `${lines - 2} of ${lines} lines were cut off, starting at line 3 ("l3"). ` +
    'Keep index entries to one line under ~200 chars; move detail into topic files.'

  test('a MEMORY.md the engine cut is unknown while its head matches, a change when the head differs', () => {
    const disk = Array.from({ length: 300 }, (_, i) => `l${i + 1}`).join('\n')
    expect(compareFile(`l1\nl2${cutNote(300)}`, `${disk}\n`)).toBe('unknown')
    expect(compareFile(`l1\nl2${cutNote(300)}`, 'l1\nl2\nl3\n')).toBe('unknown')
    expect(compareFile(`l1\nCHANGED${cutNote(300)}`, `${disk}\n`)).toBe('changed')
  })
})

describe('readLines', () => {
  test('reads the numbered head of a Read result, with tabs or arrows', () => {
    expect(readLines('     1\talpha\n     2\tbeta\n<system-reminder>x</system-reminder>')).toEqual({
      first: 1,
      lines: ['alpha', 'beta'],
    })
    expect(readLines('  10→ten\n  11→eleven')).toEqual({ first: 10, lines: ['ten', 'eleven'] })
  })

  test('is null without numbers, or with numbers out of order', () => {
    expect(readLines('File unchanged since last read.')).toBeNull()
    expect(readLines('     1\ta\n     3\tc')).toBeNull()
  })
})

describe('compareRead', () => {
  const file = 'alpha\nbeta\ngamma\n'

  test('a whole read of the same file is the same', () => {
    expect(compareRead('     1\talpha\n     2\tbeta\n     3\tgamma\n', file)).toBe('same')
  })

  test('a partial read compares only its lines', () => {
    expect(compareRead('     2\tbeta', file)).toBe('same')
    expect(compareRead('     2\tbeta\n\n<system-reminder>a note</system-reminder>', file)).toBe('same')
  })

  test('a changed or missing line is a change', () => {
    expect(compareRead('     2\tBETA', file)).toBe('changed')
    expect(compareRead('     9\tlate', file)).toBe('changed')
  })

  test('a long line the tool may have cut is not compared', () => {
    const long = 'y'.repeat(3000)
    expect(compareRead(`     1\t${'y'.repeat(2000)}… [truncated]`, `${long}\n`)).toBe('same')
  })

  test('a result without numbered lines is unknown', () => {
    expect(compareRead('Wrote the file.', file)).toBe('unknown')
  })
})
