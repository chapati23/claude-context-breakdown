// Builds the snapshot the bar and the pane draw from, out of one usage
// breakdown and the conversation's messages.

import type {
  ContextBreakdownBase,
  ContextBreakdownSegment,
  ContextBreakdownSegmentId,
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

  return SPLIT_IDS.map((id, index) => ({ id, tokens: parts[index] ?? 0, chars: chars[id] }))
}

/** Estimates conversation tokens from characters with a known ratio. */
export function estimateConversation(
  chars: ConversationChars,
  charsPerToken: number,
): ContextBreakdownSegment[] {
  const ratio = charsPerToken > 0 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN

  return SPLIT_IDS.map(id => ({ id, tokens: Math.round(chars[id] / ratio), chars: chars[id] }))
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

/**
 * The base for level 1's column `added`: the tokens per segment of the
 * measurement at the person's prompt. None from an estimate, whose figures
 * were not measured, and none before the first measurement.
 */
export function baseOf(snapshot: ContextBreakdownSnapshot | null): ContextBreakdownBase | null {
  if (snapshot === null || snapshot.isEstimate) {
    return null
  }

  return {
    segments: [...snapshot.baseline, ...snapshot.conversation].map(({ id, tokens, chars }) =>
      chars === undefined ? { id, tokens } : { id, tokens, chars },
    ),
  }
}

/** The tokens each segment gained since the base; a segment that did not grow is not in it. */
export type Added = Partial<Record<ContextBreakdownSegmentId, number>>

/**
 * What each segment of `snapshot` gained since `base`, above zero only; a
 * segment the base does not hold counts from zero. Null when there is no
 * column to show: no base, an estimate, nothing grew, or fewer tokens in use
 * than at the base (a compaction or a rewind that raised no event, after
 * which the base no longer holds). Null too when one side has the
 * conversation as one segment and the other has it split: their segments
 * do not compare.
 *
 * The split conversation segments share the measured tokens by characters,
 * so a segment's tokens move when another segment grows. Such a segment
 * counts only when its own characters grew too.
 */
export function addedSince(base: ContextBreakdownBase | null, snapshot: ContextBreakdownSnapshot): Added | null {
  if (base === null || snapshot.isEstimate || usedTokens(snapshot) < sumTokens(base.segments)) {
    return null
  }
  const now = [...snapshot.baseline, ...snapshot.conversation]
  const isWhole = (segments: readonly ContextBreakdownSegment[]) => segments.some(segment => segment.id === 'conversation')
  if (isWhole(base.segments) !== isWhole(now)) {
    return null
  }
  const before = new Map(base.segments.map(segment => [segment.id, segment]))
  const added: Added = {}
  let grew = false
  for (const segment of now) {
    const old = before.get(segment.id)
    const gain = segment.tokens - (old?.tokens ?? 0)
    const hasGrown = segment.chars === undefined || segment.chars > (old?.chars ?? 0)
    if (gain > 0 && hasGrown) {
      added[segment.id] = gain
      grew = true
    }
  }

  return grew ? added : null
}
