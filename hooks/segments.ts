// The segments of the bar: their order, names, groups and definitions. Their
// colours are in palette.ts, one set per kind of theme.

import type {
  ContextBreakdownBaselineId,
  ContextBreakdownConversationId,
  ContextBreakdownListId,
  ContextBreakdownSegmentId,
} from '../types'

export type SegmentGroup = 'baseline' | 'conversation'

export type SegmentDef = {
  id: ContextBreakdownSegmentId
  label: string
  /** A shorter name for a narrow pane; the full label still names the control. */
  short: string
  group: SegmentGroup
  /**
   * What the segment holds, in one place for the whole pane. Level 1 puts
   * the name and a colon before it; level 2 shows it as a sentence of its
   * own (`sentence`).
   */
  definition: string
}

export const BASELINE: readonly SegmentDef[] = [
  {
    id: 'system',
    label: 'System prompt and built-in tools',
    short: 'System',
    group: 'baseline',
    definition: 'Claude Code’s own instructions and tool schemas.',
  },
  {
    id: 'mcp',
    label: 'MCP tools and instructions',
    short: 'MCP',
    group: 'baseline',
    definition: 'loaded MCP tool schemas and the instructions of MCP servers.',
  },
  {
    id: 'global-instructions',
    label: 'Global instructions',
    short: 'Global',
    group: 'baseline',
    definition: 'your user-level CLAUDE.md and managed instruction files.',
  },
  {
    id: 'project-instructions',
    label: 'Project instructions',
    short: 'Project',
    group: 'baseline',
    definition: 'the CLAUDE.md files of the project.',
  },
  {
    id: 'auto-memory',
    label: 'Auto-memory',
    short: 'Auto-memory',
    group: 'baseline',
    definition: 'the memory index that Claude Code loads.',
  },
  {
    id: 'skills-agents',
    label: 'Skills list and custom agents',
    short: 'Skills/agents',
    group: 'baseline',
    definition: 'the one-line listings of skills and agents.',
  },
  {
    id: 'other',
    label: 'Other',
    short: 'Other',
    group: 'baseline',
    definition: 'content that the mod cannot place in another segment.',
  },
]

export const CONVERSATION: readonly SegmentDef[] = [
  {
    id: 'compaction-summary',
    label: 'Compaction summary',
    short: 'Summary',
    group: 'conversation',
    definition: 'the summary that replaced the earlier conversation.',
  },
  {
    id: 'tool-results',
    label: 'Tool results',
    short: 'Tool results',
    group: 'conversation',
    definition: 'the output of tool calls, such as file reads and command output.',
  },
  {
    id: 'skill-bodies',
    label: 'Skill bodies',
    short: 'Skill bodies',
    group: 'conversation',
    definition: 'the full instructions of each skill that ran.',
  },
  {
    id: 'task-reports',
    label: 'Task reports',
    short: 'Tasks',
    group: 'conversation',
    definition: 'notifications from background tasks and subagents.',
  },
  {
    id: 'injections',
    label: 'System notifications',
    short: 'Notifications',
    group: 'conversation',
    definition: 'text that Claude Code adds, such as hook output, reminders and the output of local commands.',
  },
  {
    id: 'prompts',
    label: 'Your prompts',
    short: 'Prompts',
    group: 'conversation',
    definition: 'what you typed or pasted, including slash commands and shell lines.',
  },
  {
    id: 'claude-output',
    label: 'Claude output',
    short: 'Claude',
    group: 'conversation',
    definition: 'replies, thinking and tool-call inputs.',
  },
  {
    id: 'conversation',
    label: 'Conversation',
    short: 'Conversation',
    group: 'conversation',
    definition: 'all content after the session started. The messages could not be read, so there is no split.',
  },
]

export const BASELINE_IDS = BASELINE.map(def => def.id) as readonly ContextBreakdownBaselineId[]

/** The conversation segments a split can produce, in bar order. */
export const SPLIT_IDS = CONVERSATION.filter(def => def.id !== 'conversation').map(
  def => def.id,
) as readonly Exclude<ContextBreakdownConversationId, 'conversation'>[]

const BY_ID = new Map<string, SegmentDef>(
  [...BASELINE, ...CONVERSATION].map(def => [def.id, def]),
)

export function segmentDef(id: ContextBreakdownSegmentId): SegmentDef {
  return BY_ID.get(id) ?? { id, label: id, short: id, group: 'baseline', definition: '' }
}

/** The list of the MCP servers whose tools are not loaded: no segment, so no colour. */
export const NOT_LOADED = 'not-loaded'

/**
 * Its names: the row at level 1 and the list's name, the block the row
 * stands in, and what the list holds, as the segments' definitions are kept.
 */
export const NOT_LOADED_DEF = {
  label: 'MCP tools',
  block: 'Not loaded',
  definition: 'tool schemas that Claude Code loads on demand. Not in the window.',
} as const

/** Whether a list holds the items of a segment: every list but the servers that are not loaded. */
export function isSegmentList(id: ContextBreakdownListId): id is ContextBreakdownSegmentId {
  return id !== NOT_LOADED
}

/** A definition as a sentence of its own: the first letter in upper case. */
export function sentence(definition: string): string {
  return definition.charAt(0).toUpperCase() + definition.slice(1)
}

/**
 * The segment a `/ctx` argument names: its id, its short name, or the start
 * of its name or id, any case; an exact match wins over a start, an earlier
 * segment over a later one. Null for no word or an unknown one.
 * "Conversation" is not offered: it exists only when the messages could not
 * be read, and then its level 2 holds nothing.
 */
export function matchSegment(word: string): ContextBreakdownSegmentId | null {
  return matchNames(word, segmentNames()) as ContextBreakdownSegmentId | null
}

/** The segments a `/ctx` argument can name, in bar order, each with its names in lower case. */
function segmentNames(): { id: ContextBreakdownListId; names: string[] }[] {
  return [...BASELINE, ...CONVERSATION]
    .filter(def => def.id !== 'conversation')
    .map(def => ({ id: def.id, names: [def.id, def.short.toLowerCase(), def.label.toLowerCase()] }))
}

/** The first of `lists` with a name equal to `word`, else the first with a name that starts with it. */
function matchNames(word: string, lists: readonly { id: ContextBreakdownListId; names: string[] }[]): ContextBreakdownListId | null {
  const wanted = word.trim().replace(/\s+/g, ' ').toLowerCase()
  if (wanted === '') {
    return null
  }
  const exact = lists.find(list => list.names.includes(wanted))
  if (exact !== undefined) {
    return exact.id
  }

  return lists.find(list => list.names.some(name => name.startsWith(wanted)))?.id ?? null
}

/**
 * The list a `/ctx` argument names: a segment, as `matchSegment` finds it,
 * or the servers that are not loaded, by "not loaded", "not-loaded" or
 * "not". The segments keep their matches and their order, and the servers
 * come last: so "n", "no" and "noti" still name System notifications, as
 * before the servers had a list. An exact name still wins over a start, so
 * "not" names the servers.
 */
export function matchList(word: string): ContextBreakdownListId | null {
  return matchNames(word, [...segmentNames(), { id: NOT_LOADED, names: ['not loaded', NOT_LOADED, 'not'] }])
}
