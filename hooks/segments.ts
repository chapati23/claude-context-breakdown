// The segments of the bar: their order, names, groups and fixed colours.

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
  color: string
}

// Colours stay fixed so people learn them. Baseline segments are cool hues
// (blue, teal, violet, green), conversation segments warm ones (orange, red,
// pink, gold, brown, olive), so the two groups read apart at a glance. Each
// has at least 3:1 contrast against white and against #1e1e1e, so a block
// stays visible on a light and on a dark terminal. Segments that can become
// neighbours (merges remove the ones between) differ by a CIEDE2000 distance
// of at least 10; tool results and Claude output, often side by side, by 40.
export const BASELINE: readonly SegmentDef[] = [
  { id: 'system', label: 'System prompt and built-in tools', short: 'System', group: 'baseline', color: '#4A72C9' },
  { id: 'mcp', label: 'MCP tools and instructions', short: 'MCP', group: 'baseline', color: '#1F9C91' },
  { id: 'global-instructions', label: 'Global instructions', short: 'Global', group: 'baseline', color: '#7D5BC6' },
  { id: 'project-instructions', label: 'Project instructions', short: 'Project', group: 'baseline', color: '#2F95C8' },
  { id: 'auto-memory', label: 'Auto-memory', short: 'Auto-memory', group: 'baseline', color: '#C05BE0' },
  { id: 'skills-agents', label: 'Skills list and custom agents', short: 'Skills/agents', group: 'baseline', color: '#3BA57A' },
  { id: 'other', label: 'Other', short: 'Other', group: 'baseline', color: '#7F8C99' },
]

export const CONVERSATION: readonly SegmentDef[] = [
  { id: 'compaction-summary', label: 'Compaction summary', short: 'Summary', group: 'conversation', color: '#A8783C' },
  { id: 'tool-results', label: 'Tool results', short: 'Tool results', group: 'conversation', color: '#D9661A' },
  { id: 'skill-bodies', label: 'Skill bodies', short: 'Skill bodies', group: 'conversation', color: '#D2508F' },
  { id: 'task-reports', label: 'Task reports', short: 'Tasks', group: 'conversation', color: '#8C7A1E' },
  { id: 'injections', label: 'System injections', short: 'Injections', group: 'conversation', color: '#8F6A5E' },
  { id: 'prompts', label: 'Your prompts', short: 'Prompts', group: 'conversation', color: '#E0523F' },
  { id: 'claude-output', label: 'Claude output', short: 'Claude', group: 'conversation', color: '#7F9C0D' },
  { id: 'conversation', label: 'Conversation', short: 'Conversation', group: 'conversation', color: '#D9661A' },
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
  return BY_ID.get(id) ?? { id, label: id, short: id, group: 'baseline', color: '#7F8C99' }
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
