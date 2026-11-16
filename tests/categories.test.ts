import { describe, expect, test } from 'claude-code/testing'

import { apportion, splitCategories } from '../hooks/categories'
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
