// The items of one segment, built from the breakdown and the conversation,
// with their titles, sizes and the text level 3 shows.

import type {
  ContextBreakdownList,
  ContextBreakdownListId,
  ContextBreakdownPlace,
  ContextBreakdownRow,
  ContextBreakdownSegment,
  ContextBreakdownSegmentId,
  ContextBreakdownSort,
} from '../types'
import { apportion, baselineOf, isMemoryUnattributed, memorySegment, notLoadedServers, splitCategories } from './categories'
import type { CategoryLike, MemoryFileLike } from './categories'
import { blockChars, isCommandOutput, localCommandOf, sortMessage } from './classify'
import type { BlockLike, MessageLike, SplitId } from './classify'
import { baselineKeys, listingBodies, newestEntry } from './listing'
import type { ListingKind } from './listing'
import { fenced } from './markdown'
import type { Markup } from './markdown'
import { loadedFileText } from './reminder'
import { NOT_LOADED, isSegmentList, segmentDef } from './segments'
import { DEFAULT_CHARS_PER_TOKEN, MAX_API_MESSAGES } from './snapshot'
import { countOf, notLoadedRows } from './table'
import { firstWords, hashText, shortenPath } from './text'

/** Rows on one page of level 2. */
export const LIST_PAGE_ROWS = 20

/** The fields of the breakdown that items are built from. */
export type ItemBreakdown = {
  categories: readonly CategoryLike[]
  memoryFiles?: readonly MemoryFileLike[] | null
  mcpTools?: readonly { name: string; serverName: string; tokens: number; isLoaded: boolean }[] | null
  agents?: readonly { agentType: string; source: string; tokens: number }[] | null
  skills?: {
    skillFrontmatter: readonly { name: string; source: string; pluginName?: string; tokens: number }[]
  } | null
}

/** What items are built from; either part may be unreadable. */
export type ItemData = {
  breakdown: ItemBreakdown | null
  messages: readonly MessageLike[] | null
  /** The snapshot's ratio, for the estimates of conversation items. */
  charsPerToken: number | null
  /** The same snapshot's conversation segments, so level 2 adds up to level 1. */
  segments?: readonly ContextBreakdownSegment[] | null
}

/** The list holds the newest messages only when it is this long. */
export function isCutList(messages: readonly MessageLike[]): boolean {
  return messages.length >= MAX_API_MESSAGES
}

/** The note of a segment that holds nothing now; a list that loses its last item says more. */
export const NO_ITEMS = 'No items.'

const CUT_NOTE = `Only the newest ${MAX_API_MESSAGES.toLocaleString('en-US')} messages can be read: older items are not listed.`

/** Which file comparison applies to an item at level 3. */
export type DiskKind = 'memory' | 'read'

export type Item = {
  id: string
  title: string
  detail: string
  tokens: number
  /** Position in the conversation; baseline items count in list order. */
  order: number
  /** The file behind the item, as the engine named it. */
  path: string | null
  disk: DiskKind | null
  /** The as-loaded text carries its own line numbers (a Read result). */
  isNumbered: boolean
  /** What the text is, for level 3's formatted view and the view it opens in. */
  markup: Markup
  /** The formatted view's text as loaded, where it is not the raw text (Claude's reply). */
  formatted?: () => string
  /** The as-loaded text, or null when it is not found; absent: no level 3. */
  loaded: (() => string | null) | null
  /** Why the as-loaded text may be missing, when the usual reason is wrong. */
  missing?: string
  /** A server that is not loaded: how many of its tools are not loaded, for "most tools first". */
  count?: number
}

export type ItemSet = {
  items: Item[]
  note: string | null
  /** The servers that are not loaded only: the MCP tools category's figure, when it has one. */
  categoryTokens?: number
}

export function isBaseline(segment: ContextBreakdownSegmentId): boolean {
  return segmentDef(segment).group === 'baseline'
}

/**
 * Whether the segment's items have a time order to sort by. The servers that
 * are not loaded sort by their figures instead (`listOf`).
 */
export function canSort(segment: ContextBreakdownListId): boolean {
  return isSegmentList(segment) && !isBaseline(segment) && segment !== 'conversation'
}

function tokensOf(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function stringField(input: Record<string, unknown>, name: string): string | null {
  const value = input[name]

  return typeof value === 'string' && value !== '' ? value : null
}

/** The file a tool call names, for the tools that take one. */
export function toolPath(input: unknown): string | null {
  const fields = asRecord(input)

  return stringField(fields, 'file_path') ?? stringField(fields, 'notebook_path')
}

/** What a call did, in a few words: the path, the command's start, the pattern. */
export function callSummary(name: string, input: unknown): string {
  const fields = asRecord(input)
  const path = toolPath(fields)
  if (path !== null) {
    return shortenPath(path)
  }
  if (name === 'Bash') {
    return firstWords(stringField(fields, 'command') ?? '', 48)
  }
  for (const field of ['pattern', 'query', 'url', 'description', 'skill', 'command', 'prompt', 'path']) {
    const value = stringField(fields, field)
    if (value !== null) {
      return firstWords(value, 48)
    }
  }

  return ''
}

// Baseline segments: rows of the breakdown, with the engine's token figures.

function categoryItem(category: CategoryLike, order: number): Item {
  return {
    id: `c:${hashText(category.name)}`,
    title: category.name,
    detail: '',
    tokens: tokensOf(category.tokens),
    order,
    path: null,
    disk: null,
    isNumbered: false,
    markup: 'text',
    loaded: null,
  }
}

function usedCategories(breakdown: ItemBreakdown, segment: ContextBreakdownSegmentId): CategoryLike[] {
  return breakdown.categories.filter(
    category => category.kind === 'used' && baselineOf(category.name) === segment,
  )
}

function memoryItems(
  breakdown: ItemBreakdown,
  segment: ContextBreakdownSegmentId,
  messages: readonly MessageLike[] | null,
): Item[] {
  // A cut list starts after the opening reminder, so no file's text is there.
  const missing =
    messages !== null && isCutList(messages)
      ? 'The opening reminder is older than the newest messages and can no longer be read: shown from disk.'
      : undefined

  return (breakdown.memoryFiles ?? [])
    .filter(file => memorySegment(file.type) === segment)
    .map((file, order) => ({
      id: `f:${hashText(file.path)}`,
      title: shortenPath(file.path),
      detail: '',
      tokens: tokensOf(file.tokens),
      order,
      path: file.path,
      disk: 'memory' as const,
      isNumbered: false,
      markup: 'file' as const,
      loaded: () => (messages === null ? null : loadedFileText(messages, file.path)),
      ...(missing === undefined ? {} : { missing }),
    }))
}

/** The engine's word for where a skill comes from, as a person says it. */
function skillSource(source: string): string {
  const words: Record<string, string> = {
    userSettings: 'user',
    projectSettings: 'project',
    policySettings: 'managed',
    syncedSkills: 'synced',
  }

  return words[source] ?? source
}

/** A row's as-loaded text, or no level 3 when there is none. */
function asLoaded(text: string | null): (() => string) | null {
  return text === null || text === '' ? null : () => text
}

/** Several listings of one kind, oldest first, as one text; null with none. */
function joined(bodies: readonly string[]): string | null {
  return bodies.length === 0 ? null : bodies.join('\n\n')
}

function baselineItems(segment: ContextBreakdownSegmentId, data: ItemData): ItemSet {
  const { breakdown } = data
  if (breakdown === null) {
    return { items: [], note: 'The breakdown could not be read.' }
  }
  const items: Item[] = []
  const push = (item: Omit<Item, 'order'>) => items.push({ ...item, order: items.length })
  const plain = { path: null, disk: null, isNumbered: false, markup: 'text' as const, loaded: null }
  const categories = usedCategories(breakdown, segment)
  // The listings arrive as reminders, so their as-loaded text is in the
  // conversation; a row opens only where its text was found.
  const listings = (kind: ListingKind) => (data.messages === null ? [] : listingBodies(data.messages, kind))

  if (segment === 'mcp') {
    const tools = (breakdown.mcpTools ?? []).filter(tool => tool.isLoaded)
    for (const tool of tools) {
      push({ id: `m:${hashText(tool.name)}`, title: tool.name, detail: tool.serverName, tokens: tokensOf(tool.tokens), ...plain })
    }
    const instructions = joined(listings('mcp'))
    for (const category of categories) {
      if (tools.length === 0 || !category.name.startsWith('MCP tools')) {
        const isInstructions = /instructions/i.test(category.name)
        push({ ...categoryItem(category, 0), loaded: isInstructions ? asLoaded(instructions) : null })
      }
    }
  } else if (segment === 'skills-agents') {
    const skills = breakdown.skills?.skillFrontmatter ?? []
    const agents = breakdown.agents ?? []
    const skillListings = listings('skills')
    const agentListings = listings('agents')
    for (const skill of skills) {
      // The listing names a plugin's skill "plugin:name". Only that name is
      // tried: the bare name may be another skill's entry.
      const names =
        skill.pluginName === undefined || skill.name.includes(':') ? [skill.name] : [`${skill.pluginName}:${skill.name}`]
      push({
        // The plugin is part of the id: two plugins can name a skill alike.
        id: `s:${hashText(`${skill.source}:${skill.pluginName ?? ''}:${skill.name}`)}`,
        title: skill.name,
        detail: skill.pluginName ?? skillSource(skill.source),
        tokens: tokensOf(skill.tokens),
        ...plain,
        loaded: asLoaded(newestEntry(skillListings, names)),
      })
    }
    for (const agent of agents) {
      push({
        id: `g:${hashText(agent.agentType)}`,
        title: agent.agentType,
        detail: 'agent',
        tokens: tokensOf(agent.tokens),
        ...plain,
        loaded: asLoaded(newestEntry(agentListings, [agent.agentType])),
      })
    }
    for (const category of categories) {
      const isListed =
        (category.name === 'Skills' && skills.length > 0) ||
        (category.name === 'Custom agents' && agents.length > 0)
      if (!isListed) {
        const whole = category.name === 'Skills' ? joined(skillListings) : null
        push({ ...categoryItem(category, 0), loaded: asLoaded(whole) })
      }
    }
  } else {
    // System, Other: the categories themselves; memory segments: the files.
    for (const category of categories) {
      push(categoryItem(category, 0))
    }
    // Without per-file figures, level 1 counts the memory files under Other.
    if (segment === 'other' && isMemoryUnattributed(breakdown.memoryFiles)) {
      for (const category of breakdown.categories) {
        if (category.kind === 'used' && baselineOf(category.name) === 'memory' && tokensOf(category.tokens) > 0) {
          push(categoryItem(category, 0))
        }
      }
    }
    for (const file of memoryItems(breakdown, segment, data.messages)) {
      push(file)
    }
  }

  return { items, note: items.length === 0 ? NO_ITEMS : null }
}

// Conversation segments: blocks of the messages, sized by characters.

const ID_PREFIX: Record<SplitId, string> = {
  'compaction-summary': 's',
  'tool-results': 'r',
  'skill-bodies': 'k',
  'task-reports': 't',
  injections: 'i',
  prompts: 'p',
  'claude-output': 'a',
}

function blocksOf(message: MessageLike): readonly BlockLike[] {
  if (typeof message.content === 'string') {
    return [{ type: 'text', text: message.content }]
  }

  return Array.isArray(message.content) ? message.content.filter(b => b && typeof b === 'object') : []
}

function textOf(block: BlockLike): string {
  return typeof block.text === 'string' ? block.text : ''
}

/** A tool result's text: its string, or its text parts; null with none. */
function resultText(block: BlockLike): string | null {
  const content = block.content
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return null
  }
  const parts = content.map(part => {
    const inner = asRecord(part)

    return inner.type === 'text' && typeof inner.text === 'string' ? inner.text : `[${String(inner.type ?? 'block')}]`
  })

  return content.some(part => asRecord(part).type === 'text') ? parts.join('\n') : null
}

/** The row detail of an injection whose block is partly counted in the baseline. */
export const PART_IN_BASELINE = 'part in Baseline'

/** "Prompt hook: …", "Output: …", or the first line of a reminder, tags left out. */
export function injectionTitle(text: string): string {
  const hook = /<user-prompt-submit-hook>([\s\S]*?)(?:<\/user-prompt-submit-hook>|$)/.exec(text)
  if (hook !== null) {
    return `Prompt hook: ${firstWords(hook[1]!, 48)}`
  }
  if (text.trimStart().startsWith('<local-command-caveat>')) {
    return 'Local command caveat'
  }
  if (isCommandOutput(text)) {
    return firstWords(`Output: ${text}`)
  }
  const body = text.replace(/<\/?system-reminder>/g, '\n')
  const line = body.split('\n').find(one => one.trim() !== '') ?? ''

  return firstWords(line) || 'Reminder'
}

/** A task report's summary, else its status and id, else its first words. */
export function taskTitle(text: string): string {
  const tag = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim() ?? ''
  const summary = tag('summary')
  if (summary !== '') {
    return firstWords(summary)
  }
  const status = tag('status')
  const id = tag('task-id')
  if (status !== '' || id !== '') {
    return firstWords(`Task ${id} ${status}`)
  }

  return firstWords(text) || 'Task report'
}

/** A skill body is named after its folder, the last part of its base directory. */
export function skillTitle(text: string): string {
  const base = /Base directory for this skill:\s*(\S[^\n]*)/.exec(text)?.[1]?.trim()
  const name = base?.replace(/[/\\]+$/, '').split(/[/\\]/).pop()

  return name !== undefined && name !== '' ? name : firstWords(text)
}

/** A prompt's first words; a slash command or shell line by its own words. */
export function promptTitle(text: string): string {
  const command = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim()
  if (command !== undefined && command !== '') {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1] ?? ''
    const name = command.startsWith('/') ? command : `/${command}`

    return firstWords(`${name} ${args}`)
  }
  const shell = /<bash-input>([\s\S]*?)<\/bash-input>/.exec(text)?.[1]
  if (shell !== undefined) {
    return firstWords(`! ${shell}`)
  }

  return firstWords(text)
}

/**
 * The title of one prompt: the words of each block the person sent, in order.
 * Claude Code can put a command's line and the next typed prompt in one
 * message (seen live after /clear), so the first block alone would hide the
 * prompt. The block after a prompt command's line is what the command
 * expands to, not typed words: it is left out.
 */
export function promptTitles(texts: readonly string[]): string {
  const parts: string[] = []
  let isExpansion = false
  for (const text of texts) {
    if (text.trim() === '') {
      continue
    }
    if (!isExpansion) {
      parts.push(promptTitle(text))
    }
    isExpansion = text.includes('<command-name>') && localCommandOf(text) === null
  }

  return firstWords(parts.join(' · '))
}

/** Claude's message: its first words, or its tool call; the call as detail beside words. */
function claudeTitle(blocks: readonly BlockLike[]): { title: string; detail: string } {
  const words = blocks.map(textOf).find(text => text.trim() !== '')
  const call = blocks.find(block => block.type === 'tool_use')
  const callText =
    call === undefined
      ? ''
      : `${String(call.name ?? 'tool')} ${callSummary(String(call.name ?? ''), call.input)}`.trim()
  if (words !== undefined) {
    return { title: firstWords(words), detail: callText }
  }
  if (callText !== '') {
    return { title: callText, detail: '' }
  }

  return { title: blocks.some(block => block.type === 'thinking') ? 'Thinking' : 'Reply', detail: '' }
}

/** Claude's message as Markdown: its text as written, each tool input fenced as JSON. */
function claudeMarkdown(blocks: readonly BlockLike[]): string {
  return blocks
    .map(block => {
      switch (block.type) {
        case 'text':
          return textOf(block)
        case 'thinking':
          return `**Thinking**\n\n${typeof block.thinking === 'string' ? block.thinking : ''}`
        case 'tool_use':
          return `**${String(block.name ?? 'tool')}**\n\n${fenced(JSON.stringify(block.input ?? {}, null, 2), 'json')}`
        default:
          return `[${block.type}]`
      }
    })
    .join('\n\n')
}

function claudeText(blocks: readonly BlockLike[]): string {
  return blocks
    .map(block => {
      switch (block.type) {
        case 'text':
          return textOf(block)
        case 'thinking':
          return `[thinking]\n${typeof block.thinking === 'string' ? block.thinking : ''}`
        case 'tool_use':
          return `[${String(block.name ?? 'tool')}]\n${JSON.stringify(block.input ?? {}, null, 2)}`
        default:
          return `[${block.type}]`
      }
    })
    .join('\n\n')
}

/** Tools whose result is terminal output: the formatted view fences it, so a "#" line stays a line. */
const OUTPUT_TOOLS: ReadonlySet<string> = new Set(['Bash', 'BashOutput', 'PowerShell', 'Grep', 'Glob', 'LS'])

type ToolUse = { name: string; input: unknown }

function toolUses(messages: readonly MessageLike[]): Map<string, ToolUse> {
  const out = new Map<string, ToolUse>()
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue
    }
    for (const block of blocksOf(message)) {
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        out.set(block.id, { name: String(block.name ?? 'tool'), input: block.input })
      }
    }
  }

  return out
}

function conversationItems(segment: SplitId, data: ItemData): ItemSet {
  const { messages } = data
  if (messages === null) {
    return { items: [], note: 'The messages could not be read.' }
  }
  const ratio = data.charsPerToken !== null && data.charsPerToken > 0 ? data.charsPerToken : DEFAULT_CHARS_PER_TOKEN
  const keys = baselineKeys(data.breakdown)
  const uses = segment === 'tool-results' ? toolUses(messages) : new Map<string, ToolUse>()
  const items: Item[] = []
  const sizes: number[] = []
  const seen = new Map<string, number>()
  let order = 0
  const push = (item: Omit<Item, 'order' | 'tokens'>, chars: number) => {
    // Equal texts get the same fingerprint; a count tells them apart.
    const count = seen.get(item.id) ?? 0
    seen.set(item.id, count + 1)
    items.push({
      ...item,
      id: count === 0 ? item.id : `${item.id}~${count}`,
      tokens: 0,
      order,
    })
    sizes.push(chars)
  }
  const textItem = { detail: '', path: null, disk: null, isNumbered: false }

  for (const message of messages) {
    const blocks = blocksOf(message)
    if (message.role === 'assistant') {
      order += 1
      if (segment === 'claude-output' && blocks.length > 0) {
        const firstCall = blocks.find(block => block.type === 'tool_use' && typeof block.id === 'string')
        const { title, detail } = claudeTitle(blocks)
        push(
          {
            ...textItem,
            id: `a:${firstCall === undefined ? hashText(blocks.map(textOf).join('\n')) : String(firstCall.id)}`,
            title,
            detail,
            markup: 'prose',
            loaded: () => claudeText(blocks),
            formatted: () => claudeMarkdown(blocks),
          },
          blocks.reduce((sum, block) => sum + blockChars(block), 0),
        )
      }
      continue
    }
    const prompt: BlockLike[] = []
    let promptChars = 0
    const sortedBlocks = sortMessage(message.role, blocks, keys)
    for (const [index, block] of blocks.entries()) {
      order += 1
      const sorted = sortedBlocks[index] ?? null
      const id = sorted?.id ?? null
      if (sorted === null || id !== segment) {
        continue
      }
      if (id === 'prompts') {
        prompt.push(block)
        promptChars += sorted.chars
        continue
      }
      if (id === 'tool-results') {
        const use = typeof block.tool_use_id === 'string' ? uses.get(block.tool_use_id) : undefined
        const text = resultText(block)
        const name = use?.name ?? 'Tool result'
        const path = use === undefined ? null : toolPath(use.input)
        // A Read that gave an image or a PDF holds no text: the file is not
        // text either, so it gets no level 3 and no disk view.
        const isTextRead = name === 'Read' && text !== null
        push(
          {
            id: `r:${typeof block.tool_use_id === 'string' ? block.tool_use_id : hashText(text ?? '')}`,
            title: name,
            detail: use === undefined ? '' : callSummary(name, use.input),
            path,
            disk: isTextRead && path !== null ? 'read' : null,
            isNumbered: isTextRead,
            markup: isTextRead ? 'file' : OUTPUT_TOOLS.has(name) ? 'output' : 'text',
            loaded: text === null ? null : () => text,
          },
          blockChars(block),
        )
        continue
      }
      const text = textOf(block)
      const title =
        id === 'compaction-summary'
          ? 'Compaction summary'
          : id === 'skill-bodies'
            ? skillTitle(text)
            : id === 'task-reports'
              ? taskTitle(text)
              : sorted.outputOf !== undefined
                ? `Output of ${firstWords(sorted.outputOf, 40)}`
                : injectionTitle(text)
      // A summary and a skill body are written as Markdown; a report or an
      // injection is mostly tags around it.
      const markup: Markup = id === 'compaction-summary' || id === 'skill-bodies' ? 'prose' : 'text'
      // Part of the block is counted in the baseline (a listing, custom agents' entries):
      // the text shows whole, the size is the rest, and the row says so.
      const detail = sorted.chars < blockChars(block) ? PART_IN_BASELINE : ''
      push({ ...textItem, id: `${ID_PREFIX[id]}:${hashText(text)}`, title, detail, markup, loaded: () => text }, sorted.chars)
    }
    // The blocks a person sent in one message are one prompt.
    if (prompt.length > 0) {
      const texts = prompt.filter(block => block.type === 'text').map(textOf)
      const kinds = prompt.filter(block => block.type !== 'text').map(block => block.type)
      const first = texts.find(text => text.trim() !== '')
      const kindTitle = kinds.length > 0 ? `${kinds[0]!.charAt(0).toUpperCase()}${kinds[0]!.slice(1)}` : 'Prompt'
      push(
        {
          ...textItem,
          id: `p:${hashText(`${texts.join('\n')}|${kinds.join(',')}`)}`,
          title: first === undefined ? kindTitle : promptTitles(texts),
          detail: first !== undefined && kinds.length > 0 ? `+${kinds.length} ${kinds.length === 1 ? kinds[0] : 'attachments'}` : '',
          markup: 'prose',
          loaded:
            texts.length === 0
              ? null
              : () => prompt.map(block => (block.type === 'text' ? textOf(block) : `[${block.type}]`)).join('\n\n'),
        },
        promptChars,
      )
    }
  }

  // The segment's total shared out by characters, so the rows add up to it
  // and per-item rounding cannot drift. The total is level 1's figure when
  // it comes from the same messages, else the characters over the ratio.
  const isCut = isCutList(messages)
  const exact = sizes.reduce((sum, chars) => sum + chars, 0) / ratio
  const measured = isCut ? undefined : data.segments?.find(one => one.id === segment)?.tokens
  const total = measured !== undefined && Math.abs(measured - exact) < 1 ? measured : Math.round(exact)
  const parts = apportion(total, sizes)
  items.forEach((item, index) => {
    item.tokens = parts[index] ?? 0
  })

  return { items, note: isCut ? CUT_NOTE : items.length === 0 ? NO_ITEMS : null }
}

/**
 * The MCP servers whose tools are not loaded, as items: one per server, with
 * its tool count as the detail. They hold no text: no row opens.
 */
function serverItems(data: ItemData): ItemSet {
  if (data.breakdown === null) {
    return { items: [], note: 'The breakdown could not be read.' }
  }
  const servers = notLoadedServers(data.breakdown.mcpTools)
  // The category that holds the servers, found as level 1 finds it, and its
  // own figure: the list's total comes from the same breakdown as its rows.
  const { deferred } = splitCategories(data.breakdown)
  const holder = notLoadedRows(deferred, servers, name => baselineOf(name) === 'mcp').find(row => row.servers.length > 0)
  const figure = deferred.find(category => category.name === holder?.name)?.tokens ?? 0

  return {
    items: servers.map((server, order) => ({
      id: `n:${hashText(server.name)}`,
      title: server.name,
      detail: countOf(server.tools, 'tool'),
      tokens: server.tokens,
      order,
      path: null,
      disk: null,
      isNumbered: false,
      markup: 'text' as const,
      loaded: null,
      count: server.tools,
    })),
    note: null,
    ...(figure > 0 ? { categoryTokens: figure } : {}),
  }
}

/** The items of one segment, or the servers that are not loaded. */
export function buildItems(segment: ContextBreakdownListId, data: ItemData): ItemSet {
  if (!isSegmentList(segment)) {
    return serverItems(data)
  }
  if (segment === 'conversation') {
    return { items: [], note: 'The messages could not be read when measured, so the conversation is one segment.' }
  }
  if (isBaseline(segment)) {
    return baselineItems(segment, data)
  }

  return conversationItems(segment as SplitId, data)
}

/** Largest first (ties keep their order: older first), newest first, or most tools first (then largest). */
export function sortItems(items: readonly Item[], sort: ContextBreakdownSort): Item[] {
  return [...items].sort((a, b) =>
    sort === 'newest'
      ? b.order - a.order
      : sort === 'tools'
        ? (b.count ?? 0) - (a.count ?? 0) || b.tokens - a.tokens || a.order - b.order
        : b.tokens - a.tokens || a.order - b.order,
  )
}

/** Which part of a row is the item's path, so a narrow pane cuts its head. */
function pathIn(item: Item): ContextBreakdownRow['pathIn'] {
  if (item.path === null) {
    return null
  }
  const short = shortenPath(item.path)
  if (item.title === short) {
    return 'title'
  }

  return item.detail === short ? 'detail' : null
}

/** Whether the item has text to show at level 3. */
export function opens(item: Item): boolean {
  return item.loaded !== null || item.disk !== null
}

function rowOf(item: Item): ContextBreakdownRow {
  return {
    id: item.id,
    title: item.title,
    detail: item.detail,
    pathIn: pathIn(item),
    tokens: item.tokens,
    isOpenable: opens(item),
  }
}

/**
 * Whether the list can sort, and the order it shows: `sort` where it can,
 * else its only one. The servers that are not loaded sort largest first or
 * most tools first; with no token figure for any of them, only by their tools.
 */
function orderOf(segment: ContextBreakdownListId, set: ItemSet, sort: ContextBreakdownSort) {
  const isServers = segment === NOT_LOADED
  const sortable = isServers ? set.items.some(item => item.tokens > 0) : canSort(segment)
  const order: ContextBreakdownSort = sortable ? sort : isServers ? 'tools' : 'size'

  return { sortable, order }
}

/**
 * Where the item `id` stands in the list, in the order the list shows: n and
 * p step to the nearest item that opens, past the rows that do not. Null
 * when the set does not hold the item.
 */
export function placeOf(
  segment: ContextBreakdownListId,
  set: ItemSet,
  sort: ContextBreakdownSort,
  id: string,
): ContextBreakdownPlace | null {
  const sorted = sortItems(set.items, orderOf(segment, set, sort).order)
  const index = sorted.findIndex(item => item.id === id)
  if (index < 0) {
    return null
  }
  const prev = sorted.slice(0, index).reverse().find(opens)
  const next = sorted.slice(index + 1).find(opens)

  return { index, prev: prev?.id ?? null, next: next?.id ?? null }
}

/** The page of the list that holds the item at `place`. */
export function pageOf(place: ContextBreakdownPlace): number {
  return Math.floor(place.index / LIST_PAGE_ROWS)
}

/** One page of a segment's items, ready to store and draw, in the order `orderOf` gives. */
export function listOf(
  segment: ContextBreakdownListId,
  set: ItemSet,
  sort: ContextBreakdownSort,
  page: number,
): ContextBreakdownList {
  const isServers = segment === NOT_LOADED
  const { sortable, order } = orderOf(segment, set, sort)
  const sorted = sortItems(set.items, order)
  const pages = Math.max(1, Math.ceil(sorted.length / LIST_PAGE_ROWS))
  const index = Math.min(Math.max(0, Math.floor(page)), pages - 1)
  const shown = sorted.slice(index * LIST_PAGE_ROWS, (index + 1) * LIST_PAGE_ROWS)
  const tokens = sorted.reduce((sum, item) => sum + item.tokens, 0)
  const shownTokens = shown.reduce((sum, item) => sum + item.tokens, 0)

  return {
    segment,
    sort: order,
    canSort: sortable,
    page: index,
    pages,
    rows: shown.map(rowOf),
    items: sorted.length,
    tokens,
    ...(isServers ? { tools: sorted.reduce((sum, item) => sum + (item.count ?? 0), 0) } : {}),
    ...(set.categoryTokens === undefined ? {} : { categoryTokens: set.categoryTokens }),
    hiddenItems: sorted.length - shown.length,
    hiddenTokens: tokens - shownTokens,
    note: set.note,
  }
}
