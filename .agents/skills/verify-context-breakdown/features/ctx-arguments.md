# /ctx arguments

`/ctx <word>` opens the items of the segment whose name starts with the word. `/ctx not` opens the list of MCP servers whose tools are not loaded. A word that matches no segment opens the segments with a note.

## Sub-features

- `arg-segment` `/ctx tool` opens Tool results; `/ctx prompts` or `/ctx your` opens Your prompts.
- `arg-nomatch` `/ctx foo` opens the segments with `No segment matches "foo".`
- `arg-notloaded` `/ctx not` opens the server list, or the segments with `All MCP tools are loaded now.` when no server has unloaded tools.

## How to get to it (user POV)

- Type `/ctx <word>` at the prompt, with or without the pane open.

## Driving it with tui.sh and cmux-cua

Preconditions:

- A terminal run with one finished prompt.

- **Segment.** `scripts/tui.sh send <run> "/ctx your"`, wait for `% of segment`, capture `arg-your`. The title line names Your prompts' segment (`Prompts`).
- **No match.** `scripts/tui.sh send <run> "/ctx foo"`, wait for `No segment matches`, capture `arg-foo`. The heading `free before compaction` shows with the note.
- **Not loaded.** `scripts/tui.sh send <run> "/ctx not"`, wait for `Not loaded › MCP tools|All MCP tools are loaded now`, capture `arg-not`. Either the server list (breadcrumb `Context › Not loaded › MCP tools`; `% of <n>k` only when Claude Code gives token figures) or the note shows, depending on the user's MCP setup.
- **Desktop.** Type the same commands in the composer and save one picture each.

## Gotchas

- `/ctx n`, `/ctx no` and `/ctx noti` open System notifications, not the server list: the list comes after the segments.
- The terminal session inherits the user's MCP servers, so `arg-notloaded` has two valid outcomes. Report which one you saw.
