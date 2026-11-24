// Journey 2, walk every segment: from level 1 into each of the ten segments of
// the critique's session, look at level 2, open the first item that opens,
// look at level 3, and come back. Checked by what the pane says, not by props.

import { expect, test } from 'claude-code/testing'

import type { ContextBreakdownSegmentId } from '../../types'
import { segmentDef } from '../../hooks/segments'
import { CODE_LINE_CHARS } from '../../hooks/text'
import { GLOBAL_MD, flatten, mountPane, real, ringOf, session, tap } from './helpers'
import { factsOf, figuresOf, keysWith, labelOf, level2, level3, levelOne, longest, tokensOf, widest } from './journeys'

const SURFACES = ['terminal', 'desktop'] as const
const COLUMNS = 88
const MEMORY_MD = '/home/user/.claude/memory/MEMORY.md'

/** The ten level-1 rows of the session, in order, and whether each lists items that open. */
const SEGMENTS = [
  ['row-system', false],
  ['row-mcp', false],
  ['row-global-instructions', true],
  ['row-auto-memory', true],
  ['row-skills-agents', false],
  ['row-compaction-summary', true],
  ['row-tool-results', true],
  ['row-injections', true],
  ['row-prompts', true],
  ['row-claude-output', true],
] as const

for (const surface of SURFACES) {
  test(`J2 ${surface}: every segment opens, lists its items, opens its first item, and comes back`, async ($, on) => {
    await session($, on, {
      ...real(),
      files: { [GLOBAL_MD]: 'Be brief.\n', [MEMORY_MD]: '- Prefers short answers.\n' },
    })
    const ui = await mountPane($, surface, { columns: COLUMNS, isFocused: true })
    const opts = { surface, columns: COLUMNS } as const
    const before = flatten(await ui.drawn(), opts)

    expect(await keysWith(ui, 'row-')).toEqual(SEGMENTS.map(([key]) => key))
    expect(await ringOf(ui)).toBe('row-system')
    /**
     * Level 1 after b: as it was, but for the terminal's line that describes
     * the ringed row, which now names the row the ring came back to.
     */
    const expectBack = (lines: string[], label: string) => {
      const back = levelOne(lines, surface)
      expect(back.table).toEqual(levelOne(before, surface).table)
      if (surface === 'terminal') {
        expect(back.described.join(' ').startsWith(`${label}: `), `${label} is described`).toBe(true)
      }
    }

    for (const [rowKey, isOpenable] of SEGMENTS) {
      const label = await labelOf(ui, rowKey)
      // The row's figures on level 1, to hold level 2 against.
      // Off the terminal the row starts with its swatch, a picture flatten prints as <svg>.
      const row = before.find(line => line.replace(surface === 'terminal' ? /^(\d: | {3})/ : /^<svg>/, '').startsWith(label))
      const figures = figuresOf(row ?? '')
      expect(figures, `${rowKey} has figures on level 1`).toBeDefined()

      const lines2 = await tap(ui, rowKey, opts)
      const two = level2(lines2)
      // Level 2 names the same segment and states the same figures.
      expect(two.name).toBe(label)
      expect([two.tokens, two.share]).toEqual([figures!.tokens, figures!.share])
      expect(two.count).toBeGreaterThan(0)
      expect(two.rows.length).toBe(Math.min(two.count, 20))
      expect(two.header).toMatch(/% of segment$/)
      expect(two.keys).toContain('Back')
      expect(two.definition).toMatch(/^[A-Z].*\.$/)
      // p and n stand in the line, as a pair, only while the list has pages.
      expect(two.keys.includes('Prev page')).toBe(two.count > 20)
      expect(two.keys.includes('Next page')).toBe(two.count > 20)
      // Off the terminal the surface wraps the definition when it paints, so it alone may pass the width here.
      expect(widest(surface === 'terminal' ? lines2 : lines2.filter(line => line !== two.definition))).toBeLessThanOrEqual(COLUMNS)
      // The items add up to the segment, within the rounding of the figures.
      const sum = two.rows.reduce((total, line) => total + tokensOf(figuresOf(line)!.tokens), 0)
      expect(sum).toBeGreaterThan(tokensOf(two.tokens) * 0.92)
      expect(sum).toBeLessThan(tokensOf(two.tokens) * 1.08)
      const shares = two.rows.reduce((total, line) => total + Number.parseFloat(figuresOf(line)!.share), 0)
      expect(shares).toBeGreaterThan(94)
      expect(shares).toBeLessThan(106)

      const items = await keysWith(ui, 'item-')
      if (!isOpenable) {
        // Rows of text, not controls: nothing to open, and the key line does not offer it.
        expect(items, `${rowKey} lists no items that open`).toEqual([])
        expect(two.keys).not.toContain('Open')
        expectBack(await tap(ui, 'back', opts), label)
        expect(await ringOf(ui)).toBe(rowKey)
        continue
      }
      expect(items.length, `${rowKey} lists items that open`).toBe(two.rows.length)
      expect(two.keys).toContain('Open')

      const lines3 = await tap(ui, items[0]!, opts)
      const three = level3(lines3)
      const facts = factsOf(three.facts)
      expect(facts, `facts line of ${rowKey}: ${three.facts}`).toBeDefined()
      // The largest item is first, and level 3 states the size level 2 gave it.
      expect(facts!.tokens).toBe(figuresOf(two.rows[0]!)!.tokens)
      // Its place counts all items of the list, as level 2's facts do.
      expect(facts!.place).toBe(`item 1 of ${two.count}`)
      // Level 3's title has level 2's form: the trail, the swatch, the segment's name, then the item. A
      // title too long for one line drops the trail and keeps the short name, as level 2 shortens.
      expect(surface === 'terminal' ? three.crumb : three.crumb.replace(/^(Context › )?<svg> /, '$1██ ')).toMatch(/^(Context › )?█+ \S.* › \S/)
      const def = segmentDef(rowKey.slice('row-'.length) as ContextBreakdownSegmentId)
      expect([def.label, def.short].some(name => three.crumb.includes(` ${name} › `)), three.crumb).toBe(true)
      expect(three.controls.join(' ')).toContain('Back')
      expect(three.body.find(line => line.trim() !== '') ?? '').not.toBe('')
      // The engine wraps text when it paints, so the pane promises only that the head
      // of level 3 fits its width and that no code line passes CODE_LINE_CHARS.
      expect(widest([three.crumb, three.facts, ...three.notes, ...three.controls])).toBeLessThanOrEqual(COLUMNS)
      if (facts!.form === 'raw') {
        expect(longest(three.body)).toBeLessThanOrEqual(CODE_LINE_CHARS)
      }

      // Back goes to level 2 as it was, with the ring on the item that was opened.
      expect(await tap(ui, 'back', opts)).toEqual(lines2)
      expect(await ringOf(ui)).toBe(items[0])
      // Back again goes to level 1 as it was, with the ring on the row.
      expectBack(await tap(ui, 'back', opts), label)
      expect(await ringOf(ui)).toBe(rowKey)
    }
    await ui.unmount()
  })
}
