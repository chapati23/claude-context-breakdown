# Product

<!-- impeccable:product-schema 1 -->

## Platform

terminal

The mod draws in character cells inside a Claude Code session, and off the terminal the pane also draws pictures. The terminal is its first surface. The other surfaces it draws on are in "Operating Context".

`terminal` is not one of the values that the Impeccable schema names (`web`, `ios`, `android`, `adaptive`). The maintainer chose it on 2026-11-19 because none of those describes the mod. Impeccable's browser tools (`live`, `generate`, `detect`) and its native iOS and Android guidance do not apply here. Impeccable does not know the value: `impeccable context` warns and treats the project as `web`. Its directives for web pages, such as the request to run the detector, do not apply to this mod.

## Users

Claude Code users who want to know what fills the context window of their session. One person does two jobs, and the two jobs have equal weight (confirmed 2026-11-19):

- **Watch a session.** In a long session, the user watches the conversation grow. They decide when to compact, when to clear, and which kind of content to stop, for example large tool results.
- **Trim a setup.** A user with many MCP servers, skills and instruction files finds which baseline content costs the most, and removes or shortens it.

Authors of skills, hooks and MCP servers can use the mod to measure their own work. They are not a confirmed audience.

## Product Purpose

`context-breakdown` is a Claude Code mod. It draws one bar above the prompt: the full length of the bar is the window, and each coloured stretch is one segment. A pane lists every segment, then the items of one segment, then the content of one item as loaded.

It exists because Claude Code's own `/context` report shows the window only on request and shows the conversation as one number.

Success is adoption (confirmed 2026-11-19): other Claude Code users install the mod and keep it. So first-run clarity counts. A person who has not read the README or the glossary must be able to read the bar and open the pane.

## Positioning

- Against `/context`: the mod stays on screen, updates while the user works, and splits the conversation into its segments.
- Against other context mods (whats-in-the-box, context-budget): those draw one stretch per `/context` category. This mod splits the instruction files and the conversation, lists the items inside each segment, and shows the text of an item as the model received it.
- Against a status line script, a transcript parser, an API proxy and an Agent SDK host: none of them can both read the per-category breakdown and draw inside a session that the user started. The reasons are in [docs/adr/0001-build-as-a-mod-on-the-early-access-api.md](docs/adr/0001-build-as-a-mod-on-the-early-access-api.md).

## Operating Context

- The mod runs inside a Claude Code session, version 2.1.287 or newer. The user's attention is on the conversation and the prompt. The bar is one row at the edge of that work.
- It draws on four surfaces, with different abilities:
  - **Terminal.** The bar in character cells, the pane beside the conversation, and the full set of keys, including `j`, `k` and the arrow keys.
  - **Desktop app.** The bar's cells in the code font, with the same cells as the terminal; the total and the legend in the app's face. A click on the total or the legend opens the segments. The pane is a grid of swatches, length bars and figures in fixed columns. Rows and controls are native buttons; only the controls have key caps. The app's own keys move the focus, and `enter` opens a row. If the app cannot run the bar's module, the bar becomes a picture as in the mobile app, until the mod loads again.
  - **Mobile app and editor.** The bar is a picture. Only the total is a button. The pane is the desktop app's grid.
- The user opens the pane with `/ctx`, with `/ctx <segment>`, or with a click on the bar.
- Users install and update the mod through a marketplace. A release is a merge to `main` that raises the version. The rule is in "Releases" in [AGENTS.md](AGENTS.md).
- Not decided: which surface wins when a design cannot serve all four. The evidence points to the terminal first and the desktop app second: the terminal has the most keys, and the README pictures show the terminal.

## Capabilities and Constraints

Confirmed functionality:

- The bar, with the total, the legend and one chip at a time. Until the user first opens the pane in a session, the legend's place reads "/ctx for details".
- The pane with three levels: segments, items, content. The content level has a formatted view and a raw view, and can show the file on disk in place of the text as loaded.
- The "Not loaded" block for tool schemas that are outside the window. Its `MCP tools` row opens a list of the MCP servers whose tools are not loaded.
- The column `added`: the tokens that each segment gained since the last prompt. The heading of the pane warns when free space is below 10% of the window.

Binding constraints (confirmed 2026-11-19):

- **Read-only and local.** The mod never writes files, never sends content anywhere, and makes no API request. It reads a file from disk only for the item that the user has open: when the item opens, when `r` measures again, and when the user changes the page or the view of the file on disk.
- **Estimates say so.** Every number is an estimate, and the interface says so. A total that the mod computed itself after a compaction carries the `~` mark.
- **The host decides the look.** Claude Code draws focus, highlight and key caps in its own colours. The mod takes its palette from the Claude Code theme setting. It does not replace a host style with its own.
- **Colour is not the only signal.** Neighbour segments differ in lightness as well as hue, and the compaction summary has a texture.

Technical constraints:

- The mods API is early access and can change between releases. A Claude Code update can break the mod.
- A mod cannot read which palette the theme `auto` resolved to, or when `Esc` or typing takes the keyboard back. In the desktop app, the pane's own `isFocused` stays true after `Esc` until the window loses and regains the focus. The desktop app does not tell a mod where `tab` moved the focus, and it limits a mod's scroll.
- The mod shows the main session only, not the windows of subagents. It reads at most the newest 4,096 messages. It shows how the window grew since the last prompt only, and it keeps no history. The system prompt has no finer split.

Terminology: the terms in [CONTEXT.md](CONTEXT.md) are binding in code, comments, prose and interface text. Each term lists the words to avoid.

Not decided: when the version becomes 1.0.0. That step is the maintainer's decision.

## Brand Commitments

- Names: the mod is `context-breakdown`, the repository is `claude-context-breakdown`, and the command is `/ctx`.
- Voice: plain and exact. Short sentences, active voice, one term per thing, British spelling. The interface states limits and uncertainty directly, for example "All numbers are estimates."
- Icon: `.claude-plugin/icon.png`, drawn from `docs/img/icon.svg`. It is the bar bent into a C for "context", on a navy tile: one baseline segment, two conversation segments, then three dots of free space that close the ring. The maintainer chose it on 2026-11-20 and asked on 2026-11-25 for it to stand at the top of the README. It is drawn for 34 px: the lists of the directory at claude.ai/directory drew their icons at that size on 2026-11-20 (one measurement). So it has three colours and not every colour of the bar.
- The mod has no other visual identity apart from the bar. Do not invent one without a decision from the maintainer.

## Evidence on Hand

- Four pictures of one real session (mod 0.11.1, Claude Code 2.1.332, a terminal, 1M window): [docs/img/overview.png](docs/img/overview.png), [docs/img/bar.png](docs/img/bar.png), [docs/img/pane-items.png](docs/img/pane-items.png), [docs/img/pane-content.png](docs/img/pane-content.png).
- The social preview card, [docs/img/social-preview.png](docs/img/social-preview.png) (1280 by 640 px): the logo on its own navy, the README's tagline, and real crops of the pane and the bar from the same session as the four pictures. It adds no figure or claim that the README lacks.
- [README.md](README.md): what the mod is, what it shows, how to install and update it, and what is safe about it.
- [docs/reference.md](docs/reference.md): the behaviour of the bar and the pane, the keys per surface, how the numbers are made, and the limits.
- [docs/adr/0001-build-as-a-mod-on-the-early-access-api.md](docs/adr/0001-build-as-a-mod-on-the-early-access-api.md): the options that were rejected, with reasons.
- Tests under `tests/`, with golden end-to-end journeys under `tests/e2e/` and their description in [docs/e2e.md](docs/e2e.md).
- Absent, and not to be invented: user counts, install figures, testimonials, benchmarks against other mods, pictures of the desktop app, the mobile app or the editor, and pictures of a light theme.

## Product Principles

1. **Show what the model received.** The window, its segments and the text of an item as loaded are the subject. A view that differs from what the model received says so.
2. **State what is an estimate and what is a limit.** A figure never looks more exact than it is.
3. **Read, never act.** The mod observes. It does not write files, send content, submit a prompt or change the conversation. Two controls act, and only when the user presses them: `c` copies the path of the open file, and `m` puts its `@path` into the prompt.
4. **Be a guest in the session.** The conversation is the user's work. The bar takes one row, and the host's colours, focus and keys win over the mod's own.
5. **Readable without the manual.** Adoption depends on a new user who understands the bar on first sight and finds the pane without the README. The baseline and the conversation get equal weight.

## Accessibility & Inclusion

- The palette is tested for the two common forms of colour blindness. There is one palette for dark themes and one for light themes.
- Every action in the pane has a key. Each level shows the keys that can apply there, always in the same order. Off the terminal, a row opens with the app's focus keys and Enter, and the controls keep their letters.
- No formal standard, such as a WCAG level, is established.
