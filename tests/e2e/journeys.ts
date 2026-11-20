// Helpers shared by the journeys: read a flattened level 2 or level 3 into
// its parts, and look for text that should never reach a person's screen.
// They read what `flatten` gives, so they work on both surfaces.

import type { RenderNode } from 'claude-code'

import { cellWidth } from '../../hooks/text'
import type { PaneUi } from './helpers'

/** The keys of the Buttons whose key starts with `prefix`, in drawing order. */
export async function keysWith(ui: PaneUi, prefix: string): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' }))
    .map(button => button.key ?? '')
    .filter(key => key.startsWith(prefix))
}

/** The label of the Button keyed `key`. */
export async function labelOf(ui: PaneUi, key: string): Promise<string> {
  const button = (await ui.findAll({ type: 'Button' })).find(one => one.key === key)

  return String(button?.props.label ?? '')
}

/** The widest line, in cells. */
export function widest(lines: readonly string[]): number {
  return lines.reduce((max, line) => Math.max(max, cellWidth(line)), 0)
}

/** The longest line, in characters (code units): the unit the pane's code-line limit counts. */
export function longest(lines: readonly string[]): number {
  return lines.reduce((max, line) => Math.max(max, line.length), 0)
}

/** Tokens as a figure reads: 31k, 9.4k, 976. */
export function tokensOf(figure: string): number {
  const n = Number.parseFloat(figure.replace(/,/g, ''))

  return figure.endsWith('k') ? n * 1000 : n
}

/** The two figures that end a row: its tokens and its share. */
export function figuresOf(line: string): { tokens: string; share: string } | undefined {
  const match = /(?:^|\s)(\d[\d.,]*k?)\s+(\d[\d.]*%)$/.exec(line)

  return match === null ? undefined : { tokens: match[1]!, share: match[2]! }
}

export type Level2 = {
  /** The breadcrumb parts: the segment's name, tokens and share of used. */
  name: string
  tokens: string
  share: string
  /** The line under the breadcrumb: the segment's definition, "The output of tool calls, …". */
  definition: string
  /** The facts under the definition, such as "12 items · largest first", without the column name beside them. */
  facts: string
  /** The count that line states. */
  count: number
  /** The line that ends in the column name: the facts' own line when they share it. */
  header: string
  /** The item rows, in order. */
  rows: string[]
  /** The controls: the last block of lines, which wraps at a narrow pane, joined. */
  keys: string
}

/** Reads a flattened level 2. Throws with the lines when the shape is not there. */
export function level2(lines: readonly string[]): Level2 {
  const crumb = /^Context › █+ (.+?) {2}(\S+) · (\S+) of used$/.exec(lines[0] ?? '')
  // The definition takes the lines up to the facts: more than one where the terminal wraps it.
  const factsAt = Math.max(2, lines.findIndex((line, k) => k > 0 && /^\d+ items?\b/.test(line)))
  const definition = lines.slice(1, factsAt).join(' ')
  // The column name stands beside the facts where both fit on one row.
  const facts = (lines[factsAt] ?? '').replace(/ {2,}% of segment$/, '')
  const count = /^(\d+) items?\b/.exec(facts)
  const headerAt = lines.findIndex((line, k) => k >= factsAt && /% of segment$/.test(line))
  if (crumb === null || count === null || headerAt < 0) {
    throw new Error(`not a level 2:\n${lines.join('\n')}`)
  }
  const rows: string[] = []
  for (const line of lines.slice(headerAt + 1)) {
    // A blank line stands between the header and the rows, and after them.
    if (line === '' && rows.length > 0) {
      break
    }
    if (figuresOf(line) !== undefined) {
      rows.push(line)
    }
  }

  return {
    name: crumb[1]!,
    tokens: crumb[2]!,
    share: crumb[3]!,
    definition,
    facts,
    count: Number(count[1]),
    header: lines[headerAt]!,
    rows,
    keys: lines.slice(lines.lastIndexOf('') + 1).join(' '),
  }
}

/**
 * A flattened level 1 apart from the terminal's line that describes the row
 * with the focus ring: that line follows the ring, the rest of the drawing
 * does not. `described` holds its rows (with any marks), `table` the rest.
 * Off the terminal there is no such line: `described` is empty.
 */
export function levelOne(lines: readonly string[], surface: 'terminal' | 'desktop'): { table: string[]; described: string[] } {
  const at = lines.findIndex(line => line.includes('All numbers are estimates.'))
  if (surface !== 'terminal' || at < 4) {
    return { table: [...lines], described: [] }
  }

  return { table: [...lines.slice(0, at - 3), ...lines.slice(at - 1)], described: lines.slice(at - 3, at - 1) }
}

export type Level3 = {
  crumb: string
  /** The line of facts: "item 2 of 9 · 19k tokens · raw · as loaded". */
  facts: string
  /** Lines between the facts and the first blank line, such as a warning. */
  notes: string[]
  /** The control lines (they wrap at a narrow pane). */
  controls: string[]
  /** The text of the item, as drawn. */
  body: string[]
}

/** Reads a flattened level 3: three blocks, then the text. */
export function level3(lines: readonly string[]): Level3 {
  const first = lines.indexOf('')
  const second = first < 0 ? -1 : lines.indexOf('', first + 1)
  if (first < 2 || second < 0) {
    throw new Error(`not a level 3:\n${lines.slice(0, 12).join('\n')}`)
  }

  return {
    crumb: lines[0]!,
    facts: lines[1]!,
    notes: lines.slice(2, first),
    controls: lines.slice(first + 1, second),
    body: lines.slice(second + 1),
  }
}

/** The facts line of a level 3, in parts; `place` is the item's place in its list, "item 2 of 9", when the line has one. */
export function factsOf(
  facts: string,
): { place: string | undefined; tokens: string; form: string; source: string } | undefined {
  const match = /^(?:(item \d+ of \d+) · )?(\S+) tokens · (raw|formatted) · (as loaded|on disk)\b/.exec(facts)

  return match === null ? undefined : { place: match[1], tokens: match[2]!, form: match[3]!, source: match[4]! }
}

/**
 * Text that should never reach a screen: a missing value written out, a
 * replacement character, a half of a surrogate pair, a combining mark with
 * nothing to combine with. Returns the offending lines.
 */
export function badLines(lines: readonly string[]): string[] {
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
  const stray = /^[̀-ͯ]/

  return lines.filter(
    line =>
      /\bundefined\b|\[object |\bNaN\b|\bnull\b/.test(line) || line.includes('�') || lone.test(line) || stray.test(line),
  )
}

type Loose = { type?: string; props?: Record<string, unknown>; children?: readonly unknown[] }

/**
 * Every colour a drawing names (`color` or `backgroundColor`), including
 * those inside a Client's runs. A test reads which palette was used by it.
 */
export function colorsIn(tree: RenderNode): Set<string> {
  const out = new Set<string>()
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) {
      return
    }
    const loose = node as Loose
    for (const key of ['color', 'backgroundColor']) {
      const value = loose.props?.[key]
      if (typeof value === 'string') {
        out.add(value)
      }
    }
    const runs = (loose.props?.props as { runs?: { color?: unknown }[] } | undefined)?.runs
    for (const run of runs ?? []) {
      if (typeof run.color === 'string') {
        out.add(run.color)
      }
    }
    for (const child of loose.children ?? []) {
      walk(child)
    }
  }
  walk(tree)

  return out
}
