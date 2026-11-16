// Sorts the conversation's content blocks (the API form of the messages)
// into conversation segments and counts their characters.

import type { ContextBreakdownConversationId } from '../types'
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

const PROMPT_MARKERS = ['<local-command-stdout>', '<command-name>', '<bash-input>', '<bash-stdout>']

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
  if (text.includes('<task-notification>')) {
    return 'task-reports'
  }
  if (head.startsWith('Base directory for this skill:')) {
    return 'skill-bodies'
  }
  if (head.startsWith('This session is being continued from a previous conversation')) {
    return 'compaction-summary'
  }
  // A slash command's line and output, or a shell line, is the person's own,
  // even where the output quotes a hook's tag.
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
 * The text of a reminder that carries a memory file's contents. Those files
 * are counted in the baseline already, so the conversation leaves them out.
 */
function isBaselineText(text: string, memoryPaths: readonly string[]): boolean {
  if (memoryPaths.length === 0 || !text.trimStart().startsWith('<system-reminder>')) {
    return false
  }

  return memoryPaths.some(path => text.includes(`Contents of ${path}`))
}

/** Which segment one block belongs to, or null for baseline content. */
export function classifyBlock(
  role: string,
  block: BlockLike,
  memoryPaths: readonly string[] = [],
): SplitId | null {
  if (role === 'assistant') {
    return 'claude-output'
  }
  if (block.type === 'tool_result') {
    return 'tool-results'
  }
  if (block.type === 'text') {
    const text = stringLength(block.text) > 0 ? (block.text as string) : ''
    if (isBaselineText(text, memoryPaths)) {
      return null
    }

    return classifyUserText(text)
  }

  // Images, documents and anything else a person attaches.
  return 'prompts'
}

/** Characters per conversation segment over the whole conversation. */
export function countConversation(
  messages: readonly MessageLike[],
  memoryPaths: readonly string[] = [],
): ConversationChars {
  const out = emptyChars()
  for (const message of messages) {
    const blocks: readonly BlockLike[] =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : Array.isArray(message.content)
          ? message.content
          : []
    for (const block of blocks) {
      if (!block || typeof block !== 'object') {
        continue
      }
      const id = classifyBlock(message.role, block, memoryPaths)
      if (id !== null) {
        out[id] += blockChars(block)
      }
    }
  }

  return out
}

export function totalChars(chars: ConversationChars): number {
  return SPLIT_IDS.reduce((sum, id) => sum + chars[id], 0)
}
