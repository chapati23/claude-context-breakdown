import { expect, test } from 'claude-code/testing'

import { BAND, SURFACES, world } from './fixtures'

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }

const isNode = (x: unknown): x is Node => typeof x === 'object' && x !== null && 'type' in x
const textOf = (x: unknown): string =>
  typeof x === 'string' ? x : isNode(x) ? (x.children ?? []).map(textOf).join('') : ''

/** One plugin's row of the band, its text the row's name. */
const ROW = (plugin: string, text: string) => ({
  plugin,
  tree: { type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: [text] }] },
})

const NAMES = ['BAR', 'NOTES', 'TIPS'] as const

/** The names of the rows in a drawn band, in the order drawn. */
const order = (tree: unknown) => {
  const text = textOf(tree)

  return NAMES.filter(name => text.includes(name)).sort((a, b) => text.indexOf(a) - text.indexOf(b))
}

/** The band's arrangement of `rows`, as the engine asks for it. */
const list = (surface: (typeof SURFACES)[number], rows: ReturnType<typeof ROW>[], maxRows: number = BAND.props.maxRows) => ({
  plugin: 'context-breakdown',
  surface,
  component: 'AbovePromptList',
  requestId: 'band',
  props: { ...BAND.props, maxRows, rows },
}) as const

const bar = () => ROW('context-breakdown', 'BAR')
const others = () => [ROW('notes', 'NOTES'), ROW('tips', 'TIPS')]

test('the bar is the band row right above the prompt', async ($, on) => {
  world(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(list(surface, [bar(), ...others()]) as never)

    expect(order(await ui.drawn())).toEqual(['NOTES', 'TIPS', 'BAR'])
    await ui.unmount()
  }
})

test('the bar keeps its place when the rows do not all fit the band', async ($, on) => {
  world(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(list(surface, [bar(), ...others()], 2) as never)

    expect(order(await ui.drawn())).toEqual(['BAR', 'NOTES', 'TIPS'])
    await ui.unmount()
  }
})

test('the bar alone in the band keeps a blank row above it', async ($, on) => {
  world(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(list(surface, [bar()]) as never)
    const tree = (await ui.drawn()) as Node

    expect(tree.props?.paddingTop).toBe(1)
    expect(textOf(tree)).toBe('BAR')
    await ui.unmount()
  }
})

test('the bar alone in a band of one row has no blank row', async ($, on) => {
  world(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(list(surface, [bar()], 1) as never)
    const tree = (await ui.drawn()) as Node

    expect(tree.props?.paddingTop).toBeUndefined()
    expect(textOf(tree)).toBe('BAR')
    await ui.unmount()
  }
})

test('a band without the bar keeps its rows and adds no blank row', async ($, on) => {
  world(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(list(surface, others()) as never)
    const tree = (await ui.drawn()) as Node

    expect(order(tree)).toEqual(['NOTES', 'TIPS'])
    expect(tree.props?.paddingTop).toBeUndefined()
    await ui.unmount()
  }
})
