import { expect, test } from 'claude-code/testing'

import type { ContextBreakdownList, ContextBreakdownSnapshot, ContextBreakdownView } from '../types'
import { ARROWS_MOVE_RING, arrowStep, createRingMoves, notesRing, pagesOf, ringTarget, rowKeys } from '../hooks/ring'

const KEYS = ['row-a', 'row-b', 'row-c']

/** Waits `ms` on the host's clock (the types of this mod declare no timers). */
function wait(ms: number): Promise<void> {
  const host = globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown }

  return new Promise(resolve => void host.setTimeout(resolve, ms))
}

test('rowKeys: the rows that open, in drawing order; none at level 3', () => {
  const segment = (id: string, tokens: number) => ({ id, tokens }) as never
  const snapshot = {
    baseline: [segment('system', 10), segment('mcp', 0)],
    conversation: [segment('tool-results', 30), segment('prompts', 5)],
  } as unknown as ContextBreakdownSnapshot
  const level1: ContextBreakdownView = { seq: 0, gen: 0, level: 1 }
  // Baseline first, then the conversation, as the pane draws them; a row of 0 tokens is not drawn.
  expect(rowKeys(level1, snapshot)).toEqual(['row-system', 'row-tool-results', 'row-prompts'])
  expect(rowKeys(level1, null)).toEqual([])

  const row = (id: string, isOpenable = true) => ({ id, title: id, detail: '', pathIn: null, tokens: 1, isOpenable })
  const list = { rows: [row('a'), row('b', false), row('c')], page: 1, pages: 3 } as unknown as ContextBreakdownList
  const level2: ContextBreakdownView = { seq: 1, gen: 0, level: 2, list }
  expect(rowKeys(level2, snapshot)).toEqual(['item-a', 'item-c'])
  expect(pagesOf(level2)).toEqual({ prev: true, next: true })
  expect(pagesOf({ ...level2, list: { ...list, page: 0, pages: 1 } })).toEqual({ prev: false, next: false })
  expect(pagesOf(level1)).toEqual({ prev: false, next: false })
  const level3 = { seq: 2, gen: 0, level: 3, list, item: {} } as unknown as ContextBreakdownView
  expect(rowKeys(level3, snapshot)).toEqual([])
})

test('ringTarget: one row down or up, from no row to the first or the last', () => {
  expect(ringTarget(KEYS, 'row-a', 1)).toEqual({ key: 'row-b' })
  expect(ringTarget(KEYS, 'row-c', -1)).toEqual({ key: 'row-b' })
  // On a control, on the close mark, or nowhere: j goes to the first row, k to the last.
  for (const current of ['back', '', null]) {
    expect(ringTarget(KEYS, current, 1)).toEqual({ key: 'row-a' })
    expect(ringTarget(KEYS, current, -1)).toEqual({ key: 'row-c' })
  }
  expect(ringTarget([], 'row-a', 1)).toBeNull()
  expect(ringTarget(KEYS, 'row-a', 0)).toBeNull()
})

test('ringTarget: the ends stop, unless the list has a page that way', () => {
  // Level 1, and a list of one page: the ring stays.
  expect(ringTarget(KEYS, 'row-c', 1)).toBeNull()
  expect(ringTarget(KEYS, 'row-a', -1)).toBeNull()
  // Level 2 with pages: past the last row the next page, before the first the previous one.
  expect(ringTarget(KEYS, 'row-c', 1, { prev: false, next: true })).toEqual({ page: 1 })
  expect(ringTarget(KEYS, 'row-a', -1, { prev: true, next: false })).toEqual({ page: -1 })
  // The first page has none before it, the last none after it.
  expect(ringTarget(KEYS, 'row-a', -1, { prev: false, next: true })).toBeNull()
  expect(ringTarget(KEYS, 'row-c', 1, { prev: true, next: false })).toBeNull()
  // Inside the page a page that way changes nothing.
  expect(ringTarget(KEYS, 'row-b', 1, { prev: true, next: true })).toEqual({ key: 'row-c' })
})

test('arrowStep: only an arrow at level 1 or 2 while the pane holds the keys moves the ring', () => {
  expect(ARROWS_MOVE_RING).toBe(true)
  const at = (level: 1 | 2 | 3, isFocused = true) => ({ isFocused, level })
  expect(arrowStep({ by: 1 }, at(1))).toBe(1)
  expect(arrowStep({ by: -1 }, at(2))).toBe(-1)
  // The wheel carries a pointer, even for one row.
  expect(arrowStep({ by: 1, pointer: { column: 3, row: 4 } }, at(1))).toBeNull()
  // A page key, Home or End moves more than one row; a scroll of nothing is not an arrow.
  expect(arrowStep({ by: 20 }, at(1))).toBeNull()
  expect(arrowStep({ by: -60 }, at(2))).toBeNull()
  expect(arrowStep({ by: 0 }, at(2))).toBeNull()
  // Level 3 scrolls; a pane without the keys too.
  expect(arrowStep({ by: 1 }, at(3))).toBeNull()
  expect(arrowStep({ by: 1 }, at(1, false))).toBeNull()
  // Turned off, the arrows scroll everywhere.
  expect(arrowStep({ by: 1 }, at(1), false)).toBeNull()
})

test('notesRing: the person always moves the record; this mod only while none of its moves is under way', () => {
  expect(notesRing({ kind: 'person' }, 'context-breakdown', true)).toBe(true)
  expect(notesRing({ kind: 'plugin', name: 'other-mod' }, 'context-breakdown', true)).toBe(true)
  expect(notesRing({ kind: 'plugin', name: 'context-breakdown' }, 'context-breakdown', false)).toBe(true)
  expect(notesRing({ kind: 'plugin', name: 'context-breakdown' }, 'context-breakdown', true)).toBe(false)
})

test('the presses run one after the other and none is dropped', async () => {
  const moves = createRingMoves()
  const order: number[] = []
  let release: () => void = () => undefined
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const first = moves.serial(async () => {
    await gate
    order.push(1)
  })
  const rest = [2, 3, 4, 5].map(n => moves.serial(async () => void order.push(n)))
  expect(moves.busy()).toBe(true)
  release()
  await Promise.all([first, ...rest])
  expect(order).toEqual([1, 2, 3, 4, 5])
  expect(moves.busy()).toBe(false)
  // A failed press does not stop the next one.
  await moves.serial(async () => Promise.reject(new Error('refused'))).catch(() => undefined)
  await moves.serial(async () => void order.push(6))
  expect(order.at(-1)).toBe(6)
})

test('five quick steps land on the fifth row and a step back on the fourth; the focus calls end on the last target', async () => {
  const moves = createRingMoves()
  const keys = ['row-1', 'row-2', 'row-3', 'row-4', 'row-5', 'row-6']
  const asked: string[] = []
  const answers: (() => void)[] = []
  // The engine answers each focus call late, while the presses go on.
  const apply = (key: string) =>
    new Promise<void>(resolve => {
      asked.push(key)
      answers.push(resolve)
    })
  const step = (n: number) =>
    moves.serial(async () => {
      const move = ringTarget(keys, moves.local() ?? null, n)
      if (move !== null && 'key' in move) {
        moves.set(move.key)
        void moves.focus(move.key, apply)
      }
    })

  // The ring on no row: the first j goes to the first row.
  await Promise.all([step(1), step(1), step(1), step(1), step(1)])
  expect(moves.local()).toBe('row-5')
  await step(-1)
  expect(moves.local()).toBe('row-4')
  // One call at a time: the first target is under way, the others wait, and
  // only the newest of them is asked for next.
  expect(asked).toEqual(['row-1'])
  expect(moves.busy()).toBe(true)
  answers.shift()!()
  await wait(0)
  expect(asked).toEqual(['row-1', 'row-4'])
  answers.shift()!()
  await wait(0)
  expect(asked).toEqual(['row-1', 'row-4'])
  expect(moves.busy()).toBe(false)
  // A new tree: the record is not known until the next event or move.
  moves.forget()
  expect(moves.local()).toBeUndefined()
})

test('a refused focus call does not stop the next one', async () => {
  const moves = createRingMoves()
  const asked: string[] = []
  await moves.focus('row-1', async key => {
    asked.push(key)
    throw new Error('no keyboard')
  })
  await moves.focus('row-2', async key => void asked.push(key))
  expect(asked).toEqual(['row-1', 'row-2'])
})

test('on the Down or Up control a step starts from the last row; on any other control from that control', () => {
  const moves = createRingMoves()
  expect(moves.from()).toBeUndefined()
  moves.set('row-b')
  // A click on Down or Up puts the ring on the control: the row stays the start.
  moves.set('list-down')
  expect(moves.local()).toBe('list-down')
  expect(moves.from()).toBe('row-b')
  moves.set('list-up')
  expect(moves.from()).toBe('row-b')
  expect(ringTarget(KEYS, moves.from() ?? null, 1)).toEqual({ key: 'row-c' })
  // Any other control: j to the first row, k to the last.
  moves.set('back')
  moves.set('list-down')
  expect(moves.from()).toBe('back')
  expect(ringTarget(KEYS, moves.from() ?? null, 1)).toEqual({ key: 'row-a' })
  moves.forget()
  moves.set('list-up')
  expect(moves.from()).toBeUndefined()
})

test('a focus call the engine refuses puts the record back, unless a later move changed it', async () => {
  const moves = createRingMoves()
  moves.set('row-a')
  const before = moves.mark()
  moves.set('row-b')
  let undone = 0
  await moves.focus(
    'row-b',
    async () => ({ deny: 'the pane does not hold the keyboard' }),
    () => {
      undone += 1
      moves.restore(before)
    },
  )
  expect(undone).toBe(1)
  expect(moves.local()).toBe('row-a')
  // Accepted: nothing is put back.
  moves.set('row-b')
  await moves.focus('row-b', async () => ({}), () => void (undone += 1))
  expect(undone).toBe(1)
  // A later move changed the record before the refusal came: it stays.
  let refuse: (answer: { deny?: string }) => void = () => undefined
  const late = moves.focus('row-c', () => new Promise(resolve => (refuse = resolve)), () => void (undone += 1))
  moves.set('row-a')
  refuse({ deny: 'another move came first' })
  await late
  expect(undone).toBe(1)
  expect(moves.local()).toBe('row-a')
})

test('a target that replaced a waiting one goes back to before both when it is refused', async () => {
  const moves = createRingMoves()
  const undone: string[] = []
  let release: () => void = () => undefined
  const first = moves.focus('row-a', () => new Promise<void>(resolve => (release = resolve)))
  void moves.focus('row-b', async () => ({}), () => void undone.push('before row-b'))
  moves.set('row-c')
  void moves.focus('row-c', async () => ({ deny: 'refused' }), () => void undone.push('before row-c'))
  release()
  await first
  expect(undone).toEqual(['before row-b'])
})
