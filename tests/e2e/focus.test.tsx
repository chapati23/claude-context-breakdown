// Journey 1, first look and focus: the pane as it opens without the keys,
// then with them (Tab in), then without them again (Escape out), at five
// widths and at each level. Without the keys the hint line shows. On the
// terminal the rows show dim number marks and no Button has a hotkey. A
// desktop draws a hotkey as a key cap inside the native button, so there
// every Button keeps its hotkey in both states, and a hotkey presses only
// with the keys. With them the first nine rows have the hotkeys 1-9 and the
// tenth has none. After Escape the drawing is the first one again, and no
// column of a row moves between the two; on a desktop a row with a key cap
// and a row without one start their names in one column. At every level
// and in both states no two Buttons hold the same hotkey. Only the terminal,
// with the keys, draws Down and Up (j and k); the desktop draws them at no
// level, in either state.

import { expect, test } from 'claude-code/testing'

import { keysHint } from '../../hooks/pane'
import { showsHotkeys } from '../../hooks/table'
import { cellWidth } from '../../hooks/text'
import { flatten, hotkeysOf, mountPane, real, session, setFocus } from './helpers'
import type { PaneUi } from './helpers'

const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [24, 45, 64, 88, 140] as const

/** The presses from level 1 to each level: Tool results, then its largest item. */
const LEVELS = [
  { level: 1, path: [] },
  { level: 2, path: ['row-tool-results'] },
  { level: 3, path: ['row-tool-results', 'item-r:real0'] },
] as const

/** The marks flatten adds for the ring, off and dim parts, taken out. */
const unmarked = (line: string) => line.replace(/[⟦⟧⟪⟫⟨⟩]/g, '')

/** The cells of a line up to `index` (a code-unit index). */
const cellsTo = (line: string, index: number) => cellWidth(line.slice(0, index))

/** The glyphs a length bar or the swatch draws. */
const BAR = /[█▉▊▋▌▍▎▏▒·]/

/** The figures that end a table line: tokens, and the share when the width has room for it. */
const FIGURES = /(?:^|\s)(~?\d[\d.,]*k?)(?:\s+~?\d[\d.]*%)?$/

/**
 * Where the parts of a table line start, in cells: the name (the first text
 * after the mark, "1: " or three spaces, when the width has one), the bar
 * (-1 when the width has none) and the figures. Undefined for a line that is
 * not a table line.
 */
function partsOf(line: string): { name: number; bar: number; figures: number } | undefined {
  const text = unmarked(line)
  const figures = FIGURES.exec(text)
  if (figures === null) {
    return undefined
  }
  const skip = /^(\d: | {3})/.test(text) ? 3 : 0
  const name = skip + text.slice(skip).search(/\S/)
  const bar = text.search(BAR)
  const at = figures.index + figures[0].indexOf(figures[1]!)

  return { name: cellsTo(text, name), bar: bar < 0 ? -1 : cellsTo(text, bar), figures: cellsTo(text, at) }
}

/** The parts of every table line, by line number. */
function tableOf(lines: readonly string[]): Record<number, ReturnType<typeof partsOf>> {
  const out: Record<number, ReturnType<typeof partsOf>> = {}
  lines.forEach((line, i) => {
    const parts = partsOf(line)
    if (parts !== undefined) {
      out[i] = parts
    }
  })

  return out
}

/** The rows that open (row-* and item-* Buttons) with their hotkeys, in drawing order. */
async function rowHotkeys(ui: PaneUi): Promise<(string | undefined)[]> {
  return (await ui.findAll({ type: 'Button' }))
    .filter(button => /^(row|item)-/.test(button.key ?? ''))
    .map(button => (typeof button.props.hotkey === 'string' ? button.props.hotkey : undefined))
}

/** The hotkeys of every Button drawn. */
const allHotkeys = hotkeysOf

/** The Down and Up controls and any Button that holds j or k, as "key:hotkey". */
async function stepsOf(ui: PaneUi): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' }))
    .filter(button => /^(list|scroll)-(down|up)$/.test(button.key ?? '') || button.props.hotkey === 'j' || button.props.hotkey === 'k')
    .map(button => `${button.key ?? ''}:${String(button.props.hotkey)}`)
}

/** Characters that a regular expression reads as syntax, escaped. */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The column, in cells, where each row's name starts on a desktop: after
 * the key cap (`h: ` in the flattened text) or the blank cells that take its
 * place. One entry per row that opens.
 */
async function nameColumns(ui: PaneUi, lines: readonly string[]): Promise<number[]> {
  const rows = (await ui.findAll({ type: 'Button' })).filter(button => /^(row|item)-/.test(button.key ?? ''))

  return rows.map(row => {
    const hotkey = typeof row.props.hotkey === 'string' ? `${row.props.hotkey}: ` : ' {3}'
    const name = new RegExp(`${hotkey}${literal(String(row.props.label))}`)
    const line = lines.map(unmarked).find((text, i) => i > 0 && name.test(text)) ?? ''
    const at = name.exec(line)?.index ?? -1

    return at < 0 ? -1 : cellsTo(line, at) + 3
  })
}

/** The hotkeys held by more than one Button: one press would reach only one of them. */
async function twiceHeld(ui: PaneUi): Promise<string[]> {
  const keys = await allHotkeys(ui)

  return [...new Set(keys.filter((key, i) => keys.indexOf(key) !== i))]
}

for (const surface of SURFACES) {
  test(`J1 ${surface}: without the keys, with them, and after Escape, at five widths and three levels`, async ($, on) => {
    await session($, on, real())
    const hint = keysHint(surface)

    for (const { level, path } of LEVELS) {
      for (const columns of WIDTHS) {
        const where = `level ${level} at ${columns}`
        const opts = { marks: true, surface, columns } as const
        // Below 32 columns the rows have no marks and no hotkeys (table.ts).
        const marked = showsHotkeys(columns)
        const digits = marked ? ['1', '2', '3', '4', '5', '6', '7', '8', '9'] : []
        const ui = await mountPane($, surface, { columns })
        for (const key of path) {
          await ui.press({ key })
        }

        // First look, without the keys: the hint line. The terminal: dim
        // marks, no hotkey anywhere. A desktop: the rows' and the controls'
        // hotkeys, drawn as key caps.
        const first = flatten(await ui.drawn(), opts)
        const firstHotkeys = await allHotkeys(ui)
        expect({ where, hint: first.includes(`⟨${hint}⟩`) }).toEqual({ where, hint: true })
        expect({ where, twice: await twiceHeld(ui) }).toEqual({ where, twice: [] })
        if (surface === 'terminal') {
          expect({ where, hotkeys: firstHotkeys }).toEqual({ where, hotkeys: [] })
          if (level < 3) {
            const marks = first.filter(line => /^(⟦)?⟨[1-9]: ⟩/.test(line)).map(line => /[1-9]/.exec(line)?.[0])
            expect({ where, marks }).toEqual({ where, marks: digits })
          }
        } else if (level < 3) {
          // No dim mark of the mod's own: the digit is the key cap's.
          expect({ where, dim: first.some(line => /⟨[1-9]: ⟩/.test(line)) }).toEqual({ where, dim: false })
          // No Down and Up and no j or k: Tab moves the ring along the rows.
          expect({ where, steps: await stepsOf(ui) }).toEqual({ where, steps: [] })
          const keys = await rowHotkeys(ui)
          expect({ where, keys: keys.slice(0, digits.length) }).toEqual({ where, keys: digits })
          expect({ where, rest: keys.slice(digits.length).every(key => key === undefined) }).toEqual({ where, rest: true })
        } else {
          // Level 3 off the terminal has no j and k: the app scrolls the text.
          expect({ where, keys: firstHotkeys.slice(0, 3) }).toEqual({ where, keys: ['b', 'p', 'n'] })
        }

        // Tab in: the hint goes, the first nine rows take 1-9, the tenth none
        // (at 24 columns no row has a digit).
        await setFocus(ui, true)
        const focused = flatten(await ui.drawn(), opts)
        expect({ where, hint: focused.includes(`⟨${hint}⟩`) }).toEqual({ where, hint: false })
        expect({ where, twice: await twiceHeld(ui) }).toEqual({ where, twice: [] })
        if (level < 3) {
          const keys = await rowHotkeys(ui)
          expect({ where, keys: keys.slice(0, digits.length) }).toEqual({ where, keys: digits })
          expect({ where, rest: keys.slice(digits.length).every(key => key === undefined) }).toEqual({ where, rest: true })
          expect({ where, tenth: keys.length >= 10 }).toEqual({ where, tenth: true })
          // With the keys only the terminal draws Down and Up (j and k).
          const steps = surface === 'terminal' ? ['list-down:j', 'list-up:k'] : []
          expect({ where, steps: await stepsOf(ui) }).toEqual({ where, steps })
        } else {
          const first3 = surface === 'terminal' ? ['j', 'k', 'b'] : ['b', 'p', 'n']
          expect({ where, keys: (await allHotkeys(ui)).slice(0, 3) }).toEqual({ where, keys: first3 })
        }

        // On a desktop the keys change no hotkey: Tab in removes the hint only.
        if (surface === 'desktop') {
          expect({ where, hotkeys: await allHotkeys(ui) }).toEqual({ where, hotkeys: firstHotkeys })
        }

        // Escape out: the same drawing as the first, mark for mark.
        await setFocus(ui, false)
        const again = flatten(await ui.drawn(), opts)
        expect({ where, lines: again }).toEqual({ where, lines: first })
        expect({ where, hotkeys: await allHotkeys(ui) }).toEqual({ where, hotkeys: firstHotkeys })

        // On a desktop a row with a key cap and a row without one (the tenth)
        // start their names in one column, in both states.
        if (surface === 'desktop' && level < 3 && marked) {
          for (const lines of [first, focused]) {
            const columns = await nameColumns(ui, lines)
            expect({ where, found: columns.every(column => column >= 0) }).toEqual({ where, found: true })
            expect({ where, columns: new Set(columns).size }).toEqual({ where, columns: 1 })
          }
        }

        // Between the two states no table line moves its name, bar or figures.
        // The keys line and the hint differ, so the rows are matched by text
        // above that point: each line before the first difference keeps its number.
        const firstTable = tableOf(first)
        const focusedTable = tableOf(focused)
        const shared = Object.keys(firstTable).filter(i => focusedTable[Number(i)] !== undefined)
        expect({ where, rows: shared.length }).toEqual({ where, rows: Object.keys(firstTable).length })
        for (const i of shared) {
          expect({ where, line: unmarked(first[Number(i)]!), parts: focusedTable[Number(i)] }).toEqual({
            where,
            line: unmarked(first[Number(i)]!),
            parts: firstTable[Number(i)],
          })
        }
        if (level < 3) {
          // A list has table lines: rows, group heads, and the free space.
          expect({ where, some: shared.length >= 10 }).toEqual({ where, some: true })
        } else {
          // Level 3 has no rows: its head (breadcrumb, facts) stays put.
          expect({ where, head: focused.slice(0, 2) }).toEqual({ where, head: first.slice(0, 2) })
        }

        for (const _ of path) {
          await ui.press({ key: 'back' })
        }
        await ui.unmount()
      }
    }
  })
}
