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
  /** The line under the breadcrumb, such as "12 items · largest first". */
  facts: string
  /** The count that line states. */
  count: number
  header: string
  /** The item rows, in order. */
  rows: string[]
  /** The controls: the last block of lines, which wraps at a narrow pane, joined. */
  keys: string
}

/** Reads a flattened level 2. Throws with the lines when the shape is not there. */
export function level2(lines: readonly string[]): Level2 {
  const crumb = /^Context › █+ (.+?) {2}(\S+) · (\S+) of used$/.exec(lines[0] ?? '')
  const facts = lines[1] ?? ''
  const count = /^(\d+) items?\b/.exec(facts)
  const headerAt = lines.findIndex((line, k) => k > 1 && /% of segment$/.test(line))
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
    facts,
    count: Number(count[1]),
    header: lines[headerAt]!,
    rows,
    keys: lines.slice(lines.lastIndexOf('') + 1).join(' '),
  }
}

export type Level3 = {
  crumb: string
  /** The line of facts: "19k tokens · raw · as loaded". */
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

/** The facts line of a level 3, in parts. */
export function factsOf(facts: string): { tokens: string; form: string; source: string } | undefined {
  const match = /^(\S+) tokens · (raw|formatted) · (as loaded|on disk)\b/.exec(facts)

  return match === null ? undefined : { tokens: match[1]!, form: match[2]!, source: match[3]! }
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
