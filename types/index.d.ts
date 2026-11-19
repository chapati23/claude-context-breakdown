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

/**
 * One MCP server's tools that are not loaded: how many, and the estimated
 * tokens their schemas take once loaded.
 */
export type ContextBreakdownServer = {
  /** The server's name, without control characters. */
  name: string
  tools: number
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
  /** The MCP servers with tools that are not loaded, largest first. */
  notLoadedServers: ContextBreakdownServer[]
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

/**
 * What a level 2 list shows: the items of one segment, or `not-loaded`, the
 * MCP servers whose tools are not loaded.
 */
export type ContextBreakdownListId = ContextBreakdownSegmentId | 'not-loaded'

/**
 * How level 2 orders its items: largest first, newest first, or (the
 * `not-loaded` list) most tools first.
 */
export type ContextBreakdownSort = 'size' | 'newest' | 'tools'

/** Which text level 3 shows: as the model received it, or the file now. */
export type ContextBreakdownSource = 'loaded' | 'disk'

/**
 * How level 3 draws the text: as formatted Markdown, or raw, the exact
 * characters with line numbers.
 */
export type ContextBreakdownFormat = 'formatted' | 'raw'

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

/** Level 2: one page of the items of one segment, or of the servers not loaded. */
export type ContextBreakdownList = {
  segment: ContextBreakdownListId
  sort: ContextBreakdownSort
  /**
   * False for baseline segments, which have no time order, and for the
   * servers when Claude Code gives no token figure for them.
   */
  canSort: boolean
  /** 0-based. */
  page: number
  pages: number
  rows: ContextBreakdownRow[]
  /** All items of the segment and their tokens. */
  items: number
  tokens: number
  /** The `not-loaded` list only: the tools of all its servers. */
  tools?: number
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
  /**
   * The view shown. It holds while the item is open (pages, `v`, a refresh);
   * an item that opens starts in its own default.
   */
  format: ContextBreakdownFormat
  /** 0-based, in the pages of the view shown. */
  page: number
  pages: number
  /**
   * Where the page lies in the whole text, in the raw view's lines (1-based):
   * the first and last line it shows, and the lines there are. The formatted
   * view maps its own lines onto these, so both views say the same.
   */
  firstLine: number
  lastLine: number
  lines: number
  /** The first line's number for the gutter, or null for no gutter. */
  startLine: number | null
  /** The visible page only: Markdown in the formatted view. */
  text: string
  /** A path the highlighter infers the language from, or null for plain text. */
  language: string | null
  /** The answer to the last copy or mention, until the next move. */
  notice: string | null
  /**
   * True when k crossed back into this page from the next one: the page
   * opens at its end, and the ring starts on the control below the text.
   */
  atEnd: boolean
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
      /** The list b came back from: its row takes the focus ring. */
      from?: ContextBreakdownListId
    }
  | {
      seq: number
      gen: number
      level: 2
      list: ContextBreakdownList
      /** The item b came back from: its row takes the focus ring when it is on the page. */
      from?: string
    }
  | { seq: number; gen: number; level: 3; list: ContextBreakdownList; item: ContextBreakdownContent }

/**
 * The bar Button that holds the band's keyboard focus ring, so the band can
 * name it. `load` ties it to one load of the mod's code: a value an earlier
 * load wrote (before a reload) is ignored. `hold` names the focus move that
 * wrote it: the timer that ends the chip clears only its own move's value.
 */
export type ContextBreakdownFocus = {
  key: string
  load: string
  hold: number
}

declare module 'claude-code' {
  interface PluginState {
    'context-breakdown': {
      snapshot: Shaped<ContextBreakdownSnapshot | null>
      view: Shaped<ContextBreakdownView>
      /** The Claude Code theme's name (the `/config` row `theme`), or null before it is read. */
      theme: Shaped<string | null>
      focus: Shaped<ContextBreakdownFocus | null>
      /**
       * The key of the pane's element that holds its focus ring, as the last
       * `ui.focus` event named it, so the pane can draw the row under the ring
       * in one highlight. Empty: the ring is on one of the engine's own stops.
       * Null: no event yet for the tree that is drawn. Not tied to one load of
       * the code: the engine keeps the ring through a reload, and the keys
       * stay the same.
       */
      ring: Shaped<string | null>
    }
  }
}
