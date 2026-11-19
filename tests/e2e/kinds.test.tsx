// Journey 4, every item kind: one item of each kind the fixtures can produce,
// opened from its segment. Level 3 must state its size and form, start with the
// right text, and show nothing empty, cut in the middle of a character, or
// longer than the pane can take.

import { expect, test } from 'claude-code/testing'

import { CODE_LINE_CHARS } from '../../hooks/text'
import { CHAT, LOCAL_COMMAND, SUMMARY } from '../fixtures'
import { chat, flatten, mountPane, ringOf, session, tap } from './helpers'
import { badLines, factsOf, figuresOf, keysWith, level2, level3, longest, widest } from './journeys'

const SURFACES = ['terminal', 'desktop'] as const
const COLUMNS = 88

/** Wide cells, a pair of code units, a letter with a combining mark: all that a split could cut. */
const WIDE_LINE = `${'日本語'.repeat(150)}${'😀'.repeat(300)}${'é'.repeat(400)}`
/** A line whose cut at CODE_LINE_CHARS falls inside a surrogate pair: 449 units, then emoji. */
const PAIR_LINE = `${'a'.repeat(CODE_LINE_CHARS - 551)}${'😀'.repeat(400)}`
/** A line whose cut at CODE_LINE_CHARS falls between an e and its combining mark. */
const MARK_LINE = `${'a'.repeat(CODE_LINE_CHARS - 1)}${'e\u0301'.repeat(200)}`

/** The long lines, each in a Bash result of its own between a first and a last line. */
const LONG_LINES = [
  { id: 'tuw', command: 'echo wide', line: WIDE_LINE },
  { id: 'tup', command: 'echo pair', line: PAIR_LINE },
  { id: 'tum', command: 'echo mark', line: MARK_LINE },
] as const

const WIDE = LONG_LINES.flatMap(({ id, command, line }) => [
  { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `first line\n${line}\nlast line` }] },
])

const MESSAGES = [...SUMMARY, ...CHAT, ...LOCAL_COMMAND, ...WIDE]

type Kind = {
  name: string
  row: string
  /** Text that picks the item among the rows of its segment. */
  pick: string
  crumb: RegExp
  form: 'raw' | 'formatted'
  source: 'as loaded' | 'on disk'
  /** The text level 3 starts with, line by line. */
  start: string[]
  note?: string
  /** Pattern for the first line, when the line is too long to write out. */
  first?: RegExp
}

const KINDS: Kind[] = [
  { name: 'Bash result', row: 'row-tool-results', pick: 'ls -la /srv/data', crumb: /^██ Tool results › Bash {2}ls -la \/srv\/data && echo done$/, form: 'raw', source: 'as loaded', start: ['total 0'] },
  { name: 'Read result', row: 'row-tool-results', pick: 'notes.txt', crumb: /^██ Tool results › Read {2}~\/project\/notes\.txt$/, form: 'raw', source: 'as loaded', start: ['     1\talpha', '     2\tbeta'] },
  { name: 'Bash result with wide text', row: 'row-tool-results', pick: 'echo wide', crumb: /^██ Tool results › Bash {2}echo wide$/, form: 'raw', source: 'as loaded', start: ['first line'] },
  { name: 'project instruction file', row: 'row-project-instructions', pick: 'CLAUDE.md', crumb: /^██ Project › ~\/project\/CLAUDE\.md$/, form: 'formatted', source: 'as loaded', start: ['# Project', '', 'Use tabs for indents.'] },
  { name: 'global instruction file', row: 'row-global-instructions', pick: 'CLAUDE.md', crumb: /^██ Global › ~\/\.claude\/CLAUDE\.md$/, form: 'formatted', source: 'on disk', start: ['Be brief.'], note: 'Not found in the conversation’s opening reminder: shown from disk.' },
  { name: 'skill body', row: 'row-skill-bodies', pick: 'demo-skill', crumb: /^██ Skill bodies › demo-skill$/, form: 'formatted', source: 'as loaded', start: ['Base directory for this skill: /home/user/.claude/skills/demo-skill', '', '# Demo', 'Do the steps.'] },
  { name: 'prompt', row: 'row-prompts', pick: 'Please read the notes', crumb: /^██ Prompts › Please read the notes/, form: 'formatted', source: 'as loaded', start: ['Please read the notes file and list the folder.'] },
  { name: 'prompt that ran a local command', row: 'row-prompts', pick: '/review src', crumb: /^██ Prompts › \/review src$/, form: 'formatted', source: 'as loaded', start: ['\\<command-message>review is running…\\</command-message>', '\\<command-name>/review\\</command-name>', '\\<command-args>src\\</command-args>'] },
  { name: 'Claude output', row: 'row-claude-output', pick: 'The folder holds one data file.', crumb: /^██ Claude › The folder holds one data file\.$/, form: 'formatted', source: 'as loaded', start: ['The folder holds one data file.'] },
  { name: 'task report', row: 'row-task-reports', pick: 'Build finished', crumb: /^██ Tasks › Build finished$/, form: 'raw', source: 'as loaded', start: ['<task-notification>', '<task-id>b1</task-id>', '<status>completed</status>', '<summary>Build finished</summary>'] },
  { name: 'system reminder', row: 'row-injections', pick: 'The task list is empty.', crumb: /^██ Notifications › The task list is empty\.$/, form: 'raw', source: 'as loaded', start: ['<system-reminder>'] },
  { name: 'local command caveat', row: 'row-injections', pick: 'Local command caveat', crumb: /^██ Notifications › Local command caveat$/, form: 'raw', source: 'as loaded', start: ['<local-command-caveat>The command below was run directly by the user, not sent to you. Do not answer it.</local-command-caveat>'] },
  { name: 'local command report', row: 'row-injections', pick: 'Output of /context', crumb: /^██ Notifications › Output of \/context$/, form: 'raw', source: 'as loaded', start: ['## Context Usage', '', '**Tokens:** 12k / 200k (6%)'] },
  { name: 'local command output', row: 'row-injections', pick: 'Output: Compacted', crumb: /^██ Notifications › Output: Compacted$/, form: 'raw', source: 'as loaded', start: ['<local-command-stdout>Compacted</local-command-stdout>'] },
  { name: 'compaction summary', row: 'row-compaction-summary', pick: 'Compaction summary', crumb: /^██ Summary › Compaction summary$/, form: 'formatted', source: 'as loaded', start: [], first: /^This session is being continued from a previous conversation\. s+$/ },
]

/** Segments whose items are rows of text, not controls. */
const TEXT_ROWS = ['row-system', 'row-mcp', 'row-skills-agents'] as const

for (const surface of SURFACES) {
  test(`J4 ${surface}: every kind of item opens with its size, its form and its first lines`, async ($, on) => {
    await session($, on, { ...chat(), messages: MESSAGES })
    const ui = await mountPane($, surface, { columns: COLUMNS, isFocused: true })
    const opts = { surface, columns: COLUMNS } as const
    const level1 = flatten(await ui.drawn(), opts)

    for (const kind of KINDS) {
      const two = level2(await tap(ui, kind.row, opts))
      // The item is found by its row's text; its key is the Button at the same place.
      const at = two.rows.findIndex(row => row.includes(kind.pick))
      expect(at, `${kind.name}: a row with "${kind.pick}" in ${two.name}`).toBeGreaterThanOrEqual(0)
      const key = (await keysWith(ui, 'item-'))[at]!
      const size = figuresOf(two.rows[at]!)!.tokens

      const lines = await tap(ui, key, opts)
      const three = level3(lines)
      const facts = factsOf(three.facts)
      expect(three.crumb, kind.name).toMatch(kind.crumb)
      expect(facts, `${kind.name}: ${three.facts}`).toMatchObject({ tokens: size, form: kind.form, source: kind.source })
      expect(three.notes, kind.name).toEqual(kind.note === undefined ? [] : [kind.note])
      expect(three.controls.join(' '), kind.name).toContain('Back')
      expect(three.body.slice(0, kind.start.length), kind.name).toEqual(kind.start)
      if (kind.first !== undefined) {
        expect(three.body[0], kind.name).toMatch(kind.first)
      }

      // Something to read, and nothing that should not be there.
      expect(three.body.some(line => line.trim() !== ''), `${kind.name} has text`).toBe(true)
      expect(three.body[0] ?? '', `${kind.name} starts with text`).not.toBe('')
      expect(badLines(lines), kind.name).toEqual([])
      // The head fits the pane. The body is wrapped by the engine, but no line may pass
      // the pane's own limit for a code line.
      expect(widest([three.crumb, three.facts, ...three.notes, ...three.controls]), kind.name).toBeLessThanOrEqual(COLUMNS)
      if (facts!.form === 'raw') {
        expect(longest(three.body), kind.name).toBeLessThanOrEqual(CODE_LINE_CHARS)
      }

      expect(level2(await tap(ui, 'back', opts)).name, kind.name).toBe(two.name)
      expect(await ringOf(ui), kind.name).toBe(key)
      expect(await tap(ui, 'back', opts)).toEqual(level1)
    }
    await ui.unmount()
  })

  test(`J4 ${surface}: a long line with wide characters is split without losing any of it, never inside a surrogate pair`, async ($, on) => {
    await session($, on, { ...chat(), messages: MESSAGES })
    const ui = await mountPane($, surface, { columns: COLUMNS, isFocused: true })
    const opts = { surface, columns: COLUMNS } as const

    // The cuts fall where a naive split would break a character.
    expect(PAIR_LINE.charCodeAt(CODE_LINE_CHARS)).toBeGreaterThanOrEqual(0xdc00)
    expect(PAIR_LINE.charCodeAt(CODE_LINE_CHARS)).toBeLessThanOrEqual(0xdfff)
    expect(MARK_LINE.slice(CODE_LINE_CHARS - 1, CODE_LINE_CHARS + 1)).toBe('e\u0301')

    await tap(ui, 'row-tool-results', opts)
    for (const { id, line } of LONG_LINES) {
      const three = level3(await tap(ui, `item-r:${id}`, opts))
      expect(three.body[0], id).toBe('first line')
      const end = three.body.indexOf('last line')
      expect(end, `${id}: the last line is shown`).toBeGreaterThan(1)
      // The long line comes in pieces; put together they are the whole line, with nothing between.
      const pieces = three.body.slice(1, end)
      expect(pieces.length, id).toBeGreaterThan(1)
      expect(pieces.every(piece => piece.length <= CODE_LINE_CHARS), id).toBe(true)
      // The split keeps a surrogate pair whole. It can cut between a letter
      // and its combining mark (text.ts, `safeCut`), so the check of broken
      // text skips a piece of `tum` that starts with a mark. The pieces still
      // rejoin to the whole line.
      const stray = (piece: string) => /^\p{M}/u.test(piece)
      expect(badLines(pieces.filter(piece => id !== 'tum' || !stray(piece))), id).toEqual([])
      expect(pieces.join(''), id).toBe(line)
      await tap(ui, 'back', opts)
    }
    await ui.unmount()
  })

  test(`J4 ${surface}: baseline rows that are not controls list their items as text and offer nothing to open`, async ($, on) => {
    await session($, on, { ...chat(), messages: MESSAGES })
    const ui = await mountPane($, surface, { columns: COLUMNS, isFocused: true })
    const opts = { surface, columns: COLUMNS } as const
    const level1 = flatten(await ui.drawn(), opts)

    for (const row of TEXT_ROWS) {
      const two = level2(await tap(ui, row, opts))
      expect(two.rows.length, row).toBe(two.count)
      expect(await keysWith(ui, 'item-'), row).toEqual([])
      expect(two.keys, row).not.toContain('Open')
      // On the terminal a row that opens starts with its number; these do not.
      expect(two.rows.every(line => !/^\d: /.test(line)), row).toBe(true)
      expect(await tap(ui, 'back', opts)).toEqual(level1)
    }
    await ui.unmount()
  })
}
