import { expect, test } from 'claude-code/testing'

import { segmentDef } from '../hooks/segments'
import type { ContextBreakdownSegmentId } from '../types'

test('each segment has the definition the specification gives it', () => {
  // Change 2 of the specification, with the typographic apostrophe the pane draws.
  const DEFINITIONS: [ContextBreakdownSegmentId, string][] = [
    ['system', 'Claude Code’s own instructions and tool schemas.'],
    ['mcp', 'loaded MCP tool schemas and the instructions of MCP servers.'],
    ['global-instructions', 'your user-level CLAUDE.md and managed instruction files.'],
    ['project-instructions', 'the CLAUDE.md files of the project.'],
    ['auto-memory', 'the memory index that Claude Code loads.'],
    ['skills-agents', 'the one-line listings of skills and agents.'],
    ['other', 'content that the mod cannot place in another segment.'],
    ['compaction-summary', 'the summary that replaced the earlier conversation.'],
    ['tool-results', 'the output of tool calls, such as file reads and command output.'],
    ['skill-bodies', 'the full instructions of each skill that ran.'],
    ['task-reports', 'notifications from background tasks and subagents.'],
    ['injections', 'text that Claude Code adds, such as hook output, reminders and the output of local commands.'],
    ['prompts', 'what you typed or pasted, including slash commands and shell lines.'],
    ['claude-output', 'replies, thinking and tool-call inputs.'],
    ['conversation', 'all content after the session started. The messages could not be read, so there is no split.'],
  ]
  expect(DEFINITIONS.map(([id]) => [id, segmentDef(id).definition])).toEqual(DEFINITIONS)
})
