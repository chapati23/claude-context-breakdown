// Sorts the conversation's content blocks (the API form of the messages)
// into conversation segments and counts their characters.

import type { ContextBreakdownConversationId } from '../types'
import { NO_KEYS, baselinePart } from './listing'
import type { BaselineKeys } from './listing'
import { SPLIT_IDS } from './segments'

export type SplitId = Exclude<ContextBreakdownConversationId, 'conversation'>

/** One content block as `$.session.messages({ as: 'api' })` hands it over. */
export type BlockLike = {
  type: string
  [field: string]: unknown
}

export type MessageLike = {
  role: string
  content: readonly BlockLike[] | string
}

export type ConversationChars = Record<SplitId, number>

/**
 * The size given to an image: 6,000 characters, about 1,500 tokens at four
 * characters a token, near what a one-megapixel image costs. Base64 length
 * says little about tokens, which follow the pixel count.
 */
export const IMAGE_CHARS = 6000

/** A PDF page is sized like an image; pages are guessed from the bytes. */
const DOCUMENT_BYTES_PER_PAGE = 75_000

/** A command line or shell line the person typed. */
const PROMPT_MARKERS = ['<command-name>', '<bash-input>']

/**
 * Blocks that open with these are Claude Code's, not typed: the caveat it
 * puts before a local command, and the output of that command or of a
 * shell line.
 */
const OUTPUT_HEADS = [
  '<local-command-caveat>',
  '<local-command-stdout>',
  '<local-command-stderr>',
  '<bash-stdout>',
  '<bash-stderr>',
]

/** Whether a user text block is a local command's caveat or output. */
export function isCommandOutput(text: string): boolean {
  const head = text.trimStart()

  return OUTPUT_HEADS.some(tag => head.startsWith(tag))
}

export function emptyChars(): ConversationChars {
  const out = {} as ConversationChars
  for (const id of SPLIT_IDS) {
    out[id] = 0
  }

  return out
}

/** Which segment a user-role text block belongs to, by its known renderings. */
export function classifyUserText(text: string): SplitId {
  const head = text.trimStart()
  if (head.startsWith('<system-reminder>')) {
    return 'injections'
  }
  // Checked before the other tags, which a command's output may quote.
  if (isCommandOutput(text)) {
    return 'injections'
  }
  if (text.includes('<task-notification>')) {
    return 'task-reports'
  }
  if (head.startsWith('Base directory for this skill:')) {
    return 'skill-bodies'
  }
  if (head.startsWith('This session is being continued from a previous conversation')) {
    return 'compaction-summary'
  }
  // A slash command's line or a shell line is the person's own, even where
  // its arguments quote a hook's tag. A block that holds the line and its
  // output together counts as the line.
  if (PROMPT_MARKERS.some(marker => text.includes(marker))) {
    return 'prompts'
  }
  if (text.includes('<user-prompt-submit-hook>')) {
    return 'injections'
  }

  return 'prompts'
}

function stringLength(value: unknown): number {
  return typeof value === 'string' ? value.length : 0
}

function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

function documentChars(block: BlockLike): number {
  const source = block.source as { type?: unknown; data?: unknown } | undefined
  if (source?.type === 'text') {
    return stringLength(source.data)
  }
  if (source?.type === 'base64' && typeof source.data === 'string') {
    const bytes = (source.data.length * 3) / 4
    const pages = Math.max(1, Math.ceil(bytes / DOCUMENT_BYTES_PER_PAGE))

    return pages * IMAGE_CHARS
  }

  return IMAGE_CHARS
}

/** The characters a block adds to the window, or its stand-in size. */
export function blockChars(block: BlockLike): number {
  switch (block.type) {
    case 'text':
      return stringLength(block.text)
    case 'thinking':
      return stringLength(block.thinking)
    case 'redacted_thinking':
      return stringLength(block.data)
    case 'tool_use':
      return stringLength(block.name) + jsonLength(block.input)
    case 'image':
      return IMAGE_CHARS
    case 'document':
      return documentChars(block)
    case 'tool_result': {
      const content = block.content
      if (typeof content === 'string') {
        return content.length
      }
      if (Array.isArray(content)) {
        return content.reduce<number>(
          (sum, inner) =>
            sum + (inner && typeof inner === 'object' ? blockChars(inner as BlockLike) : 0),
          0,
        )
      }

      return 0
    }
    default:
      return jsonLength(block)
  }
}

/**
 * A block's segment and the characters it adds there. `outputOf` names the
 * local command whose output the block is, when only its place tells so.
 */
export type SortedBlock = { id: SplitId; chars: number; outputOf?: string }

/**
 * The command a local command's line names, or null when the block is not
 * one. Claude Code writes a local command's line with `<command-name>`
 * first; a prompt command or a skill opens with `<command-message>`, and its
 * next block is the prompt it expands to, which stays as it is.
 */
export function localCommandOf(text: string): string | null {
  const head = text.trimStart()
  if (!head.startsWith('<command-name>')) {
    return null
  }
  const name = /^<command-name>([\s\S]*?)<\/command-name>/.exec(head)?.[1]?.trim() ?? ''
  if (name === '') {
    return null
  }

  return name.startsWith('/') ? name : `/${name}`
}

/**
 * Sorts the blocks of one message. A local command's output can come with
 * no tag at all (the API form gives `/context`'s report as plain Markdown):
 * a block of plain text right after a local command's line, in the same
 * message, is that command's output, not text the person typed.
 */
export function sortMessage(
  role: string,
  blocks: readonly BlockLike[],
  keys: BaselineKeys = NO_KEYS,
): (SortedBlock | null)[] {
  let command: string | null = null

  return blocks.map(block => {
    const sorted = sortBlock(role, block, keys)
    const after = command
    command = null
    if (sorted === null || role === 'assistant' || block.type !== 'text' || sorted.id !== 'prompts') {
      return sorted
    }
    const text = typeof block.text === 'string' ? block.text : ''
    const line = localCommandOf(text)
    if (line !== null) {
      command = line
      return sorted
    }
    if (after !== null && !PROMPT_MARKERS.some(marker => text.includes(marker))) {
      return { id: 'injections', chars: sorted.chars, outputOf: after }
    }

    return sorted
  })
}

/**
 * Which segment one block belongs to and how many of its characters count
 * there, or null for baseline content. Reminders the baseline counts already
 * (memory files, the skills and MCP listings, custom agents' entries) are
 * left out; a block that holds other text too counts only that text.
 */
export function sortBlock(role: string, block: BlockLike, keys: BaselineKeys = NO_KEYS): SortedBlock | null {
  if (role === 'assistant') {
    return { id: 'claude-output', chars: blockChars(block) }
  }
  if (block.type === 'tool_result') {
    return { id: 'tool-results', chars: blockChars(block) }
  }
  if (block.type === 'text') {
    const text = stringLength(block.text) > 0 ? (block.text as string) : ''
    const baseline = baselinePart(text, keys)
    if (baseline.isWhole) {
      return null
    }

    return { id: classifyUserText(text), chars: text.length - baseline.chars }
  }

  // Images, documents and anything else a person attaches.
  return { id: 'prompts', chars: blockChars(block) }
}

/** Which segment one block belongs to, or null for baseline content. */
export function classifyBlock(role: string, block: BlockLike, keys: BaselineKeys = NO_KEYS): SplitId | null {
  return sortBlock(role, block, keys)?.id ?? null
}

/** Characters per conversation segment over the whole conversation. */
export function countConversation(
  messages: readonly MessageLike[],
  keys: BaselineKeys = NO_KEYS,
): ConversationChars {
  const out = emptyChars()
  for (const message of messages) {
    const blocks: readonly BlockLike[] =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : Array.isArray(message.content)
          ? message.content
          : []
    const valid = blocks.filter(block => block && typeof block === 'object')
    for (const sorted of sortMessage(message.role, valid, keys)) {
      if (sorted !== null) {
        out[sorted.id] += sorted.chars
      }
    }
  }

  return out
}

export function totalChars(chars: ConversationChars): number {
  return SPLIT_IDS.reduce((sum, id) => sum + chars[id], 0)
}
