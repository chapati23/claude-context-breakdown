import { describe, expect, test } from 'claude-code/testing'

import {
  IMAGE_CHARS,
  blockChars,
  classifyBlock,
  classifyUserText,
  countConversation,
  totalChars,
} from '../hooks/classify'
import type { MessageLike } from '../hooks/classify'

describe('classifyUserText', () => {
  test('knows the renderings the harness adds', () => {
    expect(classifyUserText('<system-reminder>\nToday is a day.\n</system-reminder>')).toBe('injections')
    expect(classifyUserText('<task-notification>\n<task-id>t1</task-id>\n</task-notification>')).toBe(
      'task-reports',
    )
    expect(classifyUserText('Base directory for this skill: /home/user/skills/demo\n\n# Demo')).toBe(
      'skill-bodies',
    )
    expect(
      classifyUserText('This session is being continued from a previous conversation that ran out'),
    ).toBe('compaction-summary')
    expect(classifyUserText('<user-prompt-submit-hook>checked</user-prompt-submit-hook>')).toBe(
      'injections',
    )
  })

  test('counts command lines, their output and shell lines as prompts', () => {
    expect(classifyUserText('<command-name>/demo</command-name>')).toBe('prompts')
    expect(classifyUserText('<local-command-stdout>done</local-command-stdout>')).toBe('prompts')
    expect(classifyUserText('<bash-input>ls</bash-input>')).toBe('prompts')
    expect(classifyUserText('<bash-stdout>a.txt</bash-stdout>')).toBe('prompts')
  })

  test('counts any other text as a prompt', () => {
    expect(classifyUserText('Please fix the failing test.')).toBe('prompts')
  })
})

describe('classifyBlock', () => {
  test('puts everything the assistant wrote in Claude output', () => {
    expect(classifyBlock('assistant', { type: 'text', text: 'Done.' })).toBe('claude-output')
    expect(classifyBlock('assistant', { type: 'thinking', thinking: 'hmm' })).toBe('claude-output')
    expect(classifyBlock('assistant', { type: 'tool_use', name: 'Read', input: {} })).toBe(
      'claude-output',
    )
  })

  test('puts tool results in Tool results', () => {
    expect(classifyBlock('user', { type: 'tool_result', tool_use_id: 't1', content: 'ok' })).toBe(
      'tool-results',
    )
  })

  test('leaves out a reminder that carries a memory file', () => {
    const block = {
      type: 'text',
      text: '<system-reminder>\nContents of /home/user/project/CLAUDE.md:\n\nRules.\n</system-reminder>',
    }

    expect(classifyBlock('user', block, ['/home/user/project/CLAUDE.md'])).toBeNull()
    expect(classifyBlock('user', block, [])).toBe('injections')
  })

  test('counts an attached image as a prompt', () => {
    expect(classifyBlock('user', { type: 'image', source: { type: 'base64', data: 'AAAA' } })).toBe(
      'prompts',
    )
  })
})

describe('blockChars', () => {
  test('measures text, thinking and tool calls', () => {
    expect(blockChars({ type: 'text', text: 'abcd' })).toBe(4)
    expect(blockChars({ type: 'thinking', thinking: 'abc' })).toBe(3)
    expect(blockChars({ type: 'tool_use', name: 'Read', input: { file_path: '/a' } })).toBe(
      'Read'.length + JSON.stringify({ file_path: '/a' }).length,
    )
  })

  test('measures a tool result whether its content is a string or blocks', () => {
    expect(blockChars({ type: 'tool_result', content: 'abcde' })).toBe(5)
    expect(
      blockChars({
        type: 'tool_result',
        content: [
          { type: 'text', text: 'abc' },
          { type: 'image', source: { type: 'base64', data: 'AAAA' } },
        ],
      }),
    ).toBe(3 + IMAGE_CHARS)
  })

  test('sizes an image and a document by a fixed stand-in', () => {
    expect(blockChars({ type: 'image', source: { type: 'base64', data: 'A'.repeat(500_000) } })).toBe(
      IMAGE_CHARS,
    )
    expect(blockChars({ type: 'document', source: { type: 'text', data: 'plain text' } })).toBe(10)
    // 200,000 base64 characters are 150,000 bytes: two pages.
    expect(
      blockChars({ type: 'document', source: { type: 'base64', data: 'A'.repeat(200_000) } }),
    ).toBe(2 * IMAGE_CHARS)
  })
})

describe('countConversation', () => {
  test('classifies per block, so one message can feed several segments', () => {
    const messages: MessageLike[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: '<system-reminder>abc</system-reminder>' },
          { type: 'text', text: 'Hello' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hi there' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'a.txt\nb.txt' },
          { type: 'text', text: 'Base directory for this skill: /x\nbody' },
        ],
      },
    ]
    const chars = countConversation(messages)

    expect(chars.injections).toBe('<system-reminder>abc</system-reminder>'.length)
    expect(chars.prompts).toBe(5)
    expect(chars['claude-output']).toBe(8 + 'Bash'.length + JSON.stringify({ command: 'ls' }).length)
    expect(chars['tool-results']).toBe(11)
    expect(chars['skill-bodies']).toBe('Base directory for this skill: /x\nbody'.length)
    expect(chars['task-reports']).toBe(0)
  })

  test('reads a message whose content is a plain string', () => {
    const chars = countConversation([{ role: 'user', content: 'typed' }])

    expect(chars.prompts).toBe(5)
    expect(totalChars(chars)).toBe(5)
  })
})
