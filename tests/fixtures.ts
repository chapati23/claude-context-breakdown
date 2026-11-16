// Invented, neutral data in the shapes the engine answers with.

import type { On, SessionContextBreakdown, SessionMessage, SessionUsage } from 'claude-code'
import { mock } from 'claude-code/testing'

const category = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer' | 'deferred') => ({
  name,
  tokens,
  kind,
  color: 'inactive',
  isDeferred: kind === 'deferred',
})

/** 66k used of a 200k window: 26k baseline, 40k conversation, 33k reserve. */
export function breakdown(messages = 40_000): SessionContextBreakdown {
  const used = 26_000 + messages

  return {
    categories: [
      category('System prompt', 6000, 'used'),
      category('System tools', 14_000, 'used'),
      category('MCP tools (deferred)', 9000, 'deferred'),
      category('Memory files', 4000, 'used'),
      category('Skills', 2000, 'used'),
      category('Messages', messages, 'used'),
      category('Autocompact buffer', 33_000, 'buffer'),
      category('Free space', 200_000 - used - 33_000, 'free'),
    ],
    totalTokens: used,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    autocompactSource: 'auto',
    percentage: Math.floor((used / 200_000) * 100),
    gridRows: [],
    model: 'test-model',
    memoryFiles: [{ path: '/home/user/project/CLAUDE.md', type: 'Project', tokens: 4000 }],
    mcpTools: [],
    agents: [],
    isAutoCompactEnabled: true,
    apiUsage: null,
  }
}

export function usage(tokens: number | undefined, messages = 40_000): SessionUsage {
  return {
    startedAt: 0,
    context: {
      ...(tokens === undefined ? {} : { tokens, percent: Math.floor((tokens / 200_000) * 100) }),
      window: 200_000,
      breakdown: breakdown(messages),
    },
    rateLimits: [],
  }
}

/** 40,000 characters: tool results 30,000, Claude 8,000, prompts 1,900, a task report 100. */
export const MESSAGES = [
  { role: 'user', content: [{ type: 'text', text: 'p'.repeat(1900) }] },
  { role: 'assistant', content: [{ type: 'text', text: 'c'.repeat(8000) }] },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'r'.repeat(30_000) },
      { type: 'text', text: `<task-notification>${'x'.repeat(81)}` },
    ],
  },
] as const

/** A conversation right after a compaction: a 2,000-character summary. */
export const SUMMARY = [
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `This session is being continued from a previous conversation. ${'s'.repeat(1938)}`,
      },
    ],
  },
] as const

/** The summary as one transcript row, as a compaction hands it up. */
export const SUMMARY_ROW: SessionMessage = {
  role: 'user',
  text: 'This session is being continued from a previous conversation.',
  toolUses: [],
}

/** The transcript a compaction runs over. */
export const TRANSCRIPT: SessionMessage[] = [
  { role: 'user', text: 'Hello', toolUses: [] },
  { role: 'assistant', text: 'Hi', toolUses: [] },
]

export const BAND = {
  plugin: 'context-breakdown',
  component: 'AbovePrompt',
  requestId: 'context-breakdown',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const

export const PANE = {
  plugin: 'context-breakdown',
  component: 'Pane',
  requestId: 'context-breakdown',
  props: {
    title: 'Context',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

export const SURFACES = ['terminal', 'desktop'] as const

export const PROJECT_MD = '/home/user/project/CLAUDE.md'
export const NOTES = '/home/user/project/notes.txt'

/** The project file's text as the opening reminder carries it. */
export const PROJECT_TEXT = '# Project\n\nUse tabs for indents.'

/** A breakdown with every list the items read: MCP tools, skills, agents. */
export function richBreakdown(messages = 40_000): SessionContextBreakdown {
  const base = breakdown(messages)

  return {
    ...base,
    categories: [
      ...base.categories.filter(category => category.name !== 'Skills'),
      { name: 'MCP tools', tokens: 900, kind: 'used', color: 'inactive', isDeferred: false },
      { name: 'MCP server instructions', tokens: 300, kind: 'used', color: 'inactive', isDeferred: false },
      { name: 'Skills', tokens: 2000, kind: 'used', color: 'inactive', isDeferred: false },
      { name: 'Custom agents', tokens: 150, kind: 'used', color: 'inactive', isDeferred: false },
    ],
    memoryFiles: [
      { path: PROJECT_MD, type: 'Project', tokens: 3000 },
      { path: '/home/user/.claude/CLAUDE.md', type: 'User', tokens: 1000 },
    ],
    mcpTools: [
      { name: 'mcp__notes__search', serverName: 'notes', tokens: 600, isLoaded: true },
      { name: 'mcp__notes__write', serverName: 'notes', tokens: 300, isLoaded: true },
      { name: 'mcp__notes__delete', serverName: 'notes', tokens: 400, isLoaded: false },
    ],
    agents: [{ agentType: 'reviewer', source: 'projectSettings', tokens: 150 }],
    skills: {
      totalSkills: 2,
      includedSkills: 2,
      tokens: 2000,
      skillFrontmatter: [
        { name: 'demo-skill', source: 'userSettings', tokens: 1500 },
        { name: 'helper', source: 'plugin', pluginName: 'tools', tokens: 500 },
      ],
    },
  }
}

export function richUsage(tokens = 66_000, messages = 40_000): SessionUsage {
  return { ...usage(tokens, messages), context: { ...usage(tokens, messages).context, breakdown: richBreakdown(messages) } }
}

/**
 * A conversation in API form with one item of each conversation segment:
 * the opening reminder (baseline), a prompt, a Read and a Bash result, a
 * reminder, a skill body, a task report and two replies.
 */
export const CHAT = [
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# claudeMd\nCodebase and user instructions are shown below.\n\nContents of ${PROJECT_MD} (project instructions, checked into the codebase):\n\n${PROJECT_TEXT}\n\n# currentDate\nToday's date is 2000-01-01.\n</system-reminder>`,
      },
      { type: 'text', text: 'Please read the notes file and list the folder.' },
    ],
  },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Reading the notes first.' },
      { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: NOTES } },
    ],
  },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '     1\talpha\n     2\tbeta\n' }] },
  {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'ls -la /srv/data && echo done' } }],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'tu2', content: `total 0\n${'f'.repeat(3000)}` },
      { type: 'text', text: '<system-reminder>\nThe task list is empty.\n</system-reminder>' },
    ],
  },
  {
    role: 'user',
    content: [{ type: 'text', text: 'Base directory for this skill: /home/user/.claude/skills/demo-skill\n\n# Demo\nDo the steps.' }],
  },
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Build finished</summary>\n</task-notification>',
      },
    ],
  },
  { role: 'assistant', content: [{ type: 'text', text: 'The folder holds one data file.' }] },
] as const

/** A conversation of `n` Bash results, the k-th `(n + 1 - k) * 100` characters long. */
export function manyResults(n: number): unknown[] {
  const out: unknown[] = [{ role: 'user', content: [{ type: 'text', text: 'Run them all.' }] }]
  for (let k = 1; k <= n; k += 1) {
    out.push({ role: 'assistant', content: [{ type: 'tool_use', id: `b${k}`, name: 'Bash', input: { command: `step ${k}` } }] })
    out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `b${k}`, content: 'o'.repeat((n + 1 - k) * 100) }] })
  }

  return out
}

export type World = {
  /** What `$.session.usage` answers next. */
  usage: SessionUsage
  /** What `$.session.messages({ as: 'api' })` answers next; null to refuse. */
  messages: readonly unknown[] | null
  usageCalls: number
  /** How many of the next usage calls with a breakdown fail. */
  usageFailures: number
  opened: string[]
  /** The `focus` of each open, in order. */
  focused: boolean[]
  closed: string[]
  /** What `$.fs.read` answers, by path; a missing path rejects. */
  files: Record<string, string>
  reads: string[]
  copied: string[]
  filled: string[]
  clock: ReturnType<typeof mock.clock>
}

/**
 * Stands in for the engine beneath the plugin: each hook here answers a call
 * on `$` with `{ value }`, or an event with its own result.
 */
export function world(on: On): World {
  const state: World = {
    usage: usage(66_000),
    messages: MESSAGES,
    usageCalls: 0,
    usageFailures: 0,
    opened: [],
    focused: [],
    closed: [],
    files: {},
    reads: [],
    copied: [],
    filled: [],
    clock: mock.clock(on, { now: 1000 }),
  }
  on('session.usage', (_, e) => {
    state.usageCalls += 1
    if (e?.breakdown !== undefined && state.usageFailures > 0) {
      state.usageFailures -= 1
      throw new Error('usage is not readable')
    }

    return { value: state.usage }
  })
  on('session.messages', () => {
    if (state.messages === null) {
      throw new Error('messages are not readable')
    }

    return { value: state.messages as never }
  })
  on('command.register', () => ({ value: { command: 'ctx' } }))
  on('ui.open', (_, e) => {
    state.opened.push(e.id)
    state.focused.push(e.focus === true)

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    state.closed.push(e.id)

    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    state.reads.push(e.path)
    const text = state.files[e.path]
    if (text === undefined) {
      throw new Error('ENOENT')
    }

    return { value: text }
  })
  on('ui.copy', (_, e) => {
    state.copied.push(e.text)

    return { value: { isCopied: true } }
  })
  on('prompt.fill', (_, e) => {
    state.filled.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: [...e.changed] }))
  on('tool.call', () => ({ result: {} }))
  on('session.compact', () => ({ messages: [SUMMARY_ROW] }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  return state
}
