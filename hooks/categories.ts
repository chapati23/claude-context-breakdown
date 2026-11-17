// Maps the breakdown's categories to baseline segments, the conversation
// total, the reserve and the categories that are not loaded.

import type {
  ContextBreakdownBaselineId,
  ContextBreakdownDeferred,
  ContextBreakdownSegment,
  ContextBreakdownServer,
} from '../types'
import { BASELINE_IDS } from './segments'
import { plainName } from './text'

/** The fields of one breakdown category this mod reads. */
export type CategoryLike = {
  name: string
  tokens: number
  kind: string
}

/** The fields of one memory file this mod reads. */
export type MemoryFileLike = {
  path: string
  type: string
  tokens: number
}

/** The fields of one MCP tool this mod reads. */
export type McpToolLike = {
  serverName: string
  tokens: number
  isLoaded: boolean
}

export type BreakdownLike = {
  categories: readonly CategoryLike[]
  memoryFiles?: readonly MemoryFileLike[] | null
  mcpTools?: readonly McpToolLike[] | null
  /** Custom agents: their entries in the agent-types reminder are baseline. */
  agents?: readonly { agentType: string }[] | null
}

export type CategorySplit = {
  baseline: ContextBreakdownSegment[]
  /** The tokens of the `Messages` category: the conversation. */
  messages: number
  reserve: number
  deferred: ContextBreakdownDeferred[]
}

const MEMORY_TYPES: Record<string, ContextBreakdownBaselineId> = {
  User: 'global-instructions',
  Managed: 'global-instructions',
  Project: 'project-instructions',
  Local: 'project-instructions',
  AutoMem: 'auto-memory',
}

/** Which baseline segment a memory file of this type belongs to. */
export function memorySegment(type: string): ContextBreakdownBaselineId {
  return MEMORY_TYPES[type] ?? 'other'
}

function tokensOf(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Splits `total` into whole numbers in proportion to `weights`, by largest
 * remainder, so the parts always sum to `total`.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const whole = Math.max(0, Math.round(total))
  const sum = weights.reduce((acc, w) => acc + Math.max(0, w), 0)
  if (whole === 0 || sum <= 0) {
    return weights.map(() => 0)
  }
  const exact = weights.map(w => (Math.max(0, w) / sum) * whole)
  const parts = exact.map(Math.floor)
  let left = whole - parts.reduce((acc, p) => acc + p, 0)
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index)
  for (const { index } of order) {
    if (left <= 0) {
      break
    }
    parts[index] = (parts[index] ?? 0) + 1
    left -= 1
  }

  return parts
}

/** Which baseline segment a used category belongs to, by its name. */
export function baselineOf(name: string): ContextBreakdownBaselineId | 'memory' | 'messages' {
  if (name === 'Messages') {
    return 'messages'
  }
  if (name === 'Memory files') {
    return 'memory'
  }
  if (name === 'System prompt' || name === 'System tools') {
    return 'system'
  }
  if (name.startsWith('MCP ')) {
    return 'mcp'
  }
  if (name === 'Skills' || name === 'Custom agents' || name.startsWith('Slash command')) {
    return 'skills-agents'
  }

  return 'other'
}

/**
 * Whether no memory file carries a token figure: then the whole "Memory
 * files" category is counted under Other (see `splitMemory`).
 */
export function isMemoryUnattributed(files: readonly MemoryFileLike[] | null | undefined): boolean {
  return (files ?? []).every(file => tokensOf(file.tokens) === 0)
}

/** The memory files' tokens split across segments 3 to 5 (and Other). */
function splitMemory(
  tokens: number,
  files: readonly MemoryFileLike[] | null | undefined,
): Map<ContextBreakdownBaselineId, number> {
  const out = new Map<ContextBreakdownBaselineId, number>()
  const weights = new Map<ContextBreakdownBaselineId, number>()
  for (const file of files ?? []) {
    const id = memorySegment(file.type)
    weights.set(id, (weights.get(id) ?? 0) + tokensOf(file.tokens))
  }
  const ids = [...weights.keys()]
  const parts = apportion(
    tokens,
    ids.map(id => weights.get(id) ?? 0),
  )
  if (parts.every(part => part === 0)) {
    // No per-file figures: the category is counted, but not attributed.
    out.set('other', tokens)

    return out
  }
  ids.forEach((id, index) => out.set(id, parts[index] ?? 0))

  return out
}

/**
 * The MCP servers with tools that are not loaded: per server the number of
 * such tools and their tokens, largest first (then most tools, then by
 * name). A loaded tool is in the window and counts under MCP tools instead.
 */
export function notLoadedServers(tools: readonly McpToolLike[] | null | undefined): ContextBreakdownServer[] {
  const byServer = new Map<string, ContextBreakdownServer>()
  for (const tool of tools ?? []) {
    if (tool.isLoaded) {
      continue
    }
    const name = plainName(String(tool.serverName ?? ''))
    const server = byServer.get(name) ?? { name, tools: 0, tokens: 0 }
    server.tools += 1
    server.tokens += tokensOf(tool.tokens)
    byServer.set(name, server)
  }

  return [...byServer.values()].sort(
    (a, b) => b.tokens - a.tokens || b.tools - a.tools || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )
}

/**
 * Splits the categories by `kind` first: `used` rows fill segments, `buffer`
 * is the reserve, `deferred` rows are listed apart, `free` is recomputed.
 * Every used row is counted, so the baseline plus `messages` always equals
 * the breakdown's used total.
 */
export function splitCategories(breakdown: BreakdownLike): CategorySplit {
  const sums = new Map<ContextBreakdownBaselineId, number>()
  const add = (id: ContextBreakdownBaselineId, tokens: number) =>
    sums.set(id, (sums.get(id) ?? 0) + tokens)
  let messages = 0
  let reserve = 0
  const deferred: ContextBreakdownDeferred[] = []

  for (const category of breakdown.categories) {
    const tokens = tokensOf(category.tokens)
    if (category.kind === 'buffer') {
      reserve += tokens
      continue
    }
    if (category.kind === 'deferred') {
      deferred.push({ name: category.name, tokens })
      continue
    }
    if (category.kind !== 'used') {
      continue
    }
    const target = baselineOf(category.name)
    if (target === 'messages') {
      messages += tokens
    } else if (target === 'memory') {
      for (const [id, part] of splitMemory(tokens, breakdown.memoryFiles)) {
        add(id, part)
      }
    } else {
      add(target, tokens)
    }
  }

  return {
    baseline: BASELINE_IDS.map(id => ({ id, tokens: sums.get(id) ?? 0 })),
    messages,
    reserve,
    deferred,
  }
}
