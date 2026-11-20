import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { formatCount } from '../hooks/format'
import { CHAT, FOCUSED_PANE, NOTES, PANE, PROJECT_MD, PROJECT_TEXT, SURFACES, richUsage, world } from './fixtures'

const START = { cwd: '/home/user/project', surface: 'terminal', isInteractive: true } as const
const README = '/home/user/project/README.md'

type Mounted = { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }

/** The keys of the item rows a level-2 drawing shows, in order. */
async function itemKeys(ui: Mounted): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' }))
    .map(button => button.key ?? '')
    .filter(key => key.startsWith('item-'))
}

async function chatWorld($: Engine, on: On, messages: readonly unknown[] = CHAT) {
  const w = world(on)
  w.usage = richUsage()
  w.messages = messages
  w.files = { [NOTES]: 'alpha\nbeta\n', [PROJECT_MD]: `${PROJECT_TEXT}\n` }
  await $.session.start(START)
  await w.clock.advance(0)

  return w
}

/** A skill body of 300 short sections, 1,500 lines: several pages in either view. */
const LONG_SKILL = [
  'Base directory for this skill: /home/user/.claude/skills/long',
  ...Array.from({ length: 300 }, (_, i) => `## Section ${i + 1}\n\nLine one of ${i + 1}.\nLine two of ${i + 1}.`),
].join('\n\n')

test('a Markdown memory file opens formatted; f switches to raw and back', async ($, on) => {
  await chatWorld($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOCUSED_PANE, surface })
    await ui.press({ key: 'row-project-instructions' })
    await ui.press({ key: (await itemKeys(ui))[0]! })
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe(PROJECT_TEXT)
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /tokens · formatted · as loaded$/ })).toBeDefined()
    const format = await ui.find({ key: 'format' })
    expect(format?.props.hotkey).toBe('f')
    expect(format?.props.label).toBe('Raw')

    await ui.press({ key: 'format' })
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.source).toBe(PROJECT_TEXT)
    expect(code?.props.startLine).toBe(1)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /tokens · raw · as loaded$/ })).toBeDefined()
    expect((await ui.find({ key: 'format' }))?.props.label).toBe('Formatted')

    await ui.press({ key: 'format' })
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe(PROJECT_TEXT)
    // Another item opens in its own default view: the Read result, raw.
    await ui.press({ key: 'format' })
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.press({ key: 'row-tool-results' })
    await ui.press({ key: 'item-r:tu1' })
    expect(await ui.find({ type: 'Text', text: /· raw · as loaded$/ })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('v, the changed marker, copy and mention work in the formatted view', async ($, on) => {
  const w = await chatWorld($, on)
  w.files[PROJECT_MD] = '# Project\n\nUse spaces.\n'

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-project-instructions' })
    await ui.press({ key: (await itemKeys(ui))[0]! })
    expect(await ui.find({ type: 'Text', text: /changed on disk since it was loaded/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown' })).toBeDefined()

    await ui.press({ key: 'view' })
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('# Project\n\nUse spaces.')
    expect(await ui.find({ type: 'Text', text: /· formatted · on disk$/ })).toBeDefined()
    await ui.press({ key: 'format' })
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe('# Project\n\nUse spaces.')
    expect(await ui.find({ type: 'Text', text: /· raw · on disk$/ })).toBeDefined()
    await ui.press({ key: 'view' })
    // The view holds across v.
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe(PROJECT_TEXT)
    await ui.press({ key: 'format' })

    await ui.press({ key: 'copy' })
    expect(await ui.find({ type: 'Text', text: 'Copied the path.' })).toBeDefined()
    await ui.press({ key: 'mention' })
    expect(await ui.find({ type: 'Text', text: 'Put the path in the prompt.' })).toBeDefined()
    expect(await ui.find({ type: 'Markdown' })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
  expect(w.copied).toEqual([PROJECT_MD, PROJECT_MD])
  expect(w.filled).toEqual([`@${PROJECT_MD} `, `@${PROJECT_MD} `])
})

test('both views page; a switch shows the page that holds the same place', async ($, on) => {
  await chatWorld($, on, [{ role: 'user', content: [{ type: 'text', text: LONG_SKILL }] }])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-skill-bodies' })
    await ui.press({ key: (await itemKeys(ui))[0]! })
    expect(await ui.find({ type: 'Text', text: /· formatted · as loaded · lines 1-[\d,]+ of 1,501$/ })).toBeDefined()

    await ui.press({ key: 'next' })
    const second = await ui.find({ type: 'Text', text: /· formatted · as loaded · lines [\d,]+-[\d,]+ of 1,501$/ })
    expect(second?.text).not.toMatch(/lines 1-/)
    const page = String((await ui.find({ type: 'Markdown' }))?.props.text)
    // Cut at a blank line: the page starts with a section's heading.
    expect(page).toMatch(/^## Section \d+\n/)
    const heading = page.split('\n')[0]!

    await ui.press({ key: 'format' })
    const code = await ui.find({ type: 'Code' })
    expect(String(code?.props.source).split('\n')).toContain(heading)
    const start = Number(code?.props.startLine)
    // The raw facts line starts at the page's first line.
    expect(await ui.find({ type: 'Text', text: `· raw · as loaded · lines ${formatCount(start)}-` })).toBeDefined()

    await ui.press({ key: 'next' })
    expect(Number((await ui.find({ type: 'Code' }))?.props.startLine)).toBeGreaterThan(start)
    await ui.press({ key: 'prev' })
    const first = String((await ui.find({ type: 'Code' }))?.props.source).split('\n')[0]!

    // Back to formatted: the page that holds the raw page's first line.
    await ui.press({ key: 'format' })
    expect(String((await ui.find({ type: 'Markdown' }))?.props.text).split('\n')).toContain(first)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a tool result opens raw, but a Read of a Markdown file opens formatted; f gives the other view', async ($, on) => {
  const messages = [
    ...CHAT,
    { role: 'assistant', content: [{ type: 'tool_use', id: 'md', name: 'Read', input: { file_path: README } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'md', content: '     1\t# Readme\n     2\t\n     3\tHello <b>you</b>.\n' }] },
  ]
  await chatWorld($, on, messages)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-tool-results' })

    // Bash output: raw, then fenced, so its lines stay lines. Its long line
    // is split, so the first Code holds the first line alone.
    await ui.press({ key: 'item-r:tu2' })
    expect((await ui.findAll({ type: 'Code' })).map(code => String(code.props.source)).join('\n').startsWith('total 0\n')).toBe(true)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.press({ key: 'format' })
    expect(String((await ui.find({ type: 'Markdown' }))?.props.text).startsWith('```\ntotal 0\n')).toBe(true)
    await ui.press({ key: 'back' })

    // A Read of a .md file: formatted without its numbers; raw with them.
    await ui.press({ key: 'item-r:md' })
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('# Readme\n\nHello \\<b>you\\</b>.')
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /· formatted · as loaded$/ })).toBeDefined()
    expect((await ui.find({ key: 'format' }))?.props.label).toBe('Raw')
    await ui.press({ key: 'format' })
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe('     1\t# Readme\n     2\t\n     3\tHello <b>you</b>.')
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.press({ key: 'back' })

    // A Read of another file: raw; formatted, it is fenced in its language.
    await ui.press({ key: 'item-r:tu1' })
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.press({ key: 'format' })
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('```txt\nalpha\nbeta\n```')
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})
