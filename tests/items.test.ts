import { describe, expect, test } from 'claude-code/testing'

import type { MessageLike } from '../hooks/classify'
import {
  LIST_PAGE_ROWS,
  PART_IN_BASELINE,
  buildItems,
  callSummary,
  injectionTitle,
  listOf,
  pageOf,
  placeOf,
  promptTitle,
  promptTitles,
  skillTitle,
  sortItems,
  taskTitle,
  toolPath,
} from '../hooks/items'
import type { ItemData } from '../hooks/items'
import {
  GONE_NOTE,
  ITEMS_GONE_NOTE,
  afterClear,
  back,
  contentOf,
  isChangedOnDisk,
  mention,
  noMatchNote,
  openItem,
  rebuildView,
  stepItem,
} from '../hooks/navigate'
import type { NavIo } from '../hooks/navigate'
import { matchList, matchSegment } from '../hooks/segments'
import { MAX_API_MESSAGES } from '../hooks/snapshot'
import type { ContextBreakdownView } from '../types'
import {
  CHAT,
  CONTEXT_REPORT,
  LOCAL_COMMAND,
  NOTES,
  OPENING,
  PROJECT_MD,
  PROJECT_TEXT,
  REVIEWER_ENTRY,
  SUMMARY,
  manyResults,
  richBreakdown,
  richUsage,
} from './fixtures'

const DATA: ItemData = {
  breakdown: richBreakdown(),
  messages: CHAT as unknown as MessageLike[],
  charsPerToken: 4,
}

const titles = (segment: Parameters<typeof buildItems>[0], data = DATA) =>
  buildItems(segment, data).items.map(item => item.title)

describe('baseline items', () => {
  test('system: its two categories with the engine figures', () => {
    const { items } = buildItems('system', DATA)
    expect(items.map(item => [item.title, item.tokens])).toEqual([
      ['System prompt', 6000],
      ['System tools', 14_000],
    ])
    expect(items.every(item => item.loaded === null && item.disk === null)).toBe(true)
  })

  test('mcp: each loaded tool with its server, and the server instructions', () => {
    const { items } = buildItems('mcp', DATA)
    expect(items.map(item => [item.title, item.detail, item.tokens])).toEqual([
      ['mcp__notes__search', 'notes', 600],
      ['mcp__notes__write', 'notes', 300],
      ['MCP server instructions', '', 300],
    ])
  })

  test('instructions: each memory file of the segment, its path shortened', () => {
    const [project] = buildItems('project-instructions', DATA).items
    expect(project).toMatchObject({ title: '~/project/CLAUDE.md', tokens: 3000, path: PROJECT_MD, disk: 'memory' })
    expect(project!.loaded?.()).toBe(PROJECT_TEXT)
    expect(titles('global-instructions')).toEqual(['~/.claude/CLAUDE.md'])
    expect(buildItems('auto-memory', DATA)).toEqual({ items: [], note: 'No items.' })
  })

  test('skills and agents: each listing with its tokens', () => {
    const { items } = buildItems('skills-agents', DATA)
    expect(items.map(item => [item.title, item.detail, item.tokens])).toEqual([
      ['demo-skill', 'user', 1500],
      ['helper', 'tools', 500],
      ['reviewer', 'agent', 150],
    ])
  })

  test('listing rows open their text as loaded where the conversation holds it', () => {
    const opening = { ...DATA, messages: OPENING as unknown as MessageLike[] }
    const rows = buildItems('skills-agents', opening).items
    expect(rows.map(item => item.loaded?.() ?? null)).toEqual([
      '- demo-skill: Runs the demo steps.\nTRIGGER when the user asks for a demo.',
      '- tools:helper: Helps with the tools.',
      REVIEWER_ENTRY,
    ])
    const instructions = buildItems('mcp', opening).items.find(item => item.title === 'MCP server instructions')
    expect(instructions!.loaded?.()).toMatch(/^# MCP Server Instructions[\s\S]*## notes\nSearch the notes/)
    expect(listOf('mcp', buildItems('mcp', opening), 'size', 0).rows.map(row => [row.title, row.isOpenable])).toEqual([
      ['mcp__notes__search', false],
      ['mcp__notes__write', false],
      ['MCP server instructions', true],
    ])
    // Without the listings in the conversation, the rows do not open.
    expect(buildItems('skills-agents', DATA).items.every(item => item.loaded === null)).toBe(true)
  })

  test('a plugin’s skill opens its own entry, not a user skill of the same bare name', () => {
    const listing =
      '<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n- helper: The user’s own helper.\n- tools:helper: Helps with the tools.\n</system-reminder>'
    const data = { ...DATA, messages: [{ role: 'user', content: [{ type: 'text', text: listing }] }] as MessageLike[] }
    const rows = buildItems('skills-agents', data).items
    expect(rows.find(item => item.detail === 'tools')?.loaded?.()).toBe('- tools:helper: Helps with the tools.')
    // Listed only by its bare name, the plugin's skill does not open another's entry.
    const bare = '<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n- helper: The user’s own helper.\n</system-reminder>'
    const other = { ...DATA, messages: [{ role: 'user', content: [{ type: 'text', text: bare }] }] as MessageLike[] }
    expect(buildItems('skills-agents', other).items.find(item => item.detail === 'tools')?.loaded).toBeNull()
  })

  test('two plugins’ skills of the same name are two rows with ids of their own', () => {
    const listing =
      '<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n- alpha:review: Reviews for alpha.\n- beta:review: Reviews for beta.\n</system-reminder>'
    const breakdown = {
      ...DATA.breakdown!,
      skills: {
        skillFrontmatter: [
          { name: 'review', source: 'plugin', pluginName: 'alpha', tokens: 10 },
          { name: 'review', source: 'plugin', pluginName: 'beta', tokens: 10 },
        ],
      },
      agents: [],
    }
    const data = { ...DATA, breakdown, messages: [{ role: 'user', content: [{ type: 'text', text: listing }] }] as MessageLike[] }
    const rows = buildItems('skills-agents', data).items.filter(item => item.title === 'review')
    expect(rows.map(item => item.loaded?.())).toEqual(['- alpha:review: Reviews for alpha.', '- beta:review: Reviews for beta.'])
    // An item is found by its id: equal ids would open the first row's entry.
    expect(rows[0]!.id).not.toBe(rows[1]!.id)
  })

  test('without a breakdown a baseline segment says so', () => {
    expect(buildItems('system', { ...DATA, breakdown: null })).toEqual({
      items: [],
      note: 'The breakdown could not be read.',
    })
  })
})

describe('conversation items', () => {
  test('tool results: the tool, the call, the path and an estimate', () => {
    const { items } = buildItems('tool-results', DATA)
    expect(items.map(item => [item.id, item.title, item.detail])).toEqual([
      ['r:tu1', 'Read', '~/project/notes.txt'],
      ['r:tu2', 'Bash', 'ls -la /srv/data && echo done'],
    ])
    const [read, bash] = items
    expect(read).toMatchObject({ path: NOTES, disk: 'read', isNumbered: true, tokens: 6 })
    expect(bash).toMatchObject({ path: null, disk: null, tokens: 752 })
    expect(read!.loaded?.()).toBe('     1\talpha\n     2\tbeta\n')
  })

  test('a task report inside a reminder is listed under task reports, named after its summary', () => {
    const wrapped =
      '<system-reminder>\n[SYSTEM NOTIFICATION - NOT USER INPUT]\n\n<task-notification>\n<task-id>b3</task-id>\n<summary>Build finished</summary>\n</task-notification>\n</system-reminder>'
    const data = { ...DATA, messages: [{ role: 'user', content: [{ type: 'text', text: wrapped }] }] as MessageLike[] }
    expect(titles('task-reports', data)).toEqual(['Build finished'])
    expect(titles('injections', data)).toEqual([])
  })

  test('each kind of block gets a title from its content', () => {
    expect(titles('prompts')).toEqual(['Please read the notes file and list the folder.'])
    expect(titles('injections')).toEqual(['The task list is empty.'])
    expect(titles('skill-bodies')).toEqual(['demo-skill'])
    expect(titles('task-reports')).toEqual(['Build finished'])
    expect(titles('compaction-summary', { ...DATA, messages: SUMMARY as unknown as MessageLike[] })).toEqual([
      'Compaction summary',
    ])
  })

  test('Claude output: one item per message, by its words or its tool call', () => {
    const { items } = buildItems('claude-output', DATA)
    expect(items.map(item => [item.title, item.detail])).toEqual([
      ['Reading the notes first.', 'Read ~/project/notes.txt'],
      ['Bash ls -la /srv/data && echo done', ''],
      ['The folder holds one data file.', ''],
    ])
    expect(items[1]!.loaded?.()).toContain('"command": "ls -la /srv/data && echo done"')
  })

  test('the opening reminder is baseline, not an injection', () => {
    expect(titles('injections').some(title => title.includes('claudeMd'))).toBe(false)
  })

  test('baseline listings are not notifications; the agent types keep their other text', () => {
    const opening = { ...DATA, messages: OPENING as unknown as MessageLike[] }
    const { items } = buildItems('injections', opening)
    expect(items.map(item => [item.title, item.detail])).toEqual([
      ['Available agent types for the Agent tool:', PART_IN_BASELINE],
      ['# Environment', ''],
    ])
    // The agent row opens whole but is sized without the custom agent's entry.
    expect(items[0]!.loaded?.()).toContain(REVIEWER_ENTRY)
    expect(titles('prompts', opening)).toEqual(['List the notes.'])
  })

  test('a local command: the typed line is a prompt, the caveat and output are notifications', () => {
    const commands = { ...DATA, messages: LOCAL_COMMAND as unknown as MessageLike[] }
    // One message is one prompt, named by each part the person sent; the text
    // a prompt command expands to (/review) is not typed, and is left out.
    expect(titles('prompts', commands)).toEqual(['/compact · Read the notes.', '/context · ! ls', '/review src'])
    expect(titles('injections', commands)).toEqual([
      'Local command caveat',
      'Output: Compacted',
      'Output of /context',
      'Output: a.txt b.txt',
    ])
    // The untagged report opens as its own item, not inside the prompt.
    const { items } = buildItems('prompts', commands)
    const context = items.find(item => item.title === '/context · ! ls')!
    expect(context.loaded?.()).not.toContain('Context Usage')
    const report = buildItems('injections', commands).items.find(item => item.title === 'Output of /context')!
    expect(report.loaded?.()).toBe(CONTEXT_REPORT)
  })

  test('unreadable messages give a note, and so does the one Conversation segment', () => {
    expect(buildItems('prompts', { ...DATA, messages: null }).note).toBe('The messages could not be read.')
    expect(buildItems('conversation', DATA).items).toEqual([])
  })

  test('equal texts get ids of their own', () => {
    const twice = [
      { role: 'user', content: [{ type: 'text', text: '<system-reminder>\nSame.\n</system-reminder>' }] },
      { role: 'user', content: [{ type: 'text', text: '<system-reminder>\nSame.\n</system-reminder>' }] },
    ] as MessageLike[]
    const ids = buildItems('injections', { ...DATA, messages: twice }).items.map(item => item.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('titles', () => {
  test('name hooks, commands, shell lines and tasks', () => {
    expect(injectionTitle('<user-prompt-submit-hook>checked ok</user-prompt-submit-hook>')).toBe('Prompt hook: checked ok')
    expect(
      promptTitle('<command-message>ctx</command-message>\n<command-name>/ctx</command-name>\n<command-args>tool</command-args>'),
    ).toBe('/ctx tool')
    expect(promptTitle('<bash-input>ls</bash-input>')).toBe('! ls')
    expect(taskTitle('<task-notification><task-id>b2</task-id><status>failed</status></task-notification>')).toBe(
      'Task b2 failed',
    )
    expect(skillTitle('Base directory for this skill: /opt/skills/review/\n\nBody')).toBe('review')
  })

  test('a prompt typed after /clear is named beside the command, not hidden behind it', () => {
    const clear = '<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>'
    expect(promptTitles([clear, 'Answer with the single word ok.'])).toBe('/clear · Answer with the single word ok.')
    expect(promptTitles([clear])).toBe('/clear')
    expect(promptTitles(['', 'Read the notes.'])).toBe('Read the notes.')
    // The block after a prompt command's line is its expansion; the one after that is typed.
    const review = '<command-message>review is running…</command-message>\n<command-name>/review</command-name>\n<command-args>src</command-args>'
    expect(promptTitles([review, 'Review the files in src.', 'And the tests.'])).toBe('/review src · And the tests.')
  })

  test('a call is described by its path, its command or its pattern', () => {
    expect(toolPath({ file_path: '/srv/a.ts' })).toBe('/srv/a.ts')
    expect(toolPath({ notebook_path: '/srv/b.ipynb' })).toBe('/srv/b.ipynb')
    expect(toolPath({ command: 'ls' })).toBeNull()
    expect(callSummary('Read', { file_path: '/home/user/a.ts' })).toBe('~/a.ts')
    expect(callSummary('Bash', { command: 'npm   test\n--watch' })).toBe('npm test --watch')
    expect(callSummary('Grep', { pattern: 'TODO', path: '/srv' })).toBe('TODO')
    expect(callSummary('Other', {})).toBe('')
  })
})

describe('sorting and pages', () => {
  const data: ItemData = { breakdown: null, messages: manyResults(45) as MessageLike[], charsPerToken: 4 }
  const set = buildItems('tool-results', data)

  test('largest first by default, newest first on the toggle', () => {
    expect(sortItems(set.items, 'size')[0]!.id).toBe('r:b1')
    expect(sortItems(set.items, 'newest')[0]!.id).toBe('r:b45')
  })

  test('a page holds LIST_PAGE_ROWS rows and says what the other pages hold', () => {
    const first = listOf('tool-results', set, 'size', 0)
    expect(first.rows).toHaveLength(LIST_PAGE_ROWS)
    expect(first).toMatchObject({ page: 0, pages: 3, items: 45, hiddenItems: 25, canSort: true })
    expect(first.hiddenTokens).toBe(first.tokens - first.rows.reduce((sum, row) => sum + row.tokens, 0))
    const last = listOf('tool-results', set, 'size', 7)
    expect(last.page).toBe(2)
    expect(last.rows).toHaveLength(5)
  })

  test('baseline segments have no time order', () => {
    const list = listOf('system', buildItems('system', DATA), 'newest', 0)
    expect(list.canSort).toBe(false)
    expect(list.sort).toBe('size')
    expect(list.rows.map(row => row.title)).toEqual(['System tools', 'System prompt'])
  })

  test('an item’s place counts in the order shown, across pages, and names its neighbours that open', () => {
    // Largest first: b1 is first, b45 last; b20 ends page 1 and b21 starts page 2.
    expect(placeOf('tool-results', set, 'size', 'r:b1')).toEqual({ index: 0, prev: null, next: 'r:b2' })
    expect(placeOf('tool-results', set, 'size', 'r:b20')).toEqual({ index: 19, prev: 'r:b19', next: 'r:b21' })
    expect(pageOf(placeOf('tool-results', set, 'size', 'r:b20')!)).toBe(0)
    expect(pageOf(placeOf('tool-results', set, 'size', 'r:b21')!)).toBe(1)
    expect(placeOf('tool-results', set, 'size', 'r:b45')).toEqual({ index: 44, prev: 'r:b44', next: null })
    // Newest first turns the order round.
    expect(placeOf('tool-results', set, 'newest', 'r:b45')).toEqual({ index: 0, prev: null, next: 'r:b44' })
    expect(placeOf('tool-results', set, 'newest', 'r:b1')).toEqual({ index: 44, prev: 'r:b2', next: null })
    // An item the set does not hold has no place.
    expect(placeOf('tool-results', set, 'size', 'r:gone')).toBeNull()
  })

  test('a row that does not open counts in the place, and n and p pass over it', () => {
    const shut = { ...set, items: set.items.map(item => (item.id === 'r:b2' ? { ...item, loaded: null, disk: null } : item)) }
    expect(placeOf('tool-results', shut, 'size', 'r:b1')).toEqual({ index: 0, prev: null, next: 'r:b3' })
    expect(placeOf('tool-results', shut, 'size', 'r:b3')).toEqual({ index: 2, prev: 'r:b1', next: 'r:b4' })
  })
})

describe('/ctx argument', () => {
  test('takes an id, a short name or the start of a name, in any case', () => {
    expect(matchSegment('tool')).toBe('tool-results')
    expect(matchSegment('TOOL-RESULTS')).toBe('tool-results')
    expect(matchSegment('mcp')).toBe('mcp')
    expect(matchSegment('Proj')).toBe('project-instructions')
    expect(matchSegment('claude')).toBe('claude-output')
    expect(matchSegment(' skill bodies ')).toBe('skill-bodies')
  })

  test('an unknown word or none names no segment', () => {
    expect(matchSegment('zzz')).toBeNull()
    expect(matchSegment('')).toBeNull()
  })

  test('the unsplit Conversation segment is not offered; inner white space is collapsed', () => {
    expect(matchSegment('conversation')).toBeNull()
    expect(matchSegment('conv')).toBeNull()
    expect(matchSegment('tool   results')).toBe('tool-results')
  })

  test('the servers that are not loaded come after the segments: a word that names a segment keeps it, and "not" names the servers', () => {
    // Every start of every name a segment answers to, as matchSegment reads it.
    const words = new Set<string>()
    for (const name of ['system', 'mcp', 'global', 'project', 'auto-memory', 'skills', 'other', 'summary', 'tool results', 'skill bodies', 'tasks', 'system notifications', 'notifications', 'injections', 'prompts', 'your prompts', 'claude']) {
      for (let end = 1; end <= name.length; end += 1) {
        words.add(name.slice(0, end))
      }
    }
    for (const word of words) {
      const segment = matchSegment(word)
      // "not" is a whole name of the list, and only starts "notifications".
      if (segment !== null && word !== 'not') {
        expect({ word, list: matchList(word) }).toEqual({ word, list: segment })
      }
    }
    expect(matchList('n')).toBe('injections')
    expect(matchList('no')).toBe('injections')
    expect(matchList('noti')).toBe('injections')
    // An exact name wins over a start of "notifications".
    expect(matchList('not')).toBe('not-loaded')
    expect(matchList('Not Loaded')).toBe('not-loaded')
    expect(matchList('not l')).toBe('not-loaded')
    expect(matchList('not-')).toBe('not-loaded')
    expect(matchList('zzz')).toBeNull()
    expect(matchList('')).toBeNull()
  })
})

describe('moves on the view', () => {
  const list = listOf('tool-results', buildItems('tool-results', DATA), 'size', 0)
  const [read] = buildItems('tool-results', DATA).items

  test('back goes one level up and keeps the row it came from', () => {
    const atItem: ContextBreakdownView = {
      seq: 4,
      gen: 0,
      level: 3,
      list,
      item: contentOf(read!, { loaded: 'x', disk: null, isDiskRead: false }, 'loaded', 0, false),
    }
    expect(back(atItem)).toEqual({ seq: 5, gen: 0, level: 2, list, from: read!.id })
    expect(back({ seq: 5, gen: 0, level: 2, list })).toEqual({ seq: 6, gen: 0, level: 1, from: 'tool-results' })
  })

  test('a Read result as loaded counts the empty line the Read tool numbers after the last newline; the file does not', () => {
    expect(read!.isNumbered).toBe(true)
    // A file of two lines that ends with a newline, and its Read result.
    const resolved = { loaded: '1\talpha\n2\tbeta\n3\t', disk: 'alpha\nbeta\n', isDiskRead: true }
    expect(contentOf(read!, resolved, 'loaded', 0, false, 'raw')).toMatchObject({ firstLine: 1, lastLine: 3, lines: 3 })
    expect(contentOf(read!, resolved, 'loaded', 0, false, 'formatted')).toMatchObject({ lines: 3 })
    expect(contentOf(read!, resolved, 'disk', 0, false, 'raw')).toMatchObject({ firstLine: 1, lastLine: 2, lines: 2 })
  })

  test('a /clear: a conversation list or item says it left, a baseline one goes back with no note', () => {
    const memory = listOf('project-instructions', buildItems('project-instructions', DATA), 'size', 0)
    const system = listOf('system', buildItems('system', DATA), 'size', 0)
    expect(afterClear({ seq: 3, gen: 0, level: 2, list })).toEqual({ seq: 4, gen: 0, level: 1, note: ITEMS_GONE_NOTE })
    expect(afterClear({ seq: 3, gen: 0, level: 2, list: memory })).toEqual({ seq: 4, gen: 0, level: 1 })
    expect(afterClear({ seq: 3, gen: 0, level: 2, list: system })).toEqual({ seq: 4, gen: 0, level: 1 })
    const file = buildItems('project-instructions', DATA).items[0]!
    const atFile: ContextBreakdownView = {
      seq: 3,
      gen: 0,
      level: 3,
      list: memory,
      item: contentOf(file, { loaded: 'x', disk: null, isDiskRead: false }, 'loaded', 0, false),
    }
    expect(afterClear(atFile)).toEqual({ seq: 4, gen: 0, level: 1 })
    expect(afterClear({ seq: 3, gen: 0, level: 3, list, item: atFile.item })).toEqual({
      seq: 4,
      gen: 0,
      level: 1,
      note: GONE_NOTE,
    })
  })

  test('a /ctx word that names no segment gets a short quoted note', () => {
    expect(noMatchNote('foo')).toBe('No segment matches "foo".')
    expect(noMatchNote('  two   words ')).toBe('No segment matches "two words".')
    expect(noMatchNote('x'.repeat(100)).length).toBeLessThan(65)
  })

  test('after a compaction an open item that is gone falls back to level 1, a list is rebuilt', () => {
    const after: ItemData = { ...DATA, messages: SUMMARY as unknown as MessageLike[] }
    const atItem: ContextBreakdownView = {
      seq: 2,
      gen: 0,
      level: 3,
      list,
      item: contentOf(read!, { loaded: 'x', disk: null, isDiskRead: false }, 'loaded', 0, false),
    }
    expect(rebuildView(atItem, after)).toEqual({ seq: 2, gen: 1, level: 1, note: GONE_NOTE })
    // Every item of the list is gone: level 1, with a line that says so.
    expect(rebuildView({ seq: 2, gen: 0, level: 2, list }, after)).toEqual({ seq: 2, gen: 1, level: 1, note: ITEMS_GONE_NOTE })
    // A list that was empty already stays; one that could not be read keeps its own note.
    const empty = listOf('tool-results', buildItems('tool-results', after), 'size', 0)
    expect(rebuildView({ seq: 2, gen: 0, level: 2, list: empty }, after)).toMatchObject({ level: 2, gen: 1 })
    expect(rebuildView({ seq: 2, gen: 0, level: 2, list }, { ...DATA, messages: null })).toMatchObject({ level: 2, gen: 1 })
    // Still there: kept.
    expect(rebuildView(atItem, DATA).level).toBe(3)
  })

  test('an Edit result is plain text; a file shown from disk is coloured by its type', () => {
    const edit = { ...read!, title: 'Edit', isNumbered: false, disk: null, path: '/srv/a.ts' }
    expect(contentOf(edit, { loaded: 'The file /srv/a.ts has been updated.', disk: null, isDiskRead: false }, 'loaded', 0, false).language).toBeNull()
    const resolved = { loaded: '     1\talpha', disk: 'alpha', isDiskRead: true }
    expect(contentOf(read!, resolved, 'disk', 0, false).language).toBe(NOTES)
  })

  test('a Read result as loaded keeps its own numbers; on disk it gets a gutter', () => {
    const resolved = { loaded: '     1\talpha', disk: 'alpha\nbeta', isDiskRead: true }
    expect(contentOf(read!, resolved, 'loaded', 0, false)).toMatchObject({ startLine: null, canToggle: true })
    expect(contentOf(read!, resolved, 'disk', 0, false)).toMatchObject({ startLine: 1, text: 'alpha\nbeta' })
  })

  test('the changed marker needs both texts and a sure answer', () => {
    expect(isChangedOnDisk(read!, '     1\talpha', 'ALPHA\n')).toBe(true)
    expect(isChangedOnDisk(read!, '     1\talpha', 'alpha\n')).toBe(false)
    expect(isChangedOnDisk(read!, '     1\talpha', null)).toBe(false)
    expect(isChangedOnDisk(read!, 'File unchanged since last read.', 'other')).toBe(false)
  })
})

describe('review fixes', () => {
  const bashResults = (n: number, text: string) =>
    Array.from({ length: n }, (_, i) => [
      { role: 'assistant', content: [{ type: 'tool_use', id: `o${i + 1}`, name: 'Bash', input: { command: 'true' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: `o${i + 1}`, content: text }] },
    ]).flat() as MessageLike[]

  test('a Read that gave an image has no text, no disk view and no level 3', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'img', name: 'Read', input: { file_path: '/srv/pic.png' } }] },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'img',
            content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }],
          },
        ],
      },
    ] as MessageLike[]
    const set = buildItems('tool-results', { ...DATA, messages })
    expect(set.items[0]).toMatchObject({ path: '/srv/pic.png', disk: null, isNumbered: false, loaded: null })
    expect(listOf('tool-results', set, 'size', 0).rows[0]!.isOpenable).toBe(false)
  })

  test('the level-2 total is the level-1 figure, not a sum of rounded items', () => {
    const data: ItemData = { breakdown: null, messages: bashResults(5, 'ok'), charsPerToken: 3.5 }
    // 10 characters at 3.5 a token: 2.857, where rounding each item gave 5.
    expect(listOf('tool-results', buildItems('tool-results', data), 'size', 0).tokens).toBe(3)
    // The snapshot's own figure for the same messages wins.
    const measured = { ...data, segments: [{ id: 'tool-results' as const, tokens: 2 }] }
    expect(listOf('tool-results', buildItems('tool-results', measured), 'size', 0).tokens).toBe(2)
    // A figure from other messages (more than a token away) is not used.
    const stale = { ...data, segments: [{ id: 'tool-results' as const, tokens: 40 }] }
    expect(listOf('tool-results', buildItems('tool-results', stale), 'size', 0).tokens).toBe(3)
  })

  test('a list cut at the message limit says so, and memory files say the reminder is gone', () => {
    const messages = Array.from({ length: MAX_API_MESSAGES }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: i % 2 === 0 ? 'go on' : 'ok' }],
    })) as MessageLike[]
    const data = { ...DATA, messages }
    expect(buildItems('prompts', data).note).toMatch(/^Only the newest 4,096 messages can be read/)
    expect(buildItems('prompts', DATA).note).toBeNull()
    const [project] = buildItems('project-instructions', data).items
    const content = contentOf(project!, { loaded: null, disk: 'text', isDiskRead: true }, 'loaded', 0, false)
    expect(content.note).toMatch(/opening reminder is older than the newest messages/)
  })

  test('without per-file memory figures, Other lists the memory category level 1 counts there', () => {
    const breakdown = {
      categories: [{ name: 'Memory files', tokens: 900, kind: 'used' }],
      memoryFiles: [{ path: PROJECT_MD, type: 'Project', tokens: 0 }],
    }
    const set = buildItems('other', { ...DATA, breakdown })
    expect(set.items.map(item => [item.title, item.tokens])).toEqual([['Memory files', 900]])
    // With figures, the files belong to their own segments.
    expect(buildItems('other', DATA).items.some(item => item.title === 'Memory files')).toBe(false)
  })

  test('a mention quotes a path with white space', () => {
    expect(mention('/a b/c.md')).toBe('@"/a b/c.md" ')
    expect(mention('/a/c.md')).toBe('@/a/c.md ')
  })
})

describe('a move against a newer view', () => {
  const list = listOf('tool-results', buildItems('tool-results', DATA), 'size', 0)

  /** A NavIo over one stored view; `during` runs while the move reads the messages. */
  function navIo(
    state: { view: ContextBreakdownView },
    during: (data: { messages: MessageLike[] }) => void,
    messages: readonly unknown[] = CHAT,
  ): NavIo {
    const data = { messages: messages as unknown as MessageLike[] }
    let isFirst = true

    return {
      usage: async () => richUsage(),
      messages: async () => {
        const now = data.messages
        if (isFirst) {
          isFirst = false
          during(data)
        }

        return now
      },
      snapshot: async () => null,
      view: async () => state.view,
      write: async fn => {
        state.view = fn(state.view)
      },
      readFile: async () => {
        throw new Error('ENOENT')
      },
    }
  }

  test('a rebuild from newer messages makes the move run again on them', async () => {
    const state: { view: ContextBreakdownView } = { view: { seq: 1, gen: 0, level: 2, list } }
    await openItem(
      navIo(state, data => {
        // A compaction lands while the press reads the old messages.
        data.messages = SUMMARY as unknown as MessageLike[]
        state.view = rebuildView(state.view, { ...DATA, messages: data.messages })
      }),
      'r:tu1',
    )
    // The rebuild already emptied the list, so the move finds level 1 and stops.
    expect(state.view).toMatchObject({ level: 1, note: ITEMS_GONE_NOTE })
  })

  test('a later press wins over a slow earlier one', async () => {
    const state: { view: ContextBreakdownView } = { view: { seq: 1, gen: 0, level: 2, list } }
    await openItem(
      navIo(state, () => {
        state.view = back(state.view)
      }),
      'r:tu1',
    )
    expect(state.view).toEqual({ seq: 2, gen: 0, level: 1, from: 'tool-results' })
  })

  /** `messages` with one more Bash result of `chars` characters, the newest. */
  const withResult = (messages: readonly unknown[], id: string, chars: number) => [
    ...messages,
    { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: id } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x'.repeat(chars) }] },
  ]

  /** Level 3 on the Tool result `id` of `messages`, as the person opened it from the first page. */
  async function openedAt(id: string, messages: readonly unknown[]): Promise<{ view: ContextBreakdownView }> {
    const set = buildItems('tool-results', { ...DATA, messages: messages as MessageLike[] })
    const state: { view: ContextBreakdownView } = { view: { seq: 1, gen: 0, level: 2, list: listOf('tool-results', set, 'size', 0) } }
    await openItem(navIo(state, () => undefined, messages), id)

    return state
  }

  test('n and p at the end of an item open the next and previous item that opens, across list pages', async () => {
    const many = manyResults(45)
    const state = await openedAt('r:b20', many)
    expect(state.view).toMatchObject({ level: 3, list: { page: 0 }, place: { index: 19, next: 'r:b21' } })
    await stepItem(navIo(state, () => undefined, many), 1)
    expect(state.view).toMatchObject({ level: 3, item: { id: 'r:b21', page: 0 }, list: { page: 1 }, place: { index: 20, prev: 'r:b20' } })
    // b goes to the page that holds it, with the ring on its row.
    expect(back(state.view)).toMatchObject({ level: 2, list: { page: 1 }, from: 'r:b21' })
    await stepItem(navIo(state, () => undefined, many), -1)
    expect(state.view).toMatchObject({ level: 3, item: { id: 'r:b20' }, list: { page: 0 } })
  })

  test('at either end of the list a step that way does nothing', async () => {
    const many = manyResults(45)
    for (const [id, delta] of [
      ['r:b1', -1],
      ['r:b45', 1],
    ] as const) {
      const state = await openedAt(id, many)
      await stepItem(navIo(state, () => undefined, many), delta)
      expect(state.view).toMatchObject({ seq: 2, item: { id } })
    }
  })

  test('a step reads the order afresh: a rebuild while it reads makes it run again on the new items', async () => {
    const state = await openedAt('r:tu2', CHAT)
    // A new result lands between the two: the next item after tu2 is now it.
    const fresh = withResult(CHAT, 'fresh', 1000)
    await stepItem(
      navIo(state, data => {
        data.messages = fresh as MessageLike[]
        state.view = rebuildView(state.view, { ...DATA, messages: data.messages })
      }),
      1,
    )
    expect(state.view).toMatchObject({ level: 3, gen: 1, item: { id: 'r:fresh' }, place: { index: 1, prev: 'r:tu2', next: 'r:tu1' } })
  })

  test('a later press wins over a slow step', async () => {
    const state = await openedAt('r:tu2', CHAT)
    await stepItem(
      navIo(state, () => {
        state.view = back(state.view)
      }),
      1,
    )
    expect(state.view).toMatchObject({ level: 2, from: 'r:tu2' })
  })

  test('a rebuild keeps level 3 on the page of the list that holds the item, so b finds its row', async () => {
    const many = manyResults(45)
    const state = await openedAt('r:b20', many)
    // A larger result than all others comes first, and pushes b20 to page 2.
    const rebuilt = rebuildView(state.view, { ...DATA, messages: withResult(many, 'top', 10_000) as MessageLike[] })
    expect(rebuilt).toMatchObject({ level: 3, list: { page: 1 }, place: { index: 20 } })
    expect(back(rebuilt)).toMatchObject({ level: 2, list: { page: 1 }, from: 'r:b20' })
  })
})
