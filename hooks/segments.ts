// The segments of the bar: their order, names and groups. Their colours are
// in palette.ts, one set per kind of theme.

import type {
  ContextBreakdownBaselineId,
  ContextBreakdownConversationId,
  ContextBreakdownSegmentId,
} from '../types'

export type SegmentGroup = 'baseline' | 'conversation'

export type SegmentDef = {
  id: ContextBreakdownSegmentId
  label: string
  /** A shorter name for a narrow pane; the full label still names the control. */
  short: string
  group: SegmentGroup
}

export const BASELINE: readonly SegmentDef[] = [
  { id: 'system', label: 'System prompt and built-in tools', short: 'System', group: 'baseline' },
  { id: 'mcp', label: 'MCP tools and instructions', short: 'MCP', group: 'baseline' },
  { id: 'global-instructions', label: 'Global instructions', short: 'Global', group: 'baseline' },
  { id: 'project-instructions', label: 'Project instructions', short: 'Project', group: 'baseline' },
  { id: 'auto-memory', label: 'Auto-memory', short: 'Auto-memory', group: 'baseline' },
  { id: 'skills-agents', label: 'Skills list and custom agents', short: 'Skills/agents', group: 'baseline' },
  { id: 'other', label: 'Other', short: 'Other', group: 'baseline' },
]

export const CONVERSATION: readonly SegmentDef[] = [
  { id: 'compaction-summary', label: 'Compaction summary', short: 'Summary', group: 'conversation' },
  { id: 'tool-results', label: 'Tool results', short: 'Tool results', group: 'conversation' },
  { id: 'skill-bodies', label: 'Skill bodies', short: 'Skill bodies', group: 'conversation' },
  { id: 'task-reports', label: 'Task reports', short: 'Tasks', group: 'conversation' },
  { id: 'injections', label: 'System notifications', short: 'Notifications', group: 'conversation' },
  { id: 'prompts', label: 'Your prompts', short: 'Prompts', group: 'conversation' },
  { id: 'claude-output', label: 'Claude output', short: 'Claude', group: 'conversation' },
  { id: 'conversation', label: 'Conversation', short: 'Conversation', group: 'conversation' },
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
  return BY_ID.get(id) ?? { id, label: id, short: id, group: 'baseline' }
}

/**
 * The segment a `/ctx` argument names: its id, its short name, or the start
 * of its name or id, any case; an exact match wins over a start, an earlier
 * segment over a later one. Null for no word or an unknown one.
 * "Conversation" is not offered: it exists only when the messages could not
 * be read, and then its level 2 holds nothing.
 */
export function matchSegment(word: string): ContextBreakdownSegmentId | null {
  const wanted = word.trim().replace(/\s+/g, ' ').toLowerCase()
  if (wanted === '') {
    return null
  }
  const defs = [...BASELINE, ...CONVERSATION].filter(def => def.id !== 'conversation')
  const names = (def: SegmentDef) => [def.id, def.short.toLowerCase(), def.label.toLowerCase()]
  const exact = defs.find(def => names(def).includes(wanted))
  if (exact !== undefined) {
    return exact.id
  }

  return defs.find(def => names(def).some(name => name.startsWith(wanted)))?.id ?? null
}
