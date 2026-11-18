import { expect, test } from 'claude-code/testing'

import {
  END_SCROLL,
  SCROLL_DOWN,
  SCROLL_UP,
  STEP_SCROLL,
  TOP_SCROLL,
  atNewTop,
  createLane,
  createPaneScroll,
  createSteps,
  crossDelta,
  crossScroll,
  crossingOf,
  heldOffset,
  learnLink,
  needsRetry,
  shareAcross,
  shareOf,
  stepAnswer,
  stepOf,
  stepOffset,
} from '../hooks/scroll'

/** A `$.ui.scroll` to `start` resolved over a window standing at `standing`. */
const toStart = (standing: number, contentRows = 40, bodyRows = 10) => ({ offset: 0, by: -standing, bodyRows, contentRows })

test('j steps down, k up, any other key not at all', () => {
  expect(stepOf(SCROLL_DOWN)).toBe(1)
  expect(stepOf(SCROLL_UP)).toBe(-1)
  expect(stepOf('close')).toBe(0)
  // A step asks for the pane's start; the hook moves it from there.
  expect(STEP_SCROLL).toEqual({ in: 'context-breakdown', to: 'start' })
  // A page, view or level change asks for the top of the pane.
  expect(TOP_SCROLL).toEqual({ in: 'context-breakdown', to: 'start' })
})

test('a step moves one row from where the window stands', () => {
  expect(stepOffset(toStart(5), 1)).toBe(6)
  expect(stepOffset(toStart(5), -1)).toBe(4)
  // The engine's own window counts, not a remembered one: after the wheel
  // moved it to 17, the next j lands on 18.
  expect(stepOffset({ offset: 0, by: -17, bodyRows: 10, contentRows: 40 }, 1)).toBe(18)
})

test('k at the top and j at the bottom do nothing', () => {
  expect(stepOffset(toStart(0), -1)).toBe(0)
  expect(stepOffset(toStart(30), 1)).toBe(30)
  // A tree that fits never moves.
  expect(stepOffset(toStart(0, 8, 10), 1)).toBe(0)
  // A tree that shrank under the window lands at its new last row.
  expect(stepOffset(toStart(30, 20, 10), -1)).toBe(10)
})

test('a scroll of ours without a step passes on as resolved, so the top after a page change holds', () => {
  const ours = { ...toStart(12), origin: { kind: 'plugin' as const, name: 'context-breakdown' } }
  expect(stepAnswer(ours, 'context-breakdown', createSteps())).toBeNull()
})

test('a failed hook keeps a scroll of ours where the window stands, and moves any other as resolved', () => {
  const ours = { ...toStart(12), origin: { kind: 'plugin' as const, name: 'context-breakdown' } }
  const person = { offset: 15, by: 3, bodyRows: 10, contentRows: 40, origin: { kind: 'person' as const } }
  expect(heldOffset(ours, 'context-breakdown')).toBe(12)
  expect(heldOffset(person, 'context-breakdown')).toBe(15)
})

test('the lane runs presses one after the other and drops one past its depth', async () => {
  const lane = createLane(2)
  const order: string[] = []
  let release = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const first = lane.run(async () => {
    order.push('first starts')
    await gate
    order.push('first ends')

    return 1
  })
  const second = lane.run(async () => {
    order.push('second starts')

    return 2
  })
  // One running, one waiting: a third is dropped, not queued.
  expect(await lane.run(async () => 3)).toBeNull()
  release()
  expect(await first).toEqual({ value: 1 })
  expect(await second).toEqual({ value: 2 })
  expect(order).toEqual(['first starts', 'first ends', 'second starts'])
  // Free again, and a failed press does not stop the next.
  await expect(lane.run(async () => Promise.reject(new Error('refused')))).rejects.toThrow('refused')
  expect(await lane.run(async () => 4)).toEqual({ value: 4 })
})

test('many presses add up row by row, with no drift', () => {
  let standing = 0
  for (let k = 0; k < 50; k += 1) {
    standing = stepOffset(toStart(standing), 1)
  }
  expect(standing).toBe(30)
  for (let k = 0; k < 7; k += 1) {
    standing = stepOffset(toStart(standing), -1)
  }
  expect(standing).toBe(23)
})

test('steps queue oldest first, and a settled press leaves none behind', () => {
  const steps = createSteps()
  const down = steps.push(1)
  const up = steps.push(-1)
  expect(steps.take()).toBe(down)
  // The first press settles after its scroll took its step: nothing to drop.
  steps.drop(down)
  expect(steps.size()).toBe(1)
  // The second press's call was refused before a scroll: its step goes.
  steps.drop(up)
  expect(steps.size()).toBe(0)
  expect(steps.take()).toBeUndefined()
})

test('only a scroll this plugin asked for is moved', () => {
  const steps = createSteps()
  steps.push(1)
  const person = { ...toStart(5), origin: { kind: 'person' as const } }
  const other = { ...toStart(5), origin: { kind: 'plugin' as const, name: 'another' } }
  const ours = { ...toStart(5), origin: { kind: 'plugin' as const, name: 'context-breakdown' } }
  expect(stepAnswer(person, 'context-breakdown', steps)).toBeNull()
  expect(stepAnswer(other, 'context-breakdown', steps)).toBeNull()
  // The person's and the other plugin's scrolls left the step for ours.
  expect(stepAnswer(ours, 'context-breakdown', steps)).toBe(6)
  // The step is used up: the next scroll of ours passes on as resolved.
  expect(stepAnswer(ours, 'context-breakdown', steps)).toBeNull()
})

const oursAt = (standing: number, contentRows = 40, bodyRows = 10) => ({
  ...toStart(standing, contentRows, bodyRows),
  origin: { kind: 'plugin' as const, name: 'context-breakdown' },
})

test('a step at the bottom asks for the next page, at the top for the previous one', () => {
  expect(crossingOf(toStart(30), 1)).toBe('next')
  expect(crossingOf(toStart(29), 1)).toBeNull()
  expect(crossingOf(toStart(0), -1)).toBe('prev')
  expect(crossingOf(toStart(1), -1)).toBeNull()
  // A tree that fits whole: j and k cross at once.
  expect(crossingOf(toStart(0, 8, 10), 1)).toBe('next')
  expect(crossingOf(toStart(0, 8, 10), -1)).toBe('prev')
  // A tree that shrank under the window counts as the bottom.
  expect(crossingOf(toStart(30, 20, 10), 1)).toBe('next')

  // The hook marks the token: seen, and where it crosses; the window stays.
  const steps = createSteps()
  const down = steps.push(1)
  expect(stepAnswer(oursAt(30), 'context-breakdown', steps)).toBe(30)
  expect(down).toMatchObject({ seen: true, cross: 'next' })
  const up = steps.push(-1)
  expect(stepAnswer(oursAt(12), 'context-breakdown', steps)).toBe(11)
  expect(up).toMatchObject({ seen: true, cross: null })
})

test('a probe is marked seen and goes where the engine resolved it', () => {
  const steps = createSteps()
  const probe = steps.push(0, 'probe')
  expect(stepAnswer(oursAt(12), 'context-breakdown', steps)).toBeNull()
  expect(probe).toMatchObject({ seen: true, cross: null })
})

test('the link is proven by a seen token, disproven by an unseen scroll that had to move the window', () => {
  const seen = { ...createSteps().push(1), seen: true }
  const unseen = createSteps().push(1)
  expect(learnLink('unknown', seen, {}, 0)).toBe('works')
  expect(learnLink('unknown', seen, null, 7)).toBe('works')
  // A step to `start` from row 7 answered `{}` unseen: the window jumped.
  expect(learnLink('unknown', unseen, {}, 7)).toBe('absent')
  expect(learnLink('unknown', createSteps().push(0, 'measure'), {}, 7)).toBe('absent')
  // A refused or failed call says nothing.
  expect(learnLink('unknown', unseen, { deny: 'no-surface' }, 7)).toBe('unknown')
  expect(learnLink('works', unseen, null, 7)).toBe('works')
  // A proven link stays: on the desktop a quick press can find the engine's
  // window behind, and `start` then moves nothing.
  expect(learnLink('works', unseen, {}, 7)).toBe('works')
  expect(learnLink('works', createSteps().push(0, 'measure'), {}, 7)).toBe('works')
  // The bottom of the pane, for k into the previous page.
  expect(END_SCROLL).toEqual({ in: 'context-breakdown', to: 'end' })
})

test('an unseen `{}` that did not have to move the window leaves the link unknown', () => {
  // The /ctx probe to the top of a fresh pane: the engine may answer `{}`
  // without raising the event, so it is no evidence, wherever the window stood.
  const probe = createSteps().push(0, 'probe')
  expect(learnLink('unknown', probe, {}, 0)).toBe('unknown')
  expect(learnLink('unknown', probe, {}, 12)).toBe('unknown')
  // A step while the window already stood at the top: `start` moved nothing.
  expect(learnLink('unknown', createSteps().push(1), {}, 0)).toBe('unknown')
  expect(learnLink('works', createSteps().push(-1), {}, 0)).toBe('works')
})

test('a measure reads the window as a share and leaves it; a place puts it at a share of the tree', () => {
  // 40 rows in a 10-row window: the last offset is 30.
  expect(shareOf(toStart(0))).toBe(0)
  expect(shareOf(toStart(15))).toBe(0.5)
  expect(shareOf(toStart(30))).toBe(1)
  // A tree that fits is at its top.
  expect(shareOf(toStart(0, 8, 10))).toBe(0)

  const steps = createSteps()
  const measure = steps.push(0, 'measure')
  expect(stepAnswer(oursAt(24), 'context-breakdown', steps)).toBe(24)
  expect(measure).toMatchObject({ seen: true, share: 0.8, cross: null })
  // The other view's tree, 110 rows in the same window: 0.8 of its last offset (100).
  const place = steps.push(0, 'place', 0.8)
  expect(stepAnswer(oursAt(24, 110, 10), 'context-breakdown', steps)).toBe(80)
  expect(place.seen).toBe(true)
  // Drawn into a tree that fits, it stays at the top.
  steps.push(0, 'place', 0.8)
  expect(stepAnswer(oursAt(0, 8, 10), 'context-breakdown', steps)).toBe(0)
})

test('a switch of view keeps the line: the same share on one page, the share of that line on another page', () => {
  // One page in both views (a 300-line file): the window keeps its share.
  expect(shareAcross({ firstLine: 1, lastLine: 300 }, 0.75, { firstLine: 1, lastLine: 300 })).toBe(0.75)
  // Line 951 of raw page 2 (501-1,001) lies at half of a formatted page 701-1,201.
  expect(shareAcross({ firstLine: 501, lastLine: 1001 }, 0.9, { firstLine: 701, lastLine: 1201 })).toBe(0.5)
  // Outside the new page it clamps; a page of one line is at its top.
  expect(shareAcross({ firstLine: 1, lastLine: 500 }, 1, { firstLine: 1, lastLine: 300 })).toBe(1)
  expect(shareAcross({ firstLine: 1, lastLine: 500 }, 0, { firstLine: 100, lastLine: 300 })).toBe(0)
  expect(shareAcross({ firstLine: 1, lastLine: 500 }, 0.5, { firstLine: 7, lastLine: 7 })).toBe(0)
})

test('a crossing opens the next page at its top and the previous page at its bottom, and stops at the ends', () => {
  expect(crossDelta('next', 0, 3)).toBe(1)
  expect(crossDelta('prev', 1, 3)).toBe(-1)
  expect(crossDelta('next', 2, 3)).toBe(0)
  expect(crossDelta('prev', 0, 3)).toBe(0)
  expect(crossDelta('next', 0, 1)).toBe(0)
  expect(crossDelta(null, 1, 3)).toBe(0)
  expect(crossScroll(1)).toBe(TOP_SCROLL)
  expect(crossScroll(-1)).toBe(END_SCROLL)
})

test('a step starts where the event says the window stands, also after the window moved without a scroll event', () => {
  const steps = createSteps()
  steps.push(1)
  expect(stepAnswer(oursAt(5), 'context-breakdown', steps)).toBe(6)
  // A Tab, a refresh or a resize put the window back at 5 and raised no
  // `ui.scroll`: the next step goes from 5, not from the last target.
  const next = steps.push(1)
  expect(stepAnswer(oursAt(5), 'context-breakdown', steps)).toBe(6)
  // The crossing is read from the same row: 29 of 30 is not the bottom.
  steps.push(1)
  expect(stepAnswer(oursAt(29), 'context-breakdown', steps)).toBe(30)
  const last = steps.push(1)
  expect(stepAnswer(oursAt(29), 'context-breakdown', steps)).toBe(30)
  expect(last.cross).toBeNull()
  expect(next.cross).toBeNull()
})

test('an unseen step the engine answered {} asks once more, unless the link is absent', () => {
  const unseen = createSteps().push(1)
  const seen = { ...createSteps().push(1), seen: true }
  expect(needsRetry(unseen, {}, 'works')).toBe(true)
  expect(needsRetry(createSteps().push(-1), {}, 'works')).toBe(true)
  // A link not known yet: at row 0 a step cannot prove it, so the retry does.
  expect(needsRetry(unseen, {}, 'unknown')).toBe(true)
  // The hook saw it: it moved.
  expect(needsRetry(seen, {}, 'works')).toBe(false)
  expect(needsRetry(seen, {}, 'unknown')).toBe(false)
  // Refused or failed: nothing to retry.
  expect(needsRetry(unseen, { deny: 'the window moved meanwhile' }, 'works')).toBe(false)
  expect(needsRetry(unseen, null, 'unknown')).toBe(false)
  // Without the hook, `end` would jump to the bottom.
  expect(needsRetry(unseen, {}, 'absent')).toBe(false)
  // Only a j or k step.
  expect(needsRetry(createSteps().push(0, 'measure'), {}, 'works')).toBe(false)
  expect(needsRetry(createSteps().push(0, 'probe'), {}, 'unknown')).toBe(false)
})

test('the retry at the top of a new tree settles a link not known yet', () => {
  const steps = createSteps()
  const pane = createPaneScroll()
  // j at row 0: the engine stands at `start`, answers {} and raises nothing.
  const token = steps.push(1)
  pane.link = learnLink(pane.link, token, {}, pane.shown)
  expect(pane.link).toBe('unknown')
  expect(needsRetry(token, {}, pane.link)).toBe(true)
  // The retry to `end` reaches the hook: the link works, and the step moves one row.
  const retry = steps.push(1)
  steps.drop(token)
  const toEnd = { offset: 30, by: 30, bodyRows: 10, contentRows: 40, origin: { kind: 'plugin' as const, name: 'context-breakdown' } }
  expect(stepAnswer(toEnd, 'context-breakdown', steps)).toBe(1)
  expect(learnLink(pane.link, retry, {}, pane.shown)).toBe('works')
  // Unseen and answered {} from the top: a tree that fits has its end there, so nothing is known.
  expect(learnLink('unknown', createSteps().push(1), {}, 0)).toBe('unknown')
  // Without the hook the retry jumped the window to the end: the next step,
  // unseen and answered {} from there, finds the link absent.
  expect(learnLink('unknown', createSteps().push(1), {}, 40)).toBe('absent')
})

test('a new tree from its top keeps a proven link, so j at its top still asks again for the end', () => {
  const steps = createSteps()
  const pane = createPaneScroll()
  pane.link = 'works'
  pane.shown = 8
  atNewTop(pane)
  expect(pane).toEqual({ link: 'works', shown: 0 })
  // j at the top: the engine already stands at `start`, answers {} and raises nothing.
  const token = steps.push(1)
  pane.link = learnLink(pane.link, token, {}, pane.shown)
  expect(pane.link).toBe('works')
  expect(needsRetry(token, {}, pane.link)).toBe(true)
})

test('a quick press on a new tree before its drawing does not read the old offset and find the link absent', () => {
  const steps = createSteps()
  const pane = createPaneScroll()
  // The old tree's window stood at 8; the link is not known yet.
  pane.shown = 8
  atNewTop(pane)
  // j at once: the engine stands at the new top, answers {} and raises nothing.
  pane.link = learnLink(pane.link, steps.push(1), {}, pane.shown)
  expect(pane.link).toBe('unknown')
})
