import { describe, expect, test } from 'claude-code/testing'

import type { MessageLike } from '../hooks/classify'
import {
  freeTokens,
  isStale,
  MAX_API_MESSAGES,
  nextSnapshot,
  sumTokens,
  usedTokens,
  windowOf,
} from '../hooks/snapshot'
import type { SnapshotBreakdown, SnapshotInput } from '../hooks/snapshot'
import { bandModel, rowText, totalLabel } from '../hooks/view'

const used = (name: string, tokens: number) => ({ name, tokens, kind: 'used' })

const breakdown = (messages: number): SnapshotBreakdown => ({
  rawMaxTokens: 200_000,
  categories: [
    used('System prompt', 6000),
    used('System tools', 14_000),
    used('Messages', messages),
    { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
    { name: 'MCP tools (deferred)', tokens: 9000, kind: 'deferred' },
  ],
  memoryFiles: [],
})

// 4,000 characters of tool result and 1,000 of Claude output.
const MESSAGES: MessageLike[] = [
  { role: 'user', content: [{ type: 'text', text: 'p'.repeat(1000) }] },
  { role: 'assistant', content: [{ type: 'text', text: 'c'.repeat(1000) }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'r'.repeat(3000) }] },
]

const input = (over: Partial<SnapshotInput>): SnapshotInput => ({
  breakdown: breakdown(1250),
  modelWindow: 200_000,
  contextTokens: 21_250,
  messages: MESSAGES,
  previous: null,
  compaction: null,
  now: 1,
  ...over,
})

const tokensOf = (segments: { id: string; tokens: number }[], id: string) =>
  segments.find(segment => segment.id === id)?.tokens

describe('nextSnapshot, measured', () => {
  test('splits the Messages tokens by characters', () => {
    const snapshot = nextSnapshot(input({}))

    expect(tokensOf(snapshot.conversation, 'prompts')).toBe(250)
    expect(tokensOf(snapshot.conversation, 'claude-output')).toBe(250)
    expect(tokensOf(snapshot.conversation, 'tool-results')).toBe(750)
    expect(sumTokens(snapshot.conversation)).toBe(1250)
    expect(snapshot.charsPerToken).toBe(4)
    expect(snapshot.isEstimate).toBe(false)
    expect(usedTokens(snapshot)).toBe(21_250)
    expect(freeTokens(snapshot)).toBe(200_000 - 21_250 - 33_000)
    expect(snapshot.deferred).toEqual([{ name: 'MCP tools (deferred)', tokens: 9000 }])
  })

  test('shows one Conversation segment when the messages cannot be read', () => {
    const snapshot = nextSnapshot(input({ messages: null }))

    expect(snapshot.conversation).toEqual([{ id: 'conversation', tokens: 1250 }])
  })

  test('keeps the last ratio when the message list may be cut', () => {
    // At the API form's limit older messages may be missing: their characters
    // would be absent from the count while their tokens are in Messages.
    const many: MessageLike[] = Array.from({ length: MAX_API_MESSAGES }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: 'x' }],
    }))
    const snapshot = nextSnapshot(
      input({ breakdown: breakdown(100_000), messages: many, previous: { ...nextSnapshot(input({})), charsPerToken: 3.5 } }),
    )

    expect(snapshot.charsPerToken).toBe(3.5)
    expect(sumTokens(snapshot.conversation)).toBe(100_000)
  })

  test('uses the compaction window when it is smaller than the model window', () => {
    expect(windowOf(200_000, 1_000_000)).toBe(200_000)
    expect(windowOf(1_000_000, 200_000)).toBe(200_000)
    expect(windowOf(0, 200_000)).toBe(200_000)
    expect(windowOf(0, 0)).toBe(0)
  })
})

describe('nextSnapshot, after a compaction', () => {
  // Before the compaction MESSAGES give four characters a token.
  const before = nextSnapshot(input({ breakdown: breakdown(100_000), contextTokens: 120_000 }))

  // After it, the conversation is a summary of 2,000 characters.
  const SUMMARY: MessageLike[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `This session is being continued from a previous conversation. ${'s'.repeat(1938)}`,
        },
      ],
    },
  ]

  test('estimates from characters while the figures are stale', () => {
    // The usage figures still read the pre-compaction fill.
    const after = nextSnapshot(
      input({
        breakdown: breakdown(100_000),
        contextTokens: 120_000,
        messages: SUMMARY,
        previous: { ...before, charsPerToken: 4 },
        compaction: { staleTokens: 120_000 },
      }),
    )

    expect(after.isEstimate).toBe(true)
    expect(after.staleTokens).toBe(120_000)
    expect(tokensOf(after.conversation, 'compaction-summary')).toBe(500)
    expect(sumTokens(after.conversation)).toBe(500)
    expect(totalLabel(after).startsWith('~')).toBe(true)
  })

  test('keeps estimating on later refreshes until the figure moves', () => {
    const estimated = nextSnapshot(
      input({
        messages: SUMMARY,
        previous: { ...before, charsPerToken: 4 },
        compaction: { staleTokens: 120_000 },
        contextTokens: undefined,
      }),
    )
    const still = nextSnapshot(
      input({ breakdown: breakdown(100_000), contextTokens: 120_000, messages: SUMMARY, previous: estimated }),
    )
    const fresh = nextSnapshot(
      input({ breakdown: breakdown(600), contextTokens: 20_600, messages: SUMMARY, previous: still }),
    )

    expect(still.isEstimate).toBe(true)
    expect(sumTokens(still.conversation)).toBe(500)
    expect(fresh.isEstimate).toBe(false)
    expect(fresh.staleTokens).toBeNull()
    expect(sumTokens(fresh.conversation)).toBe(600)
    expect(totalLabel(fresh).startsWith('~')).toBe(false)
  })

  test('estimates with the ratio of the last measurement', () => {
    const after = nextSnapshot(
      input({
        messages: SUMMARY,
        previous: { ...before, charsPerToken: 2 },
        compaction: { staleTokens: 120_000 },
        contextTokens: undefined,
      }),
    )

    // 2,000 characters at two characters a token.
    expect(sumTokens(after.conversation)).toBe(1000)
    expect(after.charsPerToken).toBe(2)
  })

  test('falls back to four characters a token with no earlier ratio', () => {
    const after = nextSnapshot(
      input({ messages: SUMMARY, previous: null, compaction: { staleTokens: null }, contextTokens: undefined }),
    )

    expect(sumTokens(after.conversation)).toBe(500)
  })

  test('isStale reads an absent or unchanged figure as stale', () => {
    expect(isStale(undefined, 5)).toBe(true)
    expect(isStale(5, 5)).toBe(true)
    expect(isStale(6, 5)).toBe(false)
    expect(isStale(6, null)).toBe(false)
  })
})

describe('view', () => {
  test('labels the total as used/window and percent', () => {
    const snapshot = nextSnapshot(input({ breakdown: { ...breakdown(75_000), rawMaxTokens: 1_000_000 }, modelWindow: 1_000_000 }))

    expect(totalLabel(snapshot)).toBe('95k/1M 9%')
  })

  test('fits the bar and the label into the band', () => {
    const snapshot = nextSnapshot(input({}))
    for (const columns of [24, 80, 200]) {
      const { label, parts } = bandModel(snapshot, columns)
      const bar = parts.reduce((sum, part) => sum + part.cells, 0)

      expect(bar + 1 + label.length).toBeLessThan(columns)
    }
    expect(bandModel(snapshot, 12).parts).toEqual([])
  })

  test('shortens the label alone in a narrow band so the row never wraps', () => {
    // 21k/200k 10%: 12 characters.
    const snapshot = nextSnapshot(input({}))
    for (let columns = 1; columns <= 20; columns += 1) {
      const { label, parts } = bandModel(snapshot, columns)
      const bar = parts.reduce((sum, part) => sum + part.cells, 0)

      expect(bar + (parts.length > 0 ? 1 : 0) + label.length).toBeLessThan(Math.max(1, columns))
    }
    expect(bandModel(snapshot, 13).label).toBe('21k/200k 10%')
    expect(bandModel(snapshot, 12).label).toBe('21k/200k')
    expect(bandModel(snapshot, 8).label).toBe('21k')
    expect(bandModel(snapshot, 3).label).toBe('')
  })

  test('lays a pane row into its columns', () => {
    for (const columns of [24, 40, 80]) {
      const { name, figures } = rowText('Project instructions', 9500, 200_000, columns)

      expect(2 + 1 + name.length + figures.length).toBe(columns - 1)
    }
    expect(rowText('Tool results', 9500, 200_000, 80).figures).toBe('  9.5k  4.7%')
    expect(rowText('Tool results', 9500, 200_000, 18).figures).toBe('  9.5k')
  })

  test('drops the share and uses the short name before cutting a name', () => {
    const narrow = rowText('System prompt and built-in tools', 20_000, 1_000_000, 24, 'System')

    expect(narrow.name.trim()).toBe('System')
    expect(narrow.figures).toBe('   20k')
    expect(rowText('System injections', 500, 1_000_000, 24, 'Injections').name.trim()).toBe('Injections')
    expect(rowText('Tool results', 500, 1_000_000, 24, 'Tool results').name.trim()).toBe('Tool results')

    const wide = rowText('System prompt and built-in tools', 20_000, 1_000_000, 80, 'System')
    expect(wide.name.trim()).toBe('System prompt and built-in tools')
    expect(wide.figures).toBe('   20k    2%')
  })

  test('keeps a row with no window in the token column', () => {
    for (const columns of [24, 80]) {
      const withShare = rowText('Free space', 101_000, 200_000, columns)
      const noShare = rowText('MCP tools', 9000, null, columns)

      expect(noShare.name.length + noShare.figures.length).toBe(withShare.name.length + withShare.figures.length)
      expect(noShare.figures.trimEnd().length).toBe(withShare.figures.length - (columns >= 28 ? 6 : 0))
    }
  })
})
