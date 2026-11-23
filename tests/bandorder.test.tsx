import { expect, test } from 'claude-code/testing'

import { BAND, SURFACES, world } from './fixtures'

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }

const isNode = (x: unknown): x is Node => typeof x === 'object' && x !== null && 'type' in x
const textOf = (x: unknown): string =>
  typeof x === 'string' ? x : isNode(x) ? (x.children ?? []).map(textOf).join('') : ''

const ROW = (plugin: string, text: string) => ({
  plugin,
  tree: { type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: [text] }] },
})

/** The band's arrangement of `rows`, as the engine asks for it. */
const list = (surface: (typeof SURFACES)[number], rows: ReturnType<typeof ROW>[]) => ({
  plugin: 'context-breakdown',
  surface,
  component: 'AbovePromptList',
  requestId: 'band',
  props: { ...BAND.props, rows },
}) as const

test('the bar is the band row right above the prompt', async ($, on) => {
  world(on)
  for (const surface of SURFACES) {
    const rows = [ROW('context-breakdown', 'BAR'), ROW('notes', 'NOTES'), ROW('tips', 'TIPS')]
    const ui = await $.ui.mount(list(surface, rows) as never)
    const text = textOf(await ui.drawn())

    expect(text.indexOf('NOTES')).toBeLessThan(text.indexOf('TIPS'))
    expect(text.indexOf('TIPS')).toBeLessThan(text.indexOf('BAR'))
    await ui.unmount()
  }
})

test('the bar alone in the band keeps a blank row above it', async ($, on) => {
  world(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(list(surface, [ROW('context-breakdown', 'BAR')]) as never)
    const tree = (await ui.drawn()) as Node

    expect(tree.props?.paddingTop).toBe(1)
    expect(textOf(tree)).toBe('BAR')
    await ui.unmount()
  }
})

test('a band without the bar keeps its rows and adds no blank row', async ($, on) => {
  world(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(list(surface, [ROW('notes', 'NOTES'), ROW('tips', 'TIPS')]) as never)
    const tree = (await ui.drawn()) as Node
    const text = textOf(tree)

    expect(text.indexOf('NOTES')).toBeLessThan(text.indexOf('TIPS'))
    expect(tree.props?.paddingTop).toBeUndefined()
    await ui.unmount()
  }
})
