import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { CODE_LINE_CHARS, PAGE_CHARS, TREE_CHARS } from '../hooks/text'
import { FOCUSED_PANE, SURFACES, richUsage, world } from './fixtures'

// The level-3 page budget against the engine's limits: a tree draws its
// first TREE_CHARS characters, and the pane draws again on every scroll move.

const START = { cwd: '/home/user/project', surface: 'terminal', isInteractive: true } as const

/** One line longer than two pages: the raw view's largest page is PAGE_CHARS. */
const ONE_LINE = 'x'.repeat(PAGE_CHARS * 2 + 500)
/** A table whose rows are never cut: the formatted view's largest page, a head and one row. */
const TABLE = [
  `| ${'h'.repeat(4000)} | b |`,
  '| --- | --- |',
  ...Array.from({ length: 3 }, (_, i) => `| ${'v'.repeat(PAGE_CHARS - 1000)} | ${i} |`),
].join('\n')

const MESSAGES = [
  { role: 'user', content: [{ type: 'text', text: TABLE }] },
  { role: 'assistant', content: [{ type: 'tool_use', id: 'big', name: 'Bash', input: { command: 'yes' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'big', content: ONE_LINE }] },
]

async function budgetWorld($: Engine, on: On) {
  const w = world(on)
  w.usage = richUsage()
  w.messages = MESSAGES
  await $.session.start(START)
  await w.clock.advance(0)
}

/** Every character a drawn tree holds in its texts: children, labels, Markdown texts, Code sources. */
function treeChars(node: unknown): number {
  if (typeof node === 'string') {
    return node.length
  }
  if (node === null || typeof node !== 'object') {
    return 0
  }
  const { props = {}, children = [] } = node as { props?: Record<string, unknown>; children?: unknown[] }
  let count = 0
  for (const key of ['label', 'text', 'source', 'alt', 'value']) {
    const value = props[key]
    count += typeof value === 'string' ? value.length : 0
  }

  return count + children.reduce<number>((sum, child) => sum + treeChars(child), 0)
}

type Ui = Mounted<(typeof SURFACES)[number], 'Pane'>

/** Opens the first item of a segment. */
async function openFirst(ui: Ui, segment: string) {
  await ui.press({ key: segment })
  const key = (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').find(one => one.startsWith('item-'))
  await ui.press({ key: key! })
}

/** The mean time of one redraw, as a scroll move asks for one. */
async function redrawMs(ui: Ui): Promise<number> {
  const runs = 20
  const start = performance.now()
  for (let i = 0; i < runs; i += 1) {
    await ui.redraw({ ...FOCUSED_PANE.props, scroll: { offset: i, bodyRows: 66 } })
  }

  return (performance.now() - start) / runs
}

test('the largest raw page stays inside a tree, whole, and redraws cheaply', async ($, on) => {
  await budgetWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await openFirst(ui, 'row-tool-results')
    // The one long line is split into pieces the Code element draws whole.
    const pieces = (await ui.findAll({ type: 'Code' })).map(code => String(code.props.source))
    expect(pieces.join('').length).toBe(PAGE_CHARS)
    expect(pieces.every(piece => piece.length <= CODE_LINE_CHARS)).toBe(true)
    expect(treeChars(await ui.drawn())).toBeLessThan(TREE_CHARS)
    // Measured about 1 ms in the kit; the bound only catches a large regression.
    expect(await redrawMs(ui)).toBeLessThan(50)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the largest formatted page stays inside a tree, whole, and redraws cheaply', async ($, on) => {
  await budgetWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await openFirst(ui, 'row-prompts')
    await ui.press({ key: 'next' })
    const page = String((await ui.find({ type: 'Markdown' }))?.props.text)
    // The head and one whole row: past PAGE_CHARS, as a row is never cut.
    expect(page.length).toBeGreaterThan(PAGE_CHARS)
    expect(page.startsWith('| hhhh')).toBe(true)
    expect(page.endsWith(' | 0 |')).toBe(true)
    expect(treeChars(await ui.drawn())).toBeLessThan(TREE_CHARS)
    expect(await redrawMs(ui)).toBeLessThan(50)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})
