import { describe, expect, test } from 'claude-code/testing'

import type { ContextBreakdownSegment, ContextBreakdownSnapshot } from '../types'
import type { MessageLike } from '../hooks/classify'
import {
  addedSince,
  baseOf,
  freeTokens,
  isStale,
  MAX_API_MESSAGES,
  nextSnapshot,
  sumTokens,
  usedTokens,
  windowOf,
} from '../hooks/snapshot'
import type { SnapshotBreakdown, SnapshotInput } from '../hooks/snapshot'
import { bandModel, totalLabel } from '../hooks/view'

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
  test('shares Messages out without the listings the baseline counts', () => {
    const reminder = (body: string) => ({ type: 'text', text: `<system-reminder>\n${body}\n</system-reminder>` })
    const opening: MessageLike[] = [
      {
        role: 'user',
        content: [
          reminder(`The following skills are available for use with the Skill tool:\n\n- demo: ${'d'.repeat(5000)}`),
          reminder(`Available agent types for the Agent tool:\n- mine: ${'m'.repeat(5000)}`),
          { type: 'text', text: 'p'.repeat(1000) },
        ],
      },
      ...MESSAGES.slice(1),
    ]
    const snapshot = nextSnapshot(
      input({ messages: opening, breakdown: { ...breakdown(1250), agents: [{ agentType: 'mine' }] } }),
    )

    // Only the agent listing's header is left of the 10,000 listing characters.
    const header = '<system-reminder>\nAvailable agent types for the Agent tool:\n</system-reminder>'.length
    expect(snapshot.charsPerToken).toBe((5000 + header) / 1250)
    const prompts = tokensOf(snapshot.conversation, 'prompts')!
    expect(Math.abs(prompts - (1000 / (5000 + header)) * 1250)).toBeLessThan(1)
  })

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
    expect(snapshot.notLoadedServers).toEqual([])
  })

  test('keeps the MCP servers whose tools are not loaded, and only those', () => {
    const tools = [
      { name: 'mcp__tickets__open', serverName: 'tickets', tokens: 5000, isLoaded: false },
      { name: 'mcp__tickets__close', serverName: 'tickets', tokens: 3000, isLoaded: false },
      { name: 'mcp__notes__search', serverName: 'notes', tokens: 1000, isLoaded: false },
      { name: 'mcp__notes__write', serverName: 'notes', tokens: 700, isLoaded: true },
    ]
    const snapshot = nextSnapshot(input({ breakdown: { ...breakdown(1250), mcpTools: tools } }))

    expect(snapshot.notLoadedServers).toEqual([
      { name: 'tickets', tools: 2, tokens: 8000 },
      { name: 'notes', tools: 1, tokens: 1000 },
    ])
    // The window's figures do not change: these tools are outside it.
    expect(usedTokens(snapshot)).toBe(21_250)
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

    // 9.5% rounds up, as Claude Code's status line rounds.
    expect(totalLabel(snapshot)).toBe('95k/1M 10%')
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
    // 21k/200k 11%: 12 characters.
    const snapshot = nextSnapshot(input({}))
    for (let columns = 1; columns <= 20; columns += 1) {
      const { label, parts } = bandModel(snapshot, columns)
      const bar = parts.reduce((sum, part) => sum + part.cells, 0)

      expect(bar + (parts.length > 0 ? 1 : 0) + label.length).toBeLessThan(Math.max(1, columns))
    }
    expect(bandModel(snapshot, 13).label).toBe('21k/200k 11%')
    expect(bandModel(snapshot, 12).label).toBe('21k/200k')
    expect(bandModel(snapshot, 8).label).toBe('21k')
    expect(bandModel(snapshot, 3).label).toBe('')
  })
})

describe('the column added', () => {
  const SYSTEM = { id: 'system', tokens: 20_000 } as const
  const snap = (conversation: ContextBreakdownSegment[], over: Partial<ContextBreakdownSnapshot> = {}): ContextBreakdownSnapshot => ({
    window: 200_000,
    reserve: 33_000,
    baseline: [SYSTEM],
    conversation,
    deferred: [],
    notLoadedServers: [],
    isEstimate: false,
    staleTokens: null,
    charsPerToken: 1,
    measuredAt: 0,
    ...over,
  })
  const before = snap([
    { id: 'tool-results', tokens: 30_000 },
    { id: 'prompts', tokens: 2000 },
    { id: 'claude-output', tokens: 8000 },
  ])

  test('the base holds every segment of a measurement, and none of an estimate or of nothing', () => {
    expect(baseOf(before)).toEqual({ segments: [SYSTEM, ...before.conversation] })
    expect(baseOf(snap(before.conversation, { isEstimate: true }))).toBeNull()
    expect(baseOf(null)).toBeNull()
  })

  test('counts what each segment gained since the base, growth only', () => {
    const after = snap([
      { id: 'tool-results', tokens: 44_000 },
      { id: 'prompts', tokens: 1900 },
      { id: 'claude-output', tokens: 8000 },
      { id: 'task-reports', tokens: 300 },
    ])
    // Prompts shrank and Claude output stayed: neither is in it. Task reports were not in the base: from zero.
    expect(addedSince(baseOf(before), after)).toEqual({ 'tool-results': 14_000, 'task-reports': 300 })
  })

  test('no column without a base, from an estimate, or when nothing grew', () => {
    const grown = snap([{ id: 'tool-results', tokens: 44_000 }, ...before.conversation.slice(1)])
    expect(addedSince(baseOf(before), grown)).toEqual({ 'tool-results': 14_000 })
    expect(addedSince(null, grown)).toBeNull()
    expect(addedSince(baseOf(before), { ...grown, isEstimate: true })).toBeNull()
    expect(addedSince(baseOf(before), before)).toBeNull()
  })

  test('no column while less is in use than at the base, as after a compaction that raised no event', () => {
    // The summary is new, so it grew; but 32k is in use against the base's 60k.
    const compacted = snap([{ id: 'compaction-summary', tokens: 2000 }, { id: 'prompts', tokens: 10_000 }])
    expect(usedTokens(compacted)).toBeLessThan(sumTokens(baseOf(before)!.segments))
    expect(addedSince(baseOf(before), compacted)).toBeNull()
  })

  test('no column when one side has the conversation as one segment and the other has it split', () => {
    const whole = snap([{ id: 'conversation', tokens: 40_000 }])
    expect(addedSince(baseOf(whole), snap([{ id: 'tool-results', tokens: 50_000 }]))).toBeNull()
    expect(addedSince(baseOf(before), snap([{ id: 'conversation', tokens: 60_000 }]))).toBeNull()
    expect(addedSince(baseOf(whole), snap([{ id: 'conversation', tokens: 41_000 }]))).toEqual({ conversation: 1000 })
  })
})
