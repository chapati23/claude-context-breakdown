import { describe, expect, test } from 'claude-code/testing'

import {
  IMAGE_CHARS,
  blockChars,
  classifyBlock,
  classifyUserText,
  countConversation,
  localCommandOf,
  sortBlock,
  sortMessage,
  totalChars,
} from '../hooks/classify'
import type { MessageLike } from '../hooks/classify'
import { NO_KEYS } from '../hooks/listing'
import type { BaselineKeys } from '../hooks/listing'
import {
  AGENTS_REMINDER,
  CAVEAT,
  CONTEXT_REPORT,
  ENVIRONMENT_REMINDER,
  LOCAL_COMMAND,
  MCP_REMINDER,
  OPENING,
  REVIEWER_ENTRY,
  SKILLS_REMINDER,
} from './fixtures'

const KEYS: BaselineKeys = { memoryPaths: [], agentTypes: ['reviewer'] }
const text = (value: string) => ({ type: 'text', text: value })

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

  test('counts a task report inside a reminder as a task report', () => {
    const report =
      '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Build finished</summary>\n</task-notification>'
    const wrapped = `<system-reminder>\n[SYSTEM NOTIFICATION - NOT USER INPUT]\nThis is an automated background-task event.\n\n${report}\n</system-reminder>`
    expect(classifyUserText(wrapped)).toBe('task-reports')
    // A reminder that names the tag in a sentence is a reminder.
    expect(
      classifyUserText('<system-reminder>\nA <task-notification> arrives when the task with <task-id> ends.\n</system-reminder>'),
    ).toBe('injections')
    // The tag alone on a line, with no task id, is not a report.
    expect(classifyUserText('<system-reminder>\nThe tag is:\n<task-notification>\n</system-reminder>')).toBe('injections')
  })

  test('counts typed command lines and shell lines as prompts', () => {
    expect(classifyUserText('<command-name>/demo</command-name>')).toBe('prompts')
    expect(classifyUserText('<bash-input>ls</bash-input>')).toBe('prompts')
    // The line and its output in one block count as the line.
    expect(classifyUserText('<command-name>/demo</command-name>\n<local-command-stdout>ok</local-command-stdout>')).toBe(
      'prompts',
    )
  })

  test('counts the local-command caveat and command or shell output as notifications', () => {
    expect(classifyUserText(CAVEAT)).toBe('injections')
    expect(classifyUserText('<local-command-stdout>done</local-command-stdout>')).toBe('injections')
    expect(classifyUserText('<local-command-stderr>failed</local-command-stderr>')).toBe('injections')
    expect(classifyUserText('<bash-stdout>a.txt</bash-stdout><bash-stderr></bash-stderr>')).toBe('injections')
    expect(classifyUserText('<bash-stderr>no such file</bash-stderr>')).toBe('injections')
    // Output that quotes another tag is still output.
    expect(classifyUserText('<local-command-stdout><task-notification>x</task-notification></local-command-stdout>')).toBe(
      'injections',
    )
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

    expect(classifyBlock('user', block, { memoryPaths: ['/home/user/project/CLAUDE.md'], agentTypes: [] })).toBeNull()
    expect(classifyBlock('user', block, NO_KEYS)).toBe('injections')
  })

  test('leaves out the skills listing and the MCP server instructions', () => {
    expect(classifyBlock('user', text(SKILLS_REMINDER))).toBeNull()
    expect(classifyBlock('user', text(MCP_REMINDER))).toBeNull()
    expect(classifyBlock('user', text(ENVIRONMENT_REMINDER))).toBe('injections')
  })

  test('a reminder that names a listing in running text still counts', () => {
    const mention = '<system-reminder>\nThe skills listing starts with "The following skills are available for use with the Skill tool".\n</system-reminder>'
    expect(classifyBlock('user', text(mention))).toBe('injections')
    expect(classifyBlock('user', text('The following skills are available for use with the Skill tool: none'))).toBe('prompts')
  })

  test('counts only the other reminders of a block that also holds a listing', () => {
    const mixed = `${SKILLS_REMINDER}\n${ENVIRONMENT_REMINDER}`
    expect(sortBlock('user', text(mixed))).toEqual({ id: 'injections', chars: ENVIRONMENT_REMINDER.length + 1 })
  })

  test('the agent types count without the custom agents the baseline lists', () => {
    expect(sortBlock('user', text(AGENTS_REMINDER), KEYS)).toEqual({
      id: 'injections',
      chars: AGENTS_REMINDER.length - REVIEWER_ENTRY.length - 1,
    })
    // Without custom agents the whole listing counts.
    expect(sortBlock('user', text(AGENTS_REMINDER))).toEqual({ id: 'injections', chars: AGENTS_REMINDER.length })
  })

  test('counts an attached image as a prompt', () => {
    expect(classifyBlock('user', { type: 'image', source: { type: 'base64', data: 'AAAA' } })).toBe(
      'prompts',
    )
  })
})

describe('sortMessage', () => {
  const LINE = '<command-name>/context</command-name>\n            <command-message>context</command-message>\n            <command-args></command-args>\n'

  test('plain text right after a local command line is that command’s output', () => {
    expect(sortMessage('user', [text(LINE), text(CONTEXT_REPORT)])).toEqual([
      { id: 'prompts', chars: LINE.length },
      { id: 'injections', chars: CONTEXT_REPORT.length, outputOf: '/context' },
    ])
  })

  test('only the block right after the line, and only plain text', () => {
    const sorted = sortMessage('user', [
      text(LINE),
      text('<local-command-stdout>ok</local-command-stdout>'),
      text('Typed after the output.'),
    ])
    expect(sorted.map(one => one?.id)).toEqual(['prompts', 'injections', 'prompts'])
    // Another command line or a shell line right after the line is typed too.
    expect(sortMessage('user', [text(LINE), text(LINE)]).map(one => one?.id)).toEqual(['prompts', 'prompts'])
    expect(sortMessage('user', [text(LINE), text('<bash-input>ls</bash-input>')]).map(one => one?.id)).toEqual([
      'prompts',
      'prompts',
    ])
    // An image after the line is an attachment, not output.
    expect(sortMessage('user', [text(LINE), { type: 'image', source: { type: 'base64', data: 'AAAA' } }])[1]?.id).toBe(
      'prompts',
    )
  })

  test('a prompt typed after a command that prints no block stays a prompt', () => {
    // After /clear the first typed prompt follows the command line directly.
    const clear = '<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>'
    expect(sortMessage('user', [text(clear), text('Read the notes.')])).toEqual([
      { id: 'prompts', chars: clear.length },
      { id: 'prompts', chars: 'Read the notes.'.length },
    ])
  })

  test('the prompt a prompt command expands to stays a prompt', () => {
    const line = '<command-message>review is running…</command-message>\n<command-name>/review</command-name>\n<command-args>src</command-args>'
    expect(sortMessage('user', [text(line), text('Review the files in src.')]).map(one => one?.id)).toEqual([
      'prompts',
      'prompts',
    ])
    expect(localCommandOf(line)).toBeNull()
    expect(localCommandOf(LINE)).toBe('/context')
    expect(localCommandOf('<command-name>clear</command-name>')).toBe('/clear')
    expect(localCommandOf('Please run <command-name>/x</command-name>')).toBeNull()
  })

  test('a text block with no string text does not throw', () => {
    expect(sortMessage('user', [text(LINE), { type: 'text', text: 42 }]).map(one => one?.id)).toEqual([
      'prompts',
      'injections',
    ])
    expect(sortMessage('user', [{ type: 'text' }, text('Hi')]).map(one => one?.id)).toEqual(['prompts', 'prompts'])
  })

  test('the assistant’s blocks are not read as output', () => {
    expect(sortMessage('assistant', [text(LINE), text('Done.')]).map(one => one?.id)).toEqual([
      'claude-output',
      'claude-output',
    ])
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

  test('counts the opening listings once, in the baseline', () => {
    const chars = countConversation(OPENING as unknown as MessageLike[], KEYS)

    expect(chars.injections).toBe(ENVIRONMENT_REMINDER.length + AGENTS_REMINDER.length - REVIEWER_ENTRY.length - 1)
    expect(chars.prompts).toBe('List the notes.'.length)
  })

  test('counts a local command line as a prompt and its caveat and output as notifications', () => {
    const chars = countConversation(LOCAL_COMMAND as unknown as MessageLike[])
    const [compact, context, review] = LOCAL_COMMAND
    const length = (block: { text: string }) => block.text.length

    expect(chars.prompts).toBe(
      length(compact.content[1]) +
        length(compact.content[3]) +
        length(context.content[0]) +
        length(context.content[2]) +
        length(review.content[0]) +
        length(review.content[1]),
    )
    expect(chars.injections).toBe(
      length(compact.content[0]) + length(compact.content[2]) + length(context.content[1]) + length(context.content[3]),
    )
  })

  test('reads a message whose content is a plain string', () => {
    const chars = countConversation([{ role: 'user', content: 'typed' }])

    expect(chars.prompts).toBe(5)
    expect(totalChars(chars)).toBe(5)
  })
})
