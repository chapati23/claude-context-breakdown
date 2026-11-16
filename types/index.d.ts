// The state contract of context-breakdown: what the mod keeps in `$.state`.
// Self-contained on purpose (no import): the engine reads it as written.

/** A baseline segment: content loaded before the first prompt. */
export type ContextBreakdownBaselineId =
  | 'system'
  | 'mcp'
  | 'global-instructions'
  | 'project-instructions'
  | 'auto-memory'
  | 'skills-agents'
  | 'other'

/**
 * A conversation segment: content added after the first prompt. `conversation`
 * stands for all of them when the messages could not be read.
 */
export type ContextBreakdownConversationId =
  | 'compaction-summary'
  | 'tool-results'
  | 'skill-bodies'
  | 'task-reports'
  | 'injections'
  | 'prompts'
  | 'claude-output'
  | 'conversation'

export type ContextBreakdownSegmentId =
  | ContextBreakdownBaselineId
  | ContextBreakdownConversationId

/** One segment's estimated tokens. */
export type ContextBreakdownSegment = {
  id: ContextBreakdownSegmentId
  tokens: number
}

/** One breakdown category of kind `deferred`: listed, not in the window. */
export type ContextBreakdownDeferred = {
  name: string
  tokens: number
}

/** One measurement, ready to draw. */
export type ContextBreakdownSnapshot = {
  /** The window in tokens: the smaller of the compaction window and the model's. */
  window: number
  /** The compaction reserve (the breakdown's `buffer` category), in tokens. */
  reserve: number
  /** Baseline segments in bar order. */
  baseline: ContextBreakdownSegment[]
  /** Conversation segments in bar order. */
  conversation: ContextBreakdownSegment[]
  /** Categories that are not loaded into the window. */
  deferred: ContextBreakdownDeferred[]
  /**
   * True while the conversation is estimated from characters, after a
   * compaction and before the next model response.
   */
  isEstimate: boolean
  /** The status-line token figure that was stale when the estimate began. */
  staleTokens: number | null
  /** Characters per token from the last good measurement, if any. */
  charsPerToken: number | null
  /** When it was measured, in `$.clock.now()` milliseconds. */
  measuredAt: number
}

/** How level 2 orders its items: largest first, or newest first. */
export type ContextBreakdownSort = 'size' | 'newest'

/** Which text level 3 shows: as the model received it, or the file now. */
export type ContextBreakdownSource = 'loaded' | 'disk'

/** One row of level 2's visible page. */
export type ContextBreakdownRow = {
  /** A short reference a handler resolves against a fresh item list. */
  id: string
  title: string
  /** A dim second part: the server, the call, the source. */
  detail: string
  /** The part that is a path: a narrow pane cuts its head, so the file name stays. */
  pathIn: 'title' | 'detail' | null
  tokens: number
  /** Whether the item has text to show at level 3. */
  isOpenable: boolean
}

/** Level 2: one page of the items of one segment. */
export type ContextBreakdownList = {
  segment: ContextBreakdownSegmentId
  sort: ContextBreakdownSort
  /** False for baseline segments, which have no time order. */
  canSort: boolean
  /** 0-based. */
  page: number
  pages: number
  rows: ContextBreakdownRow[]
  /** All items of the segment and their tokens. */
  items: number
  tokens: number
  /** The items and tokens on the pages not shown. */
  hiddenItems: number
  hiddenTokens: number
  /** A line for an empty or unreadable segment. */
  note: string | null
}

/** Level 3: one page of the text of one item. */
export type ContextBreakdownContent = {
  id: string
  title: string
  tokens: number
  /** The file behind the item, absolute, or null. */
  path: string | null
  source: ContextBreakdownSource
  /** Whether `v` switches between as loaded and on disk. */
  canToggle: boolean
  /** True only when the comparison is sure the file changed since it loaded. */
  isChanged: boolean
  note: string | null
  /** 0-based. */
  page: number
  pages: number
  /** The first line's number for the gutter, or null for no gutter. */
  startLine: number | null
  /** The visible page only. */
  text: string
  /** A path the highlighter infers the language from, or null for plain text. */
  language: string | null
  /** The answer to the last copy or mention, until the next move. */
  notice: string | null
}

/**
 * What the pane shows. Only the visible page is kept; a handler rebuilds the
 * rest from the conversation and the breakdown. `seq` counts moves, so a slow
 * move does not overwrite a newer one. `gen` counts rebuilds after a
 * measurement, so a move that read older messages runs again on the new ones.
 */
export type ContextBreakdownView =
  | {
      seq: number
      gen: number
      level: 1
      /** Why the pane fell back here, e.g. an open item left the context. */
      note?: string
    }
  | { seq: number; gen: number; level: 2; list: ContextBreakdownList }
  | { seq: number; gen: number; level: 3; list: ContextBreakdownList; item: ContextBreakdownContent }

declare module 'claude-code' {
  interface PluginState {
    'context-breakdown': {
      snapshot: Shaped<ContextBreakdownSnapshot | null>
      view: Shaped<ContextBreakdownView>
    }
  }
}
