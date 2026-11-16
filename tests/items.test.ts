import { describe, expect, test } from 'claude-code/testing'

import type { MessageLike } from '../hooks/classify'
import {
  LIST_PAGE_ROWS,
  buildItems,
  callSummary,
  injectionTitle,
  listOf,
  promptTitle,
  skillTitle,
  sortItems,
  taskTitle,
  toolPath,
} from '../hooks/items'
import type { ItemData } from '../hooks/items'
import { GONE_NOTE, back, contentOf, isChangedOnDisk, mention, openItem, rebuildView } from '../hooks/navigate'
import type { NavIo } from '../hooks/navigate'
import { matchSegment } from '../hooks/segments'
import { MAX_API_MESSAGES } from '../hooks/snapshot'
import type { ContextBreakdownView } from '../types'
import { CHAT, NOTES, PROJECT_MD, PROJECT_TEXT, SUMMARY, manyResults, richBreakdown, richUsage } from './fixtures'

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
})

describe('moves on the view', () => {
  const list = listOf('tool-results', buildItems('tool-results', DATA), 'size', 0)
  const [read] = buildItems('tool-results', DATA).items

  test('back goes one level up', () => {
    const atItem: ContextBreakdownView = {
      seq: 4,
      gen: 0,
      level: 3,
      list,
      item: contentOf(read!, { loaded: 'x', disk: null, isDiskRead: false }, 'loaded', 0, false),
    }
    expect(back(atItem)).toEqual({ seq: 5, gen: 0, level: 2, list })
    expect(back({ seq: 5, gen: 0, level: 2, list })).toEqual({ seq: 6, gen: 0, level: 1 })
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
    const rebuilt = rebuildView({ seq: 2, gen: 0, level: 2, list }, after)
    expect(rebuilt.level === 2 && rebuilt.list.rows).toEqual([])
    expect(rebuilt.gen).toBe(1)
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
  function navIo(state: { view: ContextBreakdownView }, during: (data: { messages: MessageLike[] }) => void): NavIo {
    const data = { messages: CHAT as unknown as MessageLike[] }
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
    expect(state.view).toMatchObject({ level: 1, note: GONE_NOTE })
  })

  test('a later press wins over a slow earlier one', async () => {
    const state: { view: ContextBreakdownView } = { view: { seq: 1, gen: 0, level: 2, list } }
    await openItem(
      navIo(state, () => {
        state.view = back(state.view)
      }),
      'r:tu1',
    )
    expect(state.view).toEqual({ seq: 2, gen: 0, level: 1 })
  })
})
