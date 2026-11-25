<p align="center">
  <img src=".claude-plugin/icon.png" width="160" alt="The logo of context-breakdown: a ring in the shape of a C, made of a blue, an orange and a gold segment. Three grey dots close the ring.">
</p>

<h1 align="center">claude-context-breakdown</h1>

<p align="center">
  <strong>See what fills your Claude Code context window.</strong><br>
  A bar above your prompt shows the whole window. Open a segment, then one of its items, to read the text the model received.<br>
  For Claude Code in a terminal and in the Claude desktop app.
</p>

**In a terminal**, type this at the prompt of a Claude Code session:

```
/plugin install context-breakdown --marketplace chapati23/claude-context-breakdown
```

**In the Claude desktop app**, click **Plugins** in the sidebar, then **Add**, then **Add marketplace**, and enter `chapati23/claude-context-breakdown`. Then install **Context breakdown** from it.

You need Claude Code 2.1.287 or newer. The bar appears after the next model response.

![A Claude Code session in a terminal. The bar is above the prompt. The pane beside the conversation lists every segment with its size.](docs/img/overview.png)

*In a terminal: the bar is the row above the prompt, at the bottom left. The pane on the right opens with `/ctx`.*

![A Claude Code session in the Claude desktop app. The bar is above the prompt box. The pane on the right lists every segment with its size, its share and the tokens it added. The conversation text is blanked out.](docs/img/desktop-overview.png)

*In the Claude desktop app: the bar stands above the prompt box. The pane on the right opens with `/ctx` or with a click on the bar.*

## From "how full?" to "full of what?"

Claude Code's `/context` lists what is in the window, but only when you ask. It has one row, Messages, for the whole conversation. When a session grows, that row does not say which tool, which file read or which skill grew it.

`context-breakdown` is a Claude Code mod that keeps the answer on screen. In the terminal session above, 222k of the 1M tokens are in use. The bar shows at a glance that tool results fill most of it. `/ctx tool` opens them: eight file reads, 168k tokens in all, and the largest read alone takes 31k.

## What you get

### A bar that stays on screen

The bar is one row above the prompt. Its full length is the window. Each coloured stretch is one segment: the system prompt, your instruction files, tool results, your prompts, Claude's output, and the rest. Cool colours are the baseline, the content that is in the window before your first prompt. Warm colours are the conversation. The total and the largest conversation segment stand at the right: `222k/1M 22% · Tool results 168k`.

![The bar with the pointer on its last cell, which three small segments share. A chip beside the cell reads "System notifications 11k + Your prompts 135 + Claude output 1.3k".](docs/img/bar.png)

Point at a segment to see its name and size, and click it to open its items. In a terminal, this needs Claude Code's [fullscreen rendering](https://code.claude.com/docs/en/fullscreen) (`/tui fullscreen` switches it on), and the name and size show in a chip, as above. With the keyboard, press `ctrl+x`, then `tab`, and move along the bar with `tab`. In the desktop app, pointing and clicking always work: the other segments dim, and the segment's name and size take the place of the legend.

Neighbouring segments differ in lightness as well as hue. [A test](tests/palette.test.ts) checks that they stay apart for normal vision and for simulated deuteranopia and protanopia, the two common forms of colour blindness.

### The conversation, split into its parts

Tool results, skill bodies, task reports, system notifications, your prompts, Claude's output and the compaction summary each get a segment. The baseline has its own segments too: the system prompt and built-in tools, MCP tools, your global instructions, your project instructions, auto-memory, and the lists of skills and custom agents.

### From a segment down to the text

Type `/ctx` to open the pane. It lists every segment with its tokens and its share of what is used. When free space falls below 10% of the window, the heading of the pane warns.

Open a segment to list its items: each tool call, each instruction file, each prompt. These are the items of Tool results, largest first:

![The items of Tool results, largest first. Each row is one tool call with its tokens and its share of the segment.](docs/img/pane-items.png)

Open an item to read its text as loaded, which is the text the model received. That can differ from the file on disk now, because you can edit a file after Claude Code has read it. For an item that has a file, `v` switches to the file on disk. Some rows show token counts only, for example the system prompt, which Claude Code does not report in finer parts, and each loaded MCP tool. This is a project instruction file:

![The content of a project instruction file in the formatted view, with the keys of the content level above the text.](docs/img/pane-content.png)

### What your last prompt added

After a prompt, the pane gets an `added` column: the tokens each segment gained since you sent that prompt, for example `+252` next to Claude output in the first picture. A segment that did not grow leaves its cell blank. The column shows only while a segment has grown and no figure carries the `~` mark, and in a terminal it needs a pane about 60 columns wide. [The reference](docs/reference.md#use) lists the conditions.

### Where your setup spends tokens

Baseline content costs tokens before you type anything. Open Global instructions or Project instructions to see each file and its size. The pane also has a block for content outside the window: tool schemas that Claude Code loads on demand. In the terminal session above, that is `MCP tools · 10 servers, 227 tools`, 88k tokens once loaded. Open that row to list the servers, largest first. When Claude Code loads a tool, its schema moves into the window, into MCP tools and instructions.

## Terminal or desktop app

The mod shows the same segments, items and text in both. The pane in the desktop app is a grid of native buttons, and the app's own keys move the focus:

![The items of Tool results in the desktop app: six tool calls, largest first, with key caps on the Open, Back, Newest first, Refresh and Close controls.](docs/img/desktop-items.png)

| To | In a terminal | In the desktop app |
| --- | --- | --- |
| Open the pane | `/ctx`, or in fullscreen rendering a click on a bar segment | `/ctx`, or a click on the bar |
| See a segment's name and size | Point at it in fullscreen rendering, or press `ctrl+x`, then `tab` | Point at it |
| Move in the pane | `j`, `k`, `↓`, `↑`, `tab` | `tab`, `shift+tab` |
| Open a row | Its digit, `enter`, or a click | `enter`, or a click |
| Use a control, such as `b` for Back | Press its key, or click it | Press its key, or click it |
| Give the keyboard back to the prompt | `Esc` | `Esc` |
| Install, update, remove | `/plugin` at the prompt, or `claude plugin` in a shell | **Plugins** in the sidebar |

The keys work while the pane has the keyboard. `/ctx` gives it the keyboard. After a click on the bar, click the pane's text first. [Use](docs/reference.md#use) lists every key on every surface.

## Safe to try

- **Local, and it writes no file.** The mod makes no API request, sends no content anywhere and never submits a prompt. It reads a file from disk only for the item you have open. Two keys act, and only when you press them: `c` copies the path of the open file, and `m` puts its `@path` into your prompt. The code that runs is in [`hooks/`](hooks).
- **Labelled estimates.** Every figure is an estimate, and the pane says so: `All numbers are estimates.`
- **One row, your theme.** The bar is one row above the prompt, and the pane takes space only while it is open. The mod has one palette for dark themes and one for light themes, and your Claude Code theme picks one.
- **Easy to remove.** In a shell, `claude plugin uninstall context-breakdown@claude-context-breakdown` removes a user-scope install. Add `--scope project` or `--scope local` for the other scopes. In the desktop app, open **Plugins** in the sidebar, then **Show all** next to Your plugins, then **⋯** next to Context breakdown, and choose **Remove**.

## Install

You need Claude Code 2.1.287 or newer. An install at the user scope loads the mod in all your projects, in the terminal and in the local sessions of the desktop app.

### In a terminal

At the prompt of a Claude Code session:

```
/plugin install context-breakdown --marketplace chapati23/claude-context-breakdown
```

Answer `y` to add the marketplace, then choose a scope. The bar appears after the next model response.

From a shell, with Claude Code 2.1.292 or newer:

```
claude plugin install context-breakdown --marketplace chapati23/claude-context-breakdown
```

### In the Claude desktop app

Click **Plugins** in the sidebar, then **Add**, then **Add marketplace**. Enter `chapati23/claude-context-breakdown`, then install **Context breakdown** from the marketplace. Start a new session to see the bar.

### In the mobile app and in the editor

The bar is a picture, and only the total is a button: a click on it opens the segments. [Surfaces](docs/reference.md#surfaces) describes what each one draws.

## Try it

1. Send any prompt. The bar appears after the response.
2. Type `/ctx`. The pane opens and takes the keyboard.
3. Click a row to open it, or use the keys in [Terminal or desktop app](#terminal-or-desktop-app). Press `b` to go back and `x` to close. `Esc` gives the keyboard back to the prompt.
4. Type `/ctx tool` to open the items of Tool results. The start of a segment's name is enough. Where two names start the same way, the one that comes first in the bar wins.

## How it works

- A mod is a Claude Code plugin that draws inside the interface. This one uses Claude Code's mods API, which is in early access. [The decision record](docs/adr/0001-build-as-a-mod-on-the-early-access-api.md) says why a mod, and not a status line, a transcript parser or a proxy.
- The mod reads Claude Code's summary breakdown and your conversation. It sorts them into segments and draws the bar and the pane.
- The conversation split is the mod's own estimate: it counts the characters of each kind of content and applies those shares to Claude Code's total for the conversation. The total and the baseline segments are Claude Code's own figures, except directly after a compaction: until the next model response, the mod estimates the total and marks it with `~`. A baseline segment can differ from `/context` by a few hundred tokens, because `/context` can count with the API and the summary estimates locally. [How the numbers are made](docs/reference.md#how-the-numbers-are-made) has the details.

## Good to know

- **Early version.** This is a 0.x release. Claude Code's mods API is early access and can change between releases, and a Claude Code update can break the mod.
- **Main session only.** The mod does not show the windows of subagents.
- **No history.** It shows how the window grew since your last prompt, and keeps nothing older.
- **Colours in the desktop app.** The bar and the pane take their palette from Claude Code's theme setting, not from the app's light or dark appearance.
- **The pictures.** The terminal pictures show one session: mod 0.11.1, Claude Code 2.1.332, a 1M window. The desktop app pictures show another session with mod 0.11.1, taken on 25 November 2026; its conversation text is blanked out. The editor and the mobile app draw the desktop app's pane.

[Limits](docs/reference.md#limits) lists the rest.

## Update

By default, Claude Code does not update this mod by itself.

From a shell:

```
claude plugin marketplace update claude-context-breakdown
claude plugin update context-breakdown@claude-context-breakdown
```

Then restart Claude Code. The first command reads the newest version from GitHub, and the second one installs it.

To get new versions without these commands, turn on auto-update for the marketplace: run `/plugin` in a terminal session, open **Marketplaces**, choose `claude-context-breakdown`, and choose **Enable auto-update**. Claude Code then updates the mod in the background and tells you when to reload.

In the desktop app, open **Plugins** in the sidebar, then **Add**, then **Manage marketplaces**. Choose **⋯** next to `claude-context-breakdown`, then **Check for updates**, and start a new session.

## More

- [Reference](docs/reference.md): every segment, every key and every figure.
- [Development](docs/development.md): the checks, how to load the folder as a mod, and the icon. It links the project's terms, the product record and the decision records.

Found a bug, or have an idea? [Open an issue](https://github.com/chapati23/claude-context-breakdown/issues).

## Licence

MIT. See [LICENSE](LICENSE).
