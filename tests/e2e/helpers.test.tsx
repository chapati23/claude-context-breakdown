// The e2e helpers themselves: flatten on small trees made by hand, and the
// acts on a real pane.

import type { RenderNode } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { chat, columnsOf, flatten, flattenAll, hold, hotkey, hotkeysOf, litRow, mountPane, ringOf, ringWrites, rowsOf, session, setFocus, tap } from './helpers'
import type { PaneUi } from './helpers'
import { PANE } from '../fixtures'

/** A tree made by hand; a Button's `press` is left out, as flatten never reads it. */
const tree = (node: unknown) => node as RenderNode

const text = (props: Record<string, unknown>, ...children: unknown[]) => ({ type: 'Text', props, children })
const box = (props: Record<string, unknown>, ...children: unknown[]) => ({ type: 'Box', props, children })

describe('flatten', () => {
  test('a row joins left to right by cells, a column stacks, margins add lines', () => {
    const drawn = box(
      { flexDirection: 'column' },
      text({}, 'head'),
      box({ marginTop: 1 }, text({}, '日本'), text({}, '|'), box({ width: 4 }, text({}, 'x')), text({}, 'end')),
      box({ columnGap: 2 }, text({}, 'a'), text({}, 'b')),
    )
    expect(flatten(tree(drawn))).toEqual(['head', '', '日本|x   end', 'a  b'])
    expect(columnsOf('日本|x   end', '|', 'end')).toEqual([4, 9])
    expect(columnsOf('abc', 'z', 'a')).toEqual([-1, -1])
  })

  test('a numeric width cuts, and a wide character never splits', () => {
    expect(flatten(tree(box({ width: 3 }, text({}, '日本'))))).toEqual(['日'])
  })

  test('a row with flexWrap breaks at the columns given, and only then', () => {
    const drawn = box({ flexWrap: 'wrap', columnGap: 2 }, text({}, 'aaaa'), text({}, 'bbbb'), text({}, 'cc'))
    expect(flatten(tree(drawn), { columns: 10 })).toEqual(['aaaa  bbbb', 'cc'])
    expect(flatten(tree(drawn))).toEqual(['aaaa  bbbb  cc'])
  })

  test('a placed Box goes to the overlay; Code, Markdown, Svg and Client print their text', () => {
    const drawn = box(
      { flexDirection: 'column' },
      { type: 'Code', props: { source: 'one\ntwo' } },
      { type: 'Markdown', props: { text: '# Title' } },
      { type: 'Svg', props: { source: '<svg/>' } },
      { type: 'Client', props: { key: 'bar', module: './m.tsx', props: { runs: [{ text: '██' }, { text: ' 40%' }] } } },
      box({ position: 'absolute', top: 1, left: 5 }, text({}, 'chip')),
    )
    expect(flattenAll(tree(drawn))).toEqual({ lines: ['one', 'two', '# Title', '<svg>', '██ 40%'], overlay: ['@1,5: chip'] })
  })

  test('a run in the colour of an off control gets its own marks', () => {
    const drawn = box(
      {},
      { type: 'Button', props: { key: 'b', label: 'Back', hotkey: 'b', plain: true }, children: [text({ color: 'subtle' }, 'Back')] },
      text({}, '  '),
      { type: 'Button', props: { key: 'x', label: 'Close', hotkey: 'x', plain: true, dimColor: true, autoFocus: true } },
      text({ color: '#ff0000' }, ' red'),
    )
    expect(flatten(tree(drawn))).toEqual(['b: Back  x: Close red'])
    expect(flatten(tree(drawn), { marks: true })).toEqual(['b: ⟪Back⟫  ⟦⟨x: Close⟩⟧ red'])
  })

  test('a Button prints its children after its hotkey; marks show the ring and dim parts', () => {
    const drawn = box(
      { flexDirection: 'column' },
      { type: 'Button', props: { key: 'a', label: 'Alpha', hotkey: '1', plain: true, autoFocus: true }, children: ['Al', text({ dimColor: true }, 'pha')] },
      { type: 'Button', props: { key: 'b', label: 'Beta', plain: true, dimColor: true } },
    )
    expect(flatten(tree(drawn))).toEqual(['1: Alpha', 'Beta'])
    expect(flatten(tree(drawn), { marks: true })).toEqual(['⟦1: Al⟨pha⟩⟧', '⟨Beta⟩'])
    // A desktop draws the label alone, after a key cap for the hotkey, which `h: ` stands for.
    expect(flatten(tree(drawn), { surface: 'desktop' })).toEqual(['1: Alpha', 'Beta'])
  })
})

describe('acts on the pane', () => {
  test('hotkey presses only a drawn hotkey; setFocus gives and takes the keyboard', async ($, on) => {
    const ring = ringWrites(on)
    await session($, on, chat())
    const ui = await mountPane($, 'terminal', { columns: 88 })

    // Without the keyboard no row has a hotkey: nothing happens.
    const before = flatten(await ui.drawn())
    expect(await hotkey(ui, '7')).toBe(false)
    expect(flatten(await ui.drawn())).toEqual(before)
    expect(before).toContain('For keys: click the pane, or run /ctx')

    await setFocus(ui, true)
    expect(flatten(await ui.drawn())).not.toContain('For keys: click the pane, or run /ctx')
    expect(await ringOf(ui)).toBe('row-system')
    const row = (await ui.findAll({ type: 'Button' })).find(button => button.key === 'row-tool-results')
    expect(await hotkey(ui, String(row?.props.hotkey))).toBe(true)
    expect(await ringOf(ui)).toBe('item-r:tu2')

    // The pane's j steps, one press each, while it is drawn. Tool results
    // has two items on one page: the first j puts the ring on the second,
    // and the next two stop there, at the end of the list.
    const items = await rowsOf(ui)
    expect(items).toHaveLength(2)
    ring.length = 0
    expect(await hold(ui, 'j', 3)).toBe(3)
    expect(ring).toEqual([items[1]])
    expect(await litRow(ui)).toBe(items[1])
    const lines = await tap(ui, 'back')
    expect(lines[0]).toMatch(/used/)
    expect(await ringOf(ui)).toBe('row-tool-results')

    await setFocus(ui, false)
    expect(await hold(ui, 'j', 3)).toBe(0)
    await ui.unmount()
  })

  test('on a desktop a drawn hotkey presses nothing while the pane does not hold the keyboard', async ($, on) => {
    const w = await session($, on, chat())
    const ui = await mountPane($, 'desktop', { columns: 88 })
    // The desktop draws the controls' hotkeys without the keyboard too, as
    // key caps. Its rows have none: a click or Enter opens them.
    const row = (await ui.findAll({ type: 'Button' })).find(button => button.key === 'row-tool-results')
    expect(row?.props.hotkey).toBeUndefined()
    const before = flatten(await ui.drawn(), { surface: 'desktop' })
    // The desktop draws no j: a drawn control's key stands in for it.
    expect((await ui.find({ key: 'refresh' }))?.props.hotkey).toBe('r')
    const calls = w.usageCalls
    expect(await hold(ui, 'r', 3)).toBe(0)
    expect(w.usageCalls).toBe(calls)
    expect(flatten(await ui.drawn(), { surface: 'desktop' })).toEqual(before)

    // With the keyboard the same key presses the control; a redraw that takes it away stops it again.
    await setFocus(ui, true)
    expect(await hotkey(ui, 'r')).toBe(true)
    expect(w.usageCalls).toBeGreaterThan(calls)
    await ui.redraw({ ...PANE.props, bodyColumns: 88 })
    expect(await hotkey(ui, 'r')).toBe(false)
    await ui.unmount()
  })

  test('hotkey refuses a key two Buttons hold, as the engine would press only one', async ($, on) => {
    await session($, on, chat())
    const ui = await mountPane($, 'terminal', { columns: 88, isFocused: true })
    const keys = await hotkeysOf(ui)
    expect(new Set(keys).size).toBe(keys.length)
    // A drawing made by hand: two Buttons with the hotkey j.
    const twice: PaneUi = {
      ...ui,
      findAll: async () => [
        { key: 'list-down', props: { hotkey: 'j' } },
        { key: 'scroll-down', props: { hotkey: 'j' } },
      ],
    }
    let error = ''
    await hotkey(twice, 'j').catch((e: unknown) => {
      error = String(e)
    })
    expect(error).toContain('hotkey j is held by 2 Buttons: list-down, scroll-down')
    await ui.unmount()
  })
})
