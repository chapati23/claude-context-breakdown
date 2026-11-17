import { describe, expect, test } from 'claude-code/testing'

import type { MessageLike } from '../hooks/classify'
import {
  baselineKeys,
  baselinePart,
  entryOf,
  listingBodies,
  listingKind,
  newestEntry,
  reminderSpans,
} from '../hooks/listing'
import { AGENTS_REMINDER, ENVIRONMENT_REMINDER, MCP_REMINDER, OPENING, REVIEWER_ENTRY, SKILLS_REMINDER, richBreakdown } from './fixtures'

const KEYS = { memoryPaths: ['/home/user/project/CLAUDE.md'], agentTypes: ['reviewer'] }

describe('reminderSpans', () => {
  test('finds each reminder of a block; an unclosed one runs to the end', () => {
    const text = '<system-reminder>a</system-reminder>\n<system-reminder>b'
    expect(reminderSpans(text)).toEqual([
      { start: 0, end: 36, body: 'a', isClosed: true },
      { start: 37, end: text.length, body: 'b', isClosed: false },
    ])
    expect(reminderSpans('plain')).toEqual([])
  })
})

describe('listingKind', () => {
  test('knows a listing by the line it opens with', () => {
    expect(listingKind(reminderSpans(SKILLS_REMINDER)[0]!.body)).toBe('skills')
    expect(listingKind(reminderSpans(MCP_REMINDER)[0]!.body)).toBe('mcp')
    expect(listingKind(reminderSpans(AGENTS_REMINDER)[0]!.body)).toBe('agents')
    expect(listingKind(reminderSpans(ENVIRONMENT_REMINDER)[0]!.body)).toBeNull()
    expect(listingKind('\nNote: # MCP Server Instructions follow later.')).toBeNull()
  })
})

describe('entryOf', () => {
  const body = reminderSpans(SKILLS_REMINDER)[0]!.body

  test('takes the entry line and the lines that continue it', () => {
    expect(entryOf(body, 'demo-skill')).toBe('- demo-skill: Runs the demo steps.\nTRIGGER when the user asks for a demo.')
    expect(entryOf(body, 'tools:helper')).toBe('- tools:helper: Helps with the tools.')
  })

  test('the name must end at its colon', () => {
    expect(entryOf(body, 'tools')).toBeNull()
    expect(entryOf(body, 'demo')).toBeNull()
    expect(entryOf(body, '')).toBeNull()
    expect(entryOf('- solo:', 'solo')).toBe('- solo:')
  })

  test('the newest listing that has the entry wins', () => {
    const old = '- reviewer: Old text.'
    expect(newestEntry([old, `x\n${REVIEWER_ENTRY}`], ['reviewer'])).toBe(REVIEWER_ENTRY)
    expect(newestEntry([old, 'x'], ['other', 'reviewer'])).toBe(old)
    expect(newestEntry([], ['reviewer'])).toBeNull()
  })
})

describe('baselinePart', () => {
  test('a block that is only a listing is baseline', () => {
    expect(baselinePart(SKILLS_REMINDER, KEYS)).toEqual({ chars: SKILLS_REMINDER.length, isWhole: true })
    expect(baselinePart(`\n${MCP_REMINDER}\n`, KEYS)).toEqual({ chars: MCP_REMINDER.length + 2, isWhole: true })
  })

  test('other reminders and plain text are not', () => {
    expect(baselinePart(ENVIRONMENT_REMINDER, KEYS)).toEqual({ chars: 0, isWhole: false })
    expect(baselinePart('Hello', KEYS)).toEqual({ chars: 0, isWhole: false })
  })

  test('a listing pasted into a typed prompt counts: only a block that opens with the tag is a reminder', () => {
    expect(baselinePart(`Why is this here?\n${SKILLS_REMINDER}`, KEYS)).toEqual({ chars: 0, isWhole: false })
  })

  test('a memory file needs its own header line, not a mention', () => {
    const memory = '<system-reminder>\nContents of /home/user/project/CLAUDE.md (project instructions):\n\nRules.\n</system-reminder>'
    expect(baselinePart(memory, KEYS).isWhole).toBe(true)
    const mention = '<system-reminder>\nThe hook read Contents of /home/user/project/CLAUDE.md and found nothing.\n</system-reminder>'
    expect(baselinePart(mention, KEYS).chars).toBe(0)
  })

  test('a note after the skills list in the same reminder still counts', () => {
    const note = '\n\nIMPORTANT: an unrelated note.\n'
    const mixed = SKILLS_REMINDER.replace('\n</system-reminder>', `${note}</system-reminder>`)
    // The listing ends with its last entry's line end; the blank line and the note count.
    expect(baselinePart(mixed, KEYS)).toEqual({ chars: mixed.length - (note.length - 1), isWhole: false })
    // Blank lines before the first entry are part of the listing.
    expect(baselinePart(SKILLS_REMINDER, KEYS).isWhole).toBe(true)
  })

  test('an unclosed reminder is never a listing, so nothing after it is lost', () => {
    const open = '<system-reminder>\nThe following skills are available for use with the Skill tool:\n- x: y\n\nPlease fix the test.'
    expect(baselinePart(open, KEYS)).toEqual({ chars: 0, isWhole: false })
    const memory = '<system-reminder>\nContents of /home/user/project/CLAUDE.md (project instructions):\n\nRules.'
    expect(baselinePart(memory, KEYS).chars).toBe(0)
  })

  test('the agent types lose only the custom agents’ entries', () => {
    expect(baselinePart(AGENTS_REMINDER, KEYS)).toEqual({ chars: REVIEWER_ENTRY.length + 1, isWhole: false })
    expect(baselinePart(AGENTS_REMINDER, { ...KEYS, agentTypes: [] }).chars).toBe(0)
  })
})

describe('listingBodies and keys', () => {
  test('reads the listings of the conversation without their tags', () => {
    const messages = OPENING as unknown as MessageLike[]
    const [skills] = listingBodies(messages, 'skills')
    expect(skills).toMatch(/^The following skills are available/)
    expect(skills).not.toContain('system-reminder')
    expect(listingBodies(messages, 'mcp')).toHaveLength(1)
    expect(listingBodies([{ role: 'assistant', content: [{ type: 'text', text: SKILLS_REMINDER }] }], 'skills')).toEqual([])
    // A listing pasted into a typed prompt is not the one Claude Code loaded.
    const pasted = [{ role: 'user', content: [{ type: 'text', text: `Why is this here?\n${SKILLS_REMINDER}` }] }] as MessageLike[]
    expect(listingBodies(pasted, 'skills')).toEqual([])
  })

  test('the keys come from the breakdown, and from nothing without one', () => {
    expect(baselineKeys(richBreakdown())).toEqual({
      memoryPaths: ['/home/user/project/CLAUDE.md', '/home/user/.claude/CLAUDE.md'],
      agentTypes: ['reviewer'],
    })
    expect(baselineKeys(null)).toEqual({ memoryPaths: [], agentTypes: [] })
  })
})
