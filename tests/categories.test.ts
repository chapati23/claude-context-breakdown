import { describe, expect, test } from 'claude-code/testing'

import { apportion, notLoadedServers, splitCategories } from '../hooks/categories'
import type { BreakdownLike } from '../hooks/categories'

const used = (name: string, tokens: number) => ({ name, tokens, kind: 'used' })

const BREAKDOWN: BreakdownLike = {
  categories: [
    used('System prompt', 6000),
    used('System tools', 18_000),
    used('MCP tools', 2000),
    used('MCP server instructions', 4000),
    { name: 'MCP tools (deferred)', tokens: 130_000, kind: 'deferred' },
    { name: 'System tools (deferred)', tokens: 32_000, kind: 'deferred' },
    used('Custom agents', 700),
    used('Memory files', 9000),
    used('Skills', 8000),
    used('Messages', 100_000),
    { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
    { name: 'Free space', tokens: 787_300, kind: 'free' },
  ],
  memoryFiles: [
    { path: '/home/user/.claude/CLAUDE.md', type: 'User', tokens: 4000 },
    { path: '/home/user/project/CLAUDE.md', type: 'Project', tokens: 3000 },
    { path: '/home/user/project/CLAUDE.local.md', type: 'Local', tokens: 1000 },
    { path: '/home/user/.claude/memory/MEMORY.md', type: 'AutoMem', tokens: 1000 },
  ],
}

const byId = (split: ReturnType<typeof splitCategories>) =>
  Object.fromEntries(split.baseline.map(segment => [segment.id, segment.tokens]))

describe('splitCategories', () => {
  test('maps used categories to baseline segments', () => {
    const split = splitCategories(BREAKDOWN)

    expect(byId(split)).toEqual({
      system: 24_000,
      mcp: 6000,
      'global-instructions': 4000,
      'project-instructions': 4000,
      'auto-memory': 1000,
      'skills-agents': 8700,
      other: 0,
    })
    expect(split.messages).toBe(100_000)
    expect(split.reserve).toBe(33_000)
  })

  test('keeps deferred categories out of the window', () => {
    const split = splitCategories(BREAKDOWN)
    const baseline = split.baseline.reduce((sum, segment) => sum + segment.tokens, 0)

    expect(split.deferred).toEqual([
      { name: 'MCP tools (deferred)', tokens: 130_000 },
      { name: 'System tools (deferred)', tokens: 32_000 },
    ])
    // Baseline plus conversation is the breakdown's used total.
    expect(baseline + split.messages).toBe(147_700)
  })

  test('counts a used category of an unknown name as Other', () => {
    const split = splitCategories({
      categories: [used('System prompt', 100), used('Something new', 250), used('Messages', 50)],
    })

    expect(byId(split).other).toBe(250)
    expect(byId(split).system).toBe(100)
  })

  test('branches on kind, not on name', () => {
    const split = splitCategories({
      categories: [
        { name: 'Messages', tokens: 999, kind: 'deferred' },
        { name: 'System prompt', tokens: 500, kind: 'buffer' },
      ],
    })

    expect(split.messages).toBe(0)
    expect(split.reserve).toBe(500)
    expect(split.deferred).toEqual([{ name: 'Messages', tokens: 999 }])
  })

  test('splits memory files by their per-file tokens', () => {
    // The category's estimate differs from the files' sum: it is split in proportion.
    const split = splitCategories({
      categories: [used('Memory files', 1000)],
      memoryFiles: [
        { path: '/home/user/.claude/CLAUDE.md', type: 'User', tokens: 300 },
        { path: '/etc/claude/CLAUDE.md', type: 'Managed', tokens: 100 },
        { path: '/home/user/project/CLAUDE.md', type: 'Project', tokens: 400 },
        { path: '/home/user/.claude/memory/MEMORY.md', type: 'AutoMem', tokens: 200 },
      ],
    })

    expect(byId(split)['global-instructions']).toBe(400)
    expect(byId(split)['project-instructions']).toBe(400)
    expect(byId(split)['auto-memory']).toBe(200)
  })

  test('counts memory as Other when the files are missing', () => {
    expect(byId(splitCategories({ categories: [used('Memory files', 800)] })).other).toBe(800)
    expect(
      byId(splitCategories({ categories: [used('Memory files', 800)], memoryFiles: [] })).other,
    ).toBe(800)
  })

  test('puts a memory file of an unknown type in Other', () => {
    const split = splitCategories({
      categories: [used('Memory files', 100)],
      memoryFiles: [
        { path: '/home/user/project/CLAUDE.md', type: 'Project', tokens: 50 },
        { path: '/home/user/project/rules.md', type: 'Somewhere', tokens: 50 },
      ],
    })

    expect(byId(split)['project-instructions']).toBe(50)
    expect(byId(split).other).toBe(50)
  })
})

describe('notLoadedServers', () => {
  const tool = (serverName: string, tokens: number, isLoaded = false) => ({ serverName, tokens, isLoaded })

  test('counts the tools that are not loaded per server, largest first', () => {
    expect(
      notLoadedServers([
        tool('notes', 400),
        tool('notes', 600),
        tool('notes', 5000, true),
        tool('tickets', 3000),
        tool('maps', 1000),
        tool('atlas', 1000),
        tool('calendar', 500),
        tool('calendar', 500),
      ]),
    ).toEqual([
      { name: 'tickets', tools: 1, tokens: 3000 },
      // A tie in tokens: more tools first, then by name.
      { name: 'calendar', tools: 2, tokens: 1000 },
      { name: 'notes', tools: 2, tokens: 1000 },
      { name: 'atlas', tools: 1, tokens: 1000 },
      { name: 'maps', tools: 1, tokens: 1000 },
    ])
  })

  test('leaves out loaded tools, and servers whose tools are all loaded', () => {
    expect(notLoadedServers([tool('notes', 600, true)])).toEqual([])
    expect(notLoadedServers(null)).toEqual([])
    expect(notLoadedServers(undefined)).toEqual([])
  })

  test('keeps the tools of a server with no token figure, and strips control characters from names', () => {
    expect(notLoadedServers([tool('\x1b[31mred\x1b[0m\tteam', 0), tool('red team', Number.NaN), tool('notes', -5)])).toEqual([
      { name: 'red team', tools: 2, tokens: 0 },
      { name: 'notes', tools: 1, tokens: 0 },
    ])
  })
})

describe('apportion', () => {
  test('always sums to the total', () => {
    const parts = apportion(100, [1, 1, 1])

    expect(parts.reduce((a, b) => a + b, 0)).toBe(100)
    expect(parts).toEqual([34, 33, 33])
  })

  test('gives nothing when there is no weight', () => {
    expect(apportion(100, [0, 0])).toEqual([0, 0])
    expect(apportion(0, [1, 2])).toEqual([0, 0])
  })
})
