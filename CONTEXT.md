# Context breakdown

A Claude Code mod that shows what fills the model's context window. This glossary fixes the words the project uses for the parts of that window.

## Language

### The window

**Window**:
The model's context window: the largest number of tokens one request can hold.
_Avoid_: Context size, limit, budget

**Reserve**:
The part of the window that Claude Code keeps free so that a compaction has room to run.
_Avoid_: Buffer, autocompact buffer, headroom

**Free space**:
The part of the window that holds nothing and is outside the reserve.
_Avoid_: Remaining, available

**Not loaded**:
Content that Claude Code can load on demand and that is outside the window until then, such as deferred tool schemas.
_Avoid_: Deferred, lazy

### What is in the window

**Segment**:
One kind of content in the window, drawn as one coloured stretch of the bar.
_Avoid_: Category, slice, section, bucket

**Category**:
One row of Claude Code's own `/context` report. A segment is built from one or more categories, or from a part of one.
_Avoid_: Using "category" for a segment

**Baseline**:
The content that is in the window before the first prompt of a session: system prompt, tools, instructions, memory, and the lists of skills and agents.
_Avoid_: Overhead, fixed cost, startup context

**Conversation**:
The content that enters the window after the session starts: prompts, replies, tool calls, tool results, and text that Claude Code injects.
_Avoid_: Messages, history, transcript

**Item**:
One concrete thing inside a segment, such as one instruction file, one tool result, or one skill body.
_Avoid_: Entry, element, component

**Injected text**:
Text that Claude Code adds to the conversation without the user typing it, such as hook output, reminders, and tool-list updates.
_Avoid_: Meta message, attachment, system message

**Compaction summary**:
The summary that replaces the earlier conversation after a compaction.
_Avoid_: Compact message, recap

### What the user sees

**Bar**:
The one-row picture of the whole window, drawn above the prompt, with one stretch per segment.
_Avoid_: Meter, gauge, status line

**Pane**:
The detail view that lists segments, then the items of one segment, then the content of one item.
_Avoid_: Panel, sidebar, inspector

**As loaded**:
The text of an item as the model received it, which can differ from the file on disk now.
_Avoid_: Snapshot, cached version

**Estimate**:
A token count that Claude Code or the mod computed without asking the API to count. Every number the mod shows is an estimate unless it says otherwise.
_Avoid_: Approximation, guess
