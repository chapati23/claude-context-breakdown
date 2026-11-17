// Baseline content that Claude Code delivers as reminders in the
// conversation: the skills listing, the MCP server instructions, the agent
// types and the memory files. The breakdown counts these in its own baseline
// categories and reconciles Messages to the API usage, so Messages holds what
// is left. Counting them again as conversation text would count them twice.

/** The message shape of classify.ts, restated so the two files do not import each other. */
type MessageLike = {
  role: string
  content: readonly { type: string; [field: string]: unknown }[] | string
}

/** What the breakdown counts in the baseline, as the conversation names it. */
export type BaselineKeys = {
  /** Memory files: their "Contents of <path>" sections. */
  memoryPaths: readonly string[]
  /** Custom agents: their entries in the agent-types listing. */
  agentTypes: readonly string[]
}

export const NO_KEYS: BaselineKeys = { memoryPaths: [], agentTypes: [] }

/** The keys of one breakdown. */
export function baselineKeys(breakdown: {
  memoryFiles?: readonly { path: string }[] | null
  agents?: readonly { agentType: string }[] | null
} | null): BaselineKeys {
  return {
    memoryPaths: (breakdown?.memoryFiles ?? []).map(file => file.path),
    agentTypes: (breakdown?.agents ?? []).map(agent => agent.agentType),
  }
}

export type ListingKind = 'skills' | 'mcp' | 'agents'

/**
 * The first line of each listing. A reminder is a listing only when it opens
 * with this line, so a reminder that names a listing in running text counts.
 */
const HEADS: readonly (readonly [ListingKind, string])[] = [
  ['skills', 'The following skills are available for use with the Skill tool'],
  ['mcp', '# MCP Server Instructions'],
  ['agents', 'Available agent types for the Agent tool'],
]

const OPEN = '<system-reminder>'
const CLOSE = '</system-reminder>'

/** One reminder inside a text block: where it starts and ends, its inner text, and whether it is closed. */
export type ReminderSpan = { start: number; end: number; body: string; isClosed: boolean }

/** The reminders of a text block, in order; an unclosed one runs to the end. */
export function reminderSpans(text: string): ReminderSpan[] {
  const out: ReminderSpan[] = []
  let from = 0
  for (;;) {
    const start = text.indexOf(OPEN, from)
    if (start === -1) {
      return out
    }
    const close = text.indexOf(CLOSE, start + OPEN.length)
    const end = close === -1 ? text.length : close + CLOSE.length
    out.push({ start, end, body: text.slice(start + OPEN.length, close === -1 ? text.length : close), isClosed: close !== -1 })
    from = end
  }
}

/** Which listing a reminder's inner text is, by its first line. */
export function listingKind(body: string): ListingKind | null {
  const head = body.trimStart()

  return HEADS.find(([, line]) => head.startsWith(line))?.[0] ?? null
}

function lines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/** Whether a line opens the entry of `name`: "- name: …" or "- name:" alone. */
function isEntryOf(line: string, name: string): boolean {
  const prefix = `- ${name}:`

  // The colon must end the name, so "a" does not match "- a:b: …".
  return line.startsWith(prefix) && (line.length === prefix.length || line[prefix.length] === ' ')
}

/**
 * The entry of `name` in a listing: its "- name: …" line and the lines that
 * continue it, up to the next entry or a blank line; null when not listed.
 */
export function entryOf(body: string, name: string): string | null {
  if (name === '') {
    return null
  }
  const all = lines(body)
  const head = all.findIndex(line => isEntryOf(line, name))
  if (head === -1) {
    return null
  }
  let end = head + 1
  while (end < all.length && all[end]!.trim() !== '' && !all[end]!.startsWith('- ')) {
    end += 1
  }

  return all.slice(head, end).join('\n')
}

/** Whether a reminder carries a memory file: a "Contents of <path> (…):" line. */
function isMemoryReminder(body: string, paths: readonly string[]): boolean {
  if (paths.length === 0 || !body.includes('Contents of ')) {
    return false
  }

  return lines(body).some(line =>
    paths.some(path => line.startsWith(`Contents of ${path}`) && line.trimEnd().endsWith(':')),
  )
}

/**
 * The text after a skills listing's own lines: from the first blank line
 * after an entry. Entries and the lines that continue them hold no blank
 * line in the listings seen; a note after the list counts as conversation.
 */
function afterSkills(body: string): string {
  let offset = 0
  let hasEntry = false
  for (const line of body.split('\n')) {
    if (hasEntry && line.trim() === '') {
      return body.slice(offset)
    }
    if (line.startsWith('- ')) {
      hasEntry = true
    }
    offset += line.length + 1
  }

  return ''
}

/** The characters of one reminder that the baseline counts. */
function spanBaseline(span: ReminderSpan, keys: BaselineKeys): number {
  // An unclosed reminder is no listing: its end is not known, and treating
  // it as one would drop the text after it from every count.
  if (!span.isClosed) {
    return 0
  }
  const whole = span.end - span.start
  if (isMemoryReminder(span.body, keys.memoryPaths)) {
    return whole
  }
  const kind = listingKind(span.body)
  if (kind === 'skills') {
    const rest = afterSkills(span.body)

    return rest.trim() === '' ? whole : whole - rest.length
  }
  // The MCP instructions hold blank lines and headings of their own, so no
  // end of the listing can be told apart from a note after it: all of it.
  if (kind === 'mcp') {
    return whole
  }
  if (kind === 'agents') {
    // Only custom agents have a baseline figure; the header, the built-in
    // types and the note after the list stay conversation text.
    return keys.agentTypes.reduce((sum, type) => {
      const entry = entryOf(span.body, type)

      return entry === null ? sum : sum + entry.length + 1
    }, 0)
  }

  return 0
}

/** How much of a user text block the baseline counts already. */
export type BaselinePart = {
  /** Characters counted in the baseline. */
  chars: number
  /** Nothing but white space is left: the block is baseline. */
  isWhole: boolean
}

export function baselinePart(text: string, keys: BaselineKeys): BaselinePart {
  // Claude Code sends a reminder as a block that opens with the tag. A
  // reminder further in is text a person pasted: it is in the window, and
  // it counts.
  if (!text.trimStart().startsWith(OPEN)) {
    return { chars: 0, isWhole: false }
  }
  let chars = 0
  let rest = ''
  let from = 0
  for (const span of reminderSpans(text)) {
    const part = Math.min(spanBaseline(span, keys), span.end - span.start)
    rest += text.slice(from, span.start)
    if (part < span.end - span.start) {
      rest += 'x'
    }
    chars += part
    from = span.end
  }
  rest += text.slice(from)
  if (chars === 0) {
    return { chars: 0, isWhole: false }
  }
  const isWhole = rest.trim() === ''

  return { chars: isWhole ? text.length : chars, isWhole }
}

function textBlocks(messages: readonly MessageLike[]): string[] {
  const out: string[] = []
  for (const message of messages) {
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      continue
    }
    for (const block of message.content) {
      if (block && block.type === 'text' && typeof block.text === 'string' && block.text.includes(OPEN)) {
        out.push(block.text)
      }
    }
  }

  return out
}

/** The inner text of every listing of one kind in the conversation, oldest first. */
export function listingBodies(messages: readonly MessageLike[], kind: ListingKind): string[] {
  const out: string[] = []
  for (const text of textBlocks(messages)) {
    for (const span of reminderSpans(text)) {
      if (listingKind(span.body) === kind) {
        out.push(span.body.replace(/^\s+/, '').replace(/\s+$/, ''))
      }
    }
  }

  return out
}

/** The newest entry among several names for one thing, or null. */
export function newestEntry(bodies: readonly string[], names: readonly string[]): string | null {
  for (let i = bodies.length - 1; i >= 0; i -= 1) {
    for (const name of names) {
      const entry = entryOf(bodies[i]!, name)
      if (entry !== null) {
        return entry
      }
    }
  }

  return null
}
