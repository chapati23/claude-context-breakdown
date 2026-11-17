# claude-context-breakdown

See what fills your Claude Code context window.

`context-breakdown` is a Claude Code mod. It draws one bar above the prompt. The full length of the bar is the model's context window. Each coloured segment is one kind of content: the system prompt, your instruction files, tool results, your prompts, and so on. A pane lists every segment with its size.

Claude Code's own `/context` command shows a similar report, but only when you ask for it, and it shows the whole conversation as one number. This mod stays on screen, updates while you work, and splits the conversation into its parts.

> Status: early version. The mod uses Claude Code's mods API, which is early access and can change between releases.

## Segments

The bar shows two groups, from left to right.

**Baseline** is the content that is in the window before your first prompt:

| Segment | Content |
| --- | --- |
| System prompt and built-in tools | Claude Code's own instructions and tool schemas |
| MCP tools and instructions | Loaded MCP tool schemas and the instructions of MCP servers |
| Global instructions | Your user-level `CLAUDE.md` and managed instruction files |
| Project instructions | The `CLAUDE.md` files of the project |
| Auto-memory | The memory index that Claude Code loads |
| Skills list and custom agents | The one-line listings of skills and agents |

**Conversation** is the content that enters the window after the session starts:

| Segment | Content |
| --- | --- |
| Compaction summary | The summary that replaced the earlier conversation |
| Tool results | The output of tool calls, such as file reads and command output |
| Skill bodies | The full instructions of each skill that ran |
| Task reports | Notifications from background tasks and subagents |
| System notifications | Hook output, reminders, the output of local commands such as `/context`, and other text that Claude Code adds |
| Your prompts | What you typed or pasted, including the slash commands and shell lines you ran |
| Claude output | Replies, thinking, and tool-call inputs |

After the segments come the free space and, at the right end, the compaction reserve: the part of the window that Claude Code keeps free so that a compaction has room to run.

Tool schemas that Claude Code loads on demand are not in the window. The pane lists them in a separate block, "Not loaded".

### From /context to segments

Claude Code's `/context` report lists categories. The mod sorts each category by its kind first, then by its name:

| `/context` category | Where the mod shows it |
| --- | --- |
| System prompt | System prompt and built-in tools |
| System tools | System prompt and built-in tools |
| MCP tools | MCP tools and instructions |
| MCP server instructions | MCP tools and instructions |
| Custom agents | Skills list and custom agents |
| Skills | Skills list and custom agents |
| Memory files | Split by file: Global instructions (user and managed files), Project instructions (project and local files), Auto-memory |
| Messages | Split into the conversation segments, by the mod's own estimate |
| Free space | Free space, computed again from the window, the used content and the reserve |
| Autocompact buffer | Reserve |
| MCP tools (deferred) | Not loaded, in the pane, with one row per MCP server |
| System tools (deferred) | Not loaded, in the pane |

A category whose name starts with "Slash command" also goes to Skills list and custom agents. A category that the mod does not know goes to Other. A memory file of an unknown type goes to Other too. When no memory file has a token figure, the whole Memory files category goes to Other. When the messages cannot be read, Messages is one Conversation segment.

### Reading the bar

- A thin gap separates each segment from the next. The compaction summary has a texture (`▓`) in place of a plain colour, and no gap after it.
- Right of the bar is the total, then the largest conversation segment with its share of what is used: `364k/1M 36% · ▉ Tool results 40%`. The percent is rounded to the nearest whole number, as Claude Code's status line rounds it. It shows 99% until the window is full, and `<1%` for a window that holds less than half a percent.
- In the fullscreen layout, point at a segment to see its name and size in a chip beside it. With the keyboard, press `ctrl+x`, then `tab`, and move along the bar with `tab`; the chip follows. The bar shows one chip at a time.
- The keyboard chip goes away 4 seconds after the focus last moved, or at once when the focus moves into a pane, a prompt is sent, or you click a segment. Claude Code does not tell a mod when `Esc` or typing takes the keyboard back, so until then the chip can stay for up to 4 seconds. While it shows, pointing at another segment shows no chip.
- A chip stays inside the bar when it fits there, on the right of its segment or else on the left. A chip that does not fit covers the total and the legend to the end of the row.
- A chip covers the cells beside its segment, all but the nearest one. While the pointer is on a chip, that chip stays, because Claude Code counts a chip as part of its segment. Move the pointer along the bar cell by cell, or off the bar and back, to see another segment's chip.
- The segment under the focus or the pointer keeps its colour. Its last cell turns to a darker shade (a lighter one in a light theme), so you can see which segment it is. The compaction summary shows a thinner texture instead.
- A segment that is too small for a cell of its own shares a cell with its neighbours. The chip names every segment of the cell, or the first one and how many more when space is short.
- Baseline segments have cool colours and conversation segments have warm colours. Neighbours also differ in lightness, and the palette is tested for the two common forms of colour blindness. There is one palette for dark themes and one for light themes. The theme `auto` uses the dark palette, because a mod cannot read which one `auto` resolved to.

## Install

You need Claude Code 2.1.287 or newer. At the prompt of a terminal session:

```
/plugin install context-breakdown --marketplace chapati23/claude-context-breakdown
```

Answer `y` to add the marketplace, then choose a scope. The bar appears after the next model response.

From a shell:

```
claude plugin install context-breakdown --marketplace chapati23/claude-context-breakdown
```

## Use

The bar is always visible above the prompt. The pane has three levels:

1. **Segments.** Every segment with its tokens and its share of what is used.
2. **Items.** The concrete things inside one segment: each instruction file, each tool result, each skill body, each prompt.
3. **Content.** The text of one item as loaded, which is the text the model received.

Open the pane:

- `/ctx` opens the segments. When the pane is already open, `/ctx` only gives it the keyboard: it keeps the level, the item, the page and the place it shows. The focus ring is then on the first control or row, which can be above the rows in view; `tab` moves the ring and brings it into view.
- `/ctx <segment>` opens the items of one segment. It accepts the start of the segment's name, for example `/ctx tool` or `/ctx global`. When two names start the same way, the segment that comes first in the bar wins. A word that matches no segment opens the segments with a note, for example `No segment matches "foo".` The note goes away when you open a segment.
- In the fullscreen layout, a click on a bar segment opens the items of that segment.

Keys in the pane:

| Key | Where | Action |
| --- | --- | --- |
| `tab`, then `enter` | Segments, items | Move along the rows, then open the row with the focus ring |
| `1` to `9` | Segments, items | Open that row |
| `j`, `k` | All levels | Scroll down or up by one line. In a large item, `j` at the bottom of a page continues on the next page and `k` at the top goes back to the bottom of the previous page |
| `b` | Items, content | Go back one level |
| `s` | Items of a conversation segment | Switch between largest first and newest first |
| `n`, `p` | Items, content | Next page, previous page. An item has pages only when it is longer than about 500 lines or 40,000 characters. The formatted view can start a new page slightly earlier |
| `v` | Content of an item that has a file | Switch between the text as loaded and the file on disk |
| `f` | Content | Switch between the formatted text and the raw text |
| `c` | Content of an item that has a file | Copy the file's path |
| `m` | Content of an item that has a file | Put `@path` into the prompt |
| `r` | All levels | Measure again |
| `x` | All levels | Close the pane |

The keys work while the pane has the keyboard. `/ctx` gives it the keyboard; after a click on the bar, click the pane's text or run `/ctx`. A click on a row or a control of the pane presses it, but leaves the keyboard where it was. (`ctrl+x` then `tab` moves the keyboard to the bar, not to the pane.) While the pane does not have the keyboard, a line above the controls says so, and the controls are plain buttons to click. `Esc` returns the keyboard to the prompt and leaves the pane open.

Each level shows every key it uses, always in the same order. A key that does not apply at the moment, such as `n` on the last page or `c` for an item without a file, is drawn fainter and does nothing. `b` on the segments does nothing too. A key that does not apply keeps the keyboard in the pane. A letter that is not in the line goes to the prompt.

After `b`, the focus ring is on the row you opened. A list that you open has the ring on its first row.

Reading the pane:

- The heading gives the tokens in use and the tokens that are free before a compaction: `283k used · 684k free before compaction`.
- Each row has a length bar. In the segments level, the largest segment fills the bar column and its name is bold. In the items level, the largest item on the page fills it. The row with the focus ring, and the row under the pointer, is drawn as one highlight band: the name and the figures stand on it at full strength, and the bar keeps its colour and its length. Claude Code draws the highlight, and the hotkey digit on it, in its own colours.
- The percentage of a segment is its share of what is used, not of the window. The percentage of an item is its share of its segment. Percentages are rounded to the nearest, so the rows of a group add up to the group within rounding.
- The segments end with the "Not loaded" block: the tool schemas that Claude Code loads on demand, such as `MCP tools` and `System tools`, with their tokens. These tokens are not part of the total.
- Under `MCP tools`, one row per MCP server gives the number of its tools that are not loaded yet and the tokens their schemas take once loaded. The largest server comes first. The pane shows at most 8 servers, and one last row such as `3 more servers` adds up the rest. When Claude Code gives no token figure for these tools, the rows show the tool counts and leave the token column empty. A long server name is cut, so the table keeps its width. These rows are not controls and take no focus. A tool that is loaded is in the window: it is an item of MCP tools and instructions.

The content level shows the title, the facts line and the controls above the text, so the heading stays in view when an item or a page opens. A page that has a next page ends with a `Next page` button.

The content level has two views. The formatted view draws Markdown as Claude's replies are drawn: bold headings, lists, tables, and code blocks. The raw view shows the text as written, with line numbers. It leaves out terminal escape sequences and shows other control characters as `?`. Markdown files, skill bodies, prompts, Claude output, and the compaction summary open formatted. Tool results, task reports and system notifications open raw.

Claude Code cuts a line of code after about 2,000 characters. So the raw view splits a line that is longer than 1,000 characters into pieces, and the facts line says `long lines split`. Where the view numbers the lines, each piece repeats its line's number, and the lines after it keep their numbers.

When a file changed on disk after Claude Code loaded it, the content view says so.

When a compaction or `/clear` removes the item or every item of the list that the pane shows, the pane goes back to the segments and says so. After `/clear`, a list or item of a baseline segment goes back to the segments with no note, because baseline content stays in the context.

## How the numbers are made

- Every number is an estimate. The mod reads Claude Code's summary breakdown and makes no request to the API. The summary estimates each baseline category locally. `/context` can count with the API, so a baseline category can differ from `/context` by a few hundred tokens. The total is the same, because both match the conversation to the last response's usage, and the conversation then differs by the same amount.
- The sizes of the conversation segments are the mod's own estimate. It counts the characters of each kind of content and applies those shares to the engine's total for the conversation.
- The size of a conversation item is its share of characters in its segment. The sizes of baseline items are the engine's own figures.
- Claude Code sends the skills list, the MCP server instructions, the agent types and the memory files as reminders in the first message, and again after a compaction. In live sessions its breakdown counted them in the baseline, so the mod leaves them out of the conversation. The API description does not state this. Of the agent types, only the entries of custom agents are baseline; the built-in types stay under System notifications. Text after the skills list in the same reminder also stays under System notifications. Other reminders, such as the environment, the sandbox rules, the list of tools that load on demand and the date, are counted under System notifications, because no breakdown category names them. It is not known how Claude Code's own breakdown counts them.
- The output of a local command counts under System notifications, also where it has no tag: in the form the mod reads, the report of `/context` comes as plain text right after the command line.
- In the items of Skills list and custom agents, a skill or agent opens its entry as loaded. The MCP server instructions open as loaded too. A row opens only when the conversation still holds its reminder.
- Directly after a compaction, Claude Code has no new measurement until the next model response. Until then the mod estimates the conversation from its text and marks the total with `~`.

## Limits

- The reserve marks the compaction that runs when the window is almost full. Claude Code can also compact a session while it is idle, shortly before the prompt cache expires, at any fill level. The bar cannot show that one in advance. The setting `"idleCompaction": false` in `settings.json` turns it off.
- The mod shows the main session only. It does not show the windows of subagents.
- The system prompt has no finer split, because Claude Code does not report one.
- The mod does not show how the window grew over time.
- The mod reads at most the newest 4,096 messages of a conversation. The pane says so when older items are not listed.
- The mod reads a file from disk only when you open an item that has one. It never writes files and never sends content anywhere.

## Development

The repository root is the mod folder. Three checks must pass:

```
claude plugin validate .
claude plugin test .
tsc -p .
```

`tsc` needs TypeScript 5.4 or newer and the API declarations in `.claude-plugin/types/`. Claude Code writes them when it loads the folder as a mod, for example with `claude --plugin-dir .`.

Project terms are defined in [CONTEXT.md](CONTEXT.md). Decision records are in [docs/adr](docs/adr).

## Licence

MIT. See [LICENSE](LICENSE).
