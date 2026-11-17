// Builds the snapshot the bar and the pane draw from, out of one usage
// breakdown and the conversation's messages.

import type {
  ContextBreakdownSegment,
  ContextBreakdownSnapshot,
} from '../types'
import { apportion, notLoadedServers, splitCategories } from './categories'
import type { BreakdownLike } from './categories'
import { countConversation, totalChars } from './classify'
import type { ConversationChars, MessageLike } from './classify'
import { baselineKeys } from './listing'
import { SPLIT_IDS } from './segments'

/** Characters per token when no measurement has given a ratio yet. */
export const DEFAULT_CHARS_PER_TOKEN = 4

/**
 * The most messages the API form holds (the newest ones). At this length
 * older messages may be missing, so their characters are not counted.
 */
export const MAX_API_MESSAGES = 4096

export type SnapshotBreakdown = BreakdownLike & {
  rawMaxTokens: number
}

/** A compaction that just ran: the token figure that is stale from now on. */
export type Compaction = {
  staleTokens: number | null
}

export type SnapshotInput = {
  breakdown: SnapshotBreakdown
  /** `context.window`: the model's window. */
  modelWindow: number
  /** `context.tokens` now: absent or stale right after a compaction. */
  contextTokens: number | undefined
  /** The conversation in API form, or null when it could not be read. */
  messages: readonly MessageLike[] | null
  previous: ContextBreakdownSnapshot | null
  compaction: Compaction | null
  now: number
}

/** The window: the compaction window when it is smaller than the model's. */
export function windowOf(rawMaxTokens: number, modelWindow: number): number {
  const sizes = [rawMaxTokens, modelWindow].filter(n => Number.isFinite(n) && n > 0)

  return sizes.length > 0 ? Math.min(...sizes) : 0
}

/** Shares the measured conversation tokens out by characters. */
export function splitConversation(
  messagesTokens: number,
  chars: ConversationChars | null,
): ContextBreakdownSegment[] {
  if (chars === null || (totalChars(chars) === 0 && messagesTokens > 0)) {
    return [{ id: 'conversation', tokens: messagesTokens }]
  }
  const parts = apportion(
    messagesTokens,
    SPLIT_IDS.map(id => chars[id]),
  )

  return SPLIT_IDS.map((id, index) => ({ id, tokens: parts[index] ?? 0 }))
}

/** Estimates conversation tokens from characters with a known ratio. */
export function estimateConversation(
  chars: ConversationChars,
  charsPerToken: number,
): ContextBreakdownSegment[] {
  const ratio = charsPerToken > 0 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN

  return SPLIT_IDS.map(id => ({ id, tokens: Math.round(chars[id] / ratio) }))
}

/**
 * Whether the usage figures still date from before the last compaction: the
 * status-line token figure is absent, or still the one it was then.
 */
export function isStale(contextTokens: number | undefined, staleTokens: number | null): boolean {
  return contextTokens === undefined || contextTokens === staleTokens
}

export function sumTokens(segments: readonly ContextBreakdownSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.tokens, 0)
}

/** The next snapshot, measured or estimated. */
export function nextSnapshot(input: SnapshotInput): ContextBreakdownSnapshot {
  const { breakdown, previous } = input
  const split = splitCategories(breakdown)
  const chars = input.messages === null ? null : countConversation(input.messages, baselineKeys(breakdown))
  const window = windowOf(breakdown.rawMaxTokens, input.modelWindow)

  let staleTokens: number | null = null
  let isEstimate = false
  if (input.compaction !== null) {
    staleTokens = input.compaction.staleTokens
    isEstimate = isStale(input.contextTokens, staleTokens)
  } else if (previous?.isEstimate === true) {
    staleTokens = previous.staleTokens
    isEstimate = isStale(input.contextTokens, staleTokens)
  }

  const base = {
    window,
    reserve: split.reserve,
    baseline: split.baseline,
    deferred: split.deferred,
    notLoadedServers: notLoadedServers(breakdown.mcpTools),
    measuredAt: input.now,
  }

  if (isEstimate) {
    const charsPerToken = previous?.charsPerToken ?? null

    return {
      ...base,
      // Unreadable messages leave nothing to estimate from; the old figure
      // is known to be wrong, so the conversation is left out until measured.
      conversation:
        chars === null
          ? [{ id: 'conversation', tokens: 0 }]
          : estimateConversation(chars, charsPerToken ?? DEFAULT_CHARS_PER_TOKEN),
      isEstimate: true,
      staleTokens,
      charsPerToken,
    }
  }

  const counted = chars === null ? 0 : totalChars(chars)
  // A cut list counts fewer characters than the Messages tokens cover, which
  // would give a ratio too low; the last whole one is kept instead.
  const isWhole = input.messages !== null && input.messages.length < MAX_API_MESSAGES

  return {
    ...base,
    conversation: splitConversation(split.messages, chars),
    isEstimate: false,
    staleTokens: null,
    charsPerToken:
      isWhole && counted > 0 && split.messages > 0
        ? counted / split.messages
        : (previous?.charsPerToken ?? null),
  }
}

/** Tokens in use: every segment of both groups. */
export function usedTokens(snapshot: ContextBreakdownSnapshot): number {
  return sumTokens(snapshot.baseline) + sumTokens(snapshot.conversation)
}

/** Free space: what the used content and the reserve leave of the window. */
export function freeTokens(snapshot: ContextBreakdownSnapshot): number {
  return Math.max(0, snapshot.window - usedTokens(snapshot) - snapshot.reserve)
}
