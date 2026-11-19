// Journey 3, a file read to the end: /ctx tool opens the Tool results, a Read
// result opens as loaded, the file changes in the world, the pane notices it,
// shows the file on disk, switches between formatted and raw, copies the path,
// mentions it in the prompt, and goes back and closes.

import { expect, test } from 'claude-code/testing'

import { NOTES } from '../fixtures'
import { chat, flatten, mountPane, ringOf, session, tap } from './helpers'
import { factsOf, keysWith, level2, level3 } from './journeys'

const SURFACES = ['terminal', 'desktop'] as const
const COLUMNS = 88

for (const surface of SURFACES) {
  test(`J3 ${surface}: a Read result as loaded, changed on disk, on disk, formatted, raw, copied, mentioned`, async ($, on) => {
    const w = await session($, on, chat())
    const opts = { surface, columns: COLUMNS } as const

    // /ctx with a word opens the pane on that segment and gives it the keyboard.
    await $.command.run({ command: 'ctx', args: 'tool', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
    expect(w.opened).toEqual(['context-breakdown'])
    expect(w.focused).toEqual([true])
    const ui = await mountPane($, surface, { columns: COLUMNS, isFocused: true })
    const two = level2(flatten(await ui.drawn(), opts))
    expect(two.name).toBe('Tool results')
    expect(two.rows.map(row => row.replace(/^\d: /, '').split(/\s{2,}/)[0])).toEqual(['Bash', 'Read'])
    expect(await keysWith(ui, 'item-')).toEqual(['item-r:tu2', 'item-r:tu1'])

    // The Read result as the conversation carried it: with its own line numbers.
    const loaded = level3(await tap(ui, 'item-r:tu1', opts))
    expect(loaded.crumb).toBe('██ Tool results › Read  ~/project/notes.txt')
    expect(factsOf(loaded.facts)).toMatchObject({ form: 'raw', source: 'as loaded' })
    expect(loaded.notes).toEqual([])
    expect(loaded.body).toEqual(['     1\talpha', '     2\tbeta'])
    // Opening reads the file once, to compare it with what was loaded.
    expect(new Set(w.reads)).toEqual(new Set([NOTES]))
    const readsAtOpen = w.reads.length

    // The file changes in the world. Nothing happens until the pane compares: r does it.
    w.files[NOTES] = 'alpha\nBETA\ngamma\n'
    const refreshed = level3(await tap(ui, 'refresh', opts))
    expect(w.reads.length).toBeGreaterThan(readsAtOpen)
    expect(new Set(w.reads)).toEqual(new Set([NOTES]))
    expect(refreshed.notes).toEqual(['! The file changed on disk since it was loaded.'])
    // The text shown is still what was loaded.
    expect(refreshed.body).toEqual(loaded.body)
    expect(factsOf(refreshed.facts)).toMatchObject({ form: 'raw', source: 'as loaded' })

    // The file on disk: its own text, numbered from line 1 by the Code gutter.
    const disk = level3(await tap(ui, 'view', opts))
    expect(factsOf(disk.facts)).toMatchObject({ form: 'raw', source: 'on disk' })
    expect(disk.body).toEqual(['alpha', 'BETA', 'gamma'])
    expect((await ui.find({ type: 'Code' }))?.props).toMatchObject({ source: 'alpha\nBETA\ngamma', path: NOTES, startLine: 1 })
    expect(disk.controls.join(' ')).toContain('As loaded')

    // Formatted: the file as a code block; raw again: the plain text.
    const formatted = level3(await tap(ui, 'format', opts))
    expect(factsOf(formatted.facts)).toMatchObject({ form: 'formatted', source: 'on disk' })
    expect(formatted.body).toEqual(['```txt', 'alpha', 'BETA', 'gamma', '```'])
    expect(formatted.controls.join(' ')).toContain('Raw')
    const raw = level3(await tap(ui, 'format', opts))
    expect(factsOf(raw.facts)).toMatchObject({ form: 'raw', source: 'on disk' })
    expect(raw.body).toEqual(['alpha', 'BETA', 'gamma'])

    // Back to as loaded: the numbered lines return, the warning stays while the files differ.
    const again = level3(await tap(ui, 'view', opts))
    expect(factsOf(again.facts)).toMatchObject({ form: 'raw', source: 'as loaded' })
    expect(again.body).toEqual(loaded.body)

    // Copy and mention put the path where the person will use it, and say so.
    expect(w.copied).toEqual([])
    expect(w.filled).toEqual([])
    expect(level3(await tap(ui, 'copy', opts)).notes).toContain('Copied the path.')
    expect(w.copied).toEqual([NOTES])
    expect(level3(await tap(ui, 'mention', opts)).notes).toContain('Put the path in the prompt.')
    expect(w.filled).toEqual([`@${NOTES} `])

    // Back to the items with the ring on the Read result, back to the segments, close.
    expect(level2(await tap(ui, 'back', opts)).name).toBe('Tool results')
    expect(await ringOf(ui)).toBe('item-r:tu1')
    expect(await keysWith(ui, 'row-')).toEqual([])
    const one = await tap(ui, 'back', opts)
    expect(one[0]).toMatch(/^\d+k used · /)
    expect(await ringOf(ui)).toBe('row-tool-results')
    expect(w.closed).toEqual([])
    await ui.press({ key: 'close' })
    expect(w.closed).toEqual(['context-breakdown'])
    await ui.unmount()
  })
}
