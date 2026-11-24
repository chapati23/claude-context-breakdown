---
name: verify-context-breakdown
description: Prove that the context-breakdown Claude Code mod (the context bar above the prompt and the /ctx pane) works in a real Claude Code session, in the terminal CLI (tmux harness, fully automatic) and in the Claude desktop app (settings load plus cmux-cua, needs the user's go). Use after a change to hooks/, types/ or .claude-plugin/, before calling a change done, for before/after pictures in a pull request, or when a live session looks wrong. Unit tests (claude plugin test .) do not replace this; they do not run the real app.
---

# Verify the context-breakdown mod

The mod draws two things: the **bar** (one row in the band above the prompt) and the **pane** (opened by `/ctx`, three levels: segments, items, content). Terms are in `CONTEXT.md`; the user-facing behaviour is in "Use" in `README.md`.

The scripts are for macOS (`stat -f`, `sips`, the Chrome path, cmux-cua).

Two surfaces, two harnesses:

| Surface | Harness | Who can run it |
| --- | --- | --- |
| Terminal (`claude` CLI) | `scripts/tui.sh`: a private tmux server per run | You, alone, any time |
| Claude desktop app | `scripts/desktop-load.sh` + `cmux-cua` MCP tools | You, only after the user said go: it edits their settings and takes their screen |

All paths below are relative to this skill's folder, `.agents/skills/verify-context-breakdown/` (Claude Code sees it as `.claude/skills/verify-context-breakdown`, a link). Run every script **outside the agent sandbox**: the sandbox blocks the tmux socket and the write to the settings file. Scripts find the repository root themselves.

Feature map: [features/README.md](features/README.md). A proof covers every entry point that the feature's file lists, not only the easiest one.

## Before any live check

Run the unit checks first, **from the repository root** (the mod folder); a live run cannot find what these already find, and they take seconds:

```sh
claude plugin validate . && claude plugin test . && npx --yes -p typescript@5.9.3 tsc -p .
```

`tsc` needs the API declarations in `.claude-plugin/types/`, which git ignores: a new worktree lacks them until Claude Code loads the folder as a mod. See "Development" in `README.md`.

## Terminal

### Launch

```sh
scripts/tui.sh start <run> [--worktree | --ref <git-ref>] [--other] [--size 110x24] [--model haiku]
```

- `<run>`: a short name, `[a-z0-9-]`, new for each launch: `start` refuses a name whose evidence folder exists, so old captures never pair with a new build. Each run is isolated: its own tmux server (`-L vctx-<hash of the checkout path>-<run>`), its own frozen copy of the mod in a temp folder, its own empty working folder. Several runs can go side by side (for example `before` with `--ref origin/main` and `after` with `--worktree`).
- `--worktree` (default) copies the checkout as it is, uncommitted edits included. `--ref` copies a commit with `git archive`.
- `--other` also loads `fixtures/othermod`, a probe mod that draws one band row (`OTHER MOD ROW · this row comes first`). Use it for the band order.
- Ready means: the `❯` prompt and exactly one bar line show. The bar line matches `[0-9.]+[kM]?/[0-9.]+[kM] +<?[0-9]+%` (for example `69k/1M 7%`, or `4k/1M <1%`). `start` waits about 60 s, accepts the folder-trust question for its own scratch folder, and prints `ready: run <run>, <build>`. On a timeout it prints the screen; read it, then `stop`.
- `--plugin-dir` takes the place of the installed copy for this session, so the installed copy does not draw a second bar. `doctor` checks this.

### Doctor

```sh
scripts/doctor.sh tui <run>
```

Read-only. Checks: the tmux server is up; `claude` still runs (`pane_dead` is 0; `claude` names its process by its version, so do not test the command name); the session loaded **this run's build** (the engine writes `.claude-plugin/types/claude-code/index.d.ts` into each mod folder it loads, and the file in the frozen build must be newer than the run's start); exactly one bar on screen. Exit 1 means do not trust any capture from this run.

### Drive

```sh
scripts/tui.sh send <run> "Print the numbers 1 to 40, one per line, and nothing else."
scripts/tui.sh wait <run> '✻ [A-Za-z]+ for [0-9]' 90     # the turn line, e.g. "✻ Cogitated for 2s · done 7:37 PM"
scripts/tui.sh send <run> "/ctx"                          # opens the pane on the right, with the keys
scripts/tui.sh wait <run> 'free before compaction'
scripts/tui.sh keys <run> 6                               # a digit opens that row (terminal only)
scripts/tui.sh keys <run> b b x                           # back, back, close
scripts/tui.sh screen <run>                               # plain text of the screen
```

- `send` types literal text, then Enter. `keys` takes tmux key names: `Tab`, `BTab` (Shift+Tab), `Enter`, `Escape`, `Up`, `Down`, `j`, `k`, digits, letters.
- Wait for a string, never for a time. The stable handles are text: the bar regex above, `✕` (the pane's close mark), `free before compaction` (level 1 heading), `% of segment` (level 2), `item 1 of` (level 3 facts line), the controls line (`⏎ 1-9: Open`, `b: Back`, `x: Close`).
- The prompt `Print the numbers 1 to 40 …` is the one to use for the band: it fills the transcript, so the turn line stands right above the band, and Haiku answers it in about 2 s.
- The pane's row numbers depend on the session. Read the screen and pick the digit by the row's name; do not hard-code it.

### Evidence

```sh
scripts/tui.sh capture <run> <label> [--html]
```

Writes `<repo>/.verify/<run>/<label>.ansi` (with colours), `<label>.txt` (plain) and, with `--html`, `<label>.html`. `meta.txt` in the same folder records the build, the mod version, the Claude Code version, the size and whether the probe mod ran. Git ignores `.verify/`. For a picture in a pull request, screenshot the HTML with headless Chrome (outside the sandbox):

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --window-size=1100,520 --screenshot=<repo>/.verify/<run>/<label>.png file://<repo>/.verify/<run>/<label>.html
```

Proof standards:

- Drive the real user path: a typed prompt, `/ctx`, keys. Never call the mod's functions or edit its state.
- Capture the state before and after the action, not only the end screen.
- Read the capture against the feature file's expected end state, line by line, and quote the lines in the report.
- A capture from a run whose `doctor` failed proves nothing.

### Cleanup

```sh
scripts/tui.sh stop <run>
```

Kills only that run's tmux server and deletes only that run's temp folder (it checks the folder's name and its stamp). It keeps `.verify/<run>/`. Run it after every failed attempt too, then start again under a new run name. Never `pkill claude` or `tmux kill-server` without the run's own `-L` socket: the user runs their own sessions.

## Desktop app

The desktop app is one shared instance: the user's own. There is no isolation. Rules:

- **Ask first.** Tell the user what you will do and for how long (about 5 minutes for one feature), send `/usr/local/bin/nudge-me "<session label>" "<reason>"` as its own Bash call, and wait for their go. They must not use the keyboard or the mouse during the block. Ask them to put the Claude window beside the terminal, not under it: the app does not repaint while covered.
- One desktop load at a time. `desktop-load.sh on` refuses while any run holds a load or the settings already point at a verify build; run `doctor.sh desktop` before you start.

### Launch

```sh
scripts/desktop-load.sh on <run> [--ref <git-ref>]   # outside the sandbox; freezes HEAD (or ref) and edits ~/.claude/settings.json
scripts/doctor.sh desktop                            # read-only
```

`on` copies the commit with `git archive` (the desktop app must not see later edits of the checkout), sets `CLAUDE_CODE_PLUGIN_DIRS` to the copy and `CLAUDE_CODE_PLUGIN_DIR_WATCH` to `1`, disables the installed copy `context-breakdown@claude-context-breakdown`, and keeps a byte copy of the settings in `.verify/<run>/desktop-state/`. Commit first: `on` does not copy uncommitted edits.

Then, with `cmux-cua` (prefer it; it acts without taking keyboard focus):

1. `start_session` with a session id such as `verify-<run>`; pass it on every call.
2. `launch_app` with `bundle_id: "com.anthropic.claudefordesktop"`. Then `list_windows` **with that `pid`** (never without: the unfiltered list holds every window of the machine). The main window has the title `Claude`.
3. **The window must be on the visible Space.** When cmux (or any app) runs full screen, the Claude window lives on another Space. Then `bring_to_front` does not show it, input sent with `delivery_mode: "foreground"` still lands (the driver switches there and back), but every `get_window_state` picture is stale or blank. Proof needs pictures, so before the block ask the user to take cmux out of full screen or to put the Claude window on the screen that shows. Check with `list_windows` (`is_on_screen: true`) and one test picture.
4. Start a new local session: the File menu items `New Session` or `New Session in New Window` (AX menu items; read their `element_index` from `get_window_state` with `include_screenshot: false`, `max_elements: 120`, `query: "New Session"`) and click by index. A new window lands on the current Space, which can also get around step 3. Only a new session reads the settings again.
5. **Pick a model with quota** before the first prompt. A new session uses the app's default model. On 2026-11-23 that was Fable 5.2, its usage limit was reached, and the prompt failed with `Fable limit reached`. The picker is the model name at the bottom right of the composer (for example `Fable 5.2 Medium`); two foreground clicks on it did not open a menu in a picture from another Space. Not solved yet.
6. Ready: after the first prompt, the bar shows above the composer with a total such as `69k/1M 7%`.

### Doctor

`scripts/doctor.sh desktop`: settings point at a mod folder (and which version), watch is on, the installed copy is off, the app runs, and when a session last loaded that folder (the time of its `index.d.ts`). Compare that time with the `loaded:` line in `.verify/<run>/meta.txt`: a later time proves a desktop session loaded the frozen build, even when no picture could be taken. No time, or an earlier one, means the session runs something else; start a new session.

### Drive

- The composer is web content: it is not in the AX tree (the tree is the menu bar). Pixel-click the box `Describe a task or ask a question` and type in one call: `type_text` with `x`, `y` and `delivery_mode: "foreground"`, then `press_key` `return` with `delivery_mode: "foreground"`. Use the same prompt as in the terminal.
- For a picture only, call `get_window_state` with `max_elements: 1` and `screenshot_out_file`; the AX walk returns only the menu bar anyway.
- `/ctx` + `return` opens the pane. Clicks on rows and controls press them. A click on a bar segment opens its items; a click on the total or the legend opens the segments.
- Use foreground delivery for clicks and keys. With background delivery the pane did not get the keyboard and letters went to the composer.
- The helper cannot hover (`move_cursor` moves an overlay only) and the app ignores modifier keys (cmd+a). Never plan a step that needs either. Hover effects (dimmed segments, the name in the legend's place) and the keyboard (Tab, Escape, Enter on a row) stay with the user: report them as not checked, or give the user the matching lines of "Manual checklist for the desktop app" in `docs/e2e.md` to do themselves (about 2 minutes).
- The app redraws late. Before each capture, wait about 2 s and make one more pointer move; a capture right after an action can show the state before it.
- Coordinates move: the bar's total moves when the pane opens or closes. Take a new `get_window_state` before each pixel click and click the middle of the text you see.
- `/clear` in the desktop app starts a new session process that reads the settings again. Do not run `off` while a check still needs the session.

### Evidence

`get_window_state` with `screenshot_out_file: "<repo>/.verify/<run>/desktop-<label>.png"`. These are whole-window pictures of about 1568 px width. Crop outside the sandbox: `sips -c <h> <w> --cropOffset <y> <x> <in> --out <out>`, enlarge with `sips -z`. Keep the uncropped file.

### Cleanup

```sh
scripts/desktop-load.sh off <run>     # outside the sandbox
```

Restores the exact settings bytes when nobody changed the file meanwhile; else removes only this run's three entries. Deletes the frozen copy. Keeps `.verify/<run>/`. Then `end_session` in cmux-cua. Leave the desktop session open: it is the user's window. A session that is still open keeps the build it loaded until the user starts a new one; say so in the report.

## Report

Per feature and surface: what you drove, the quoted lines or the picture that show the end state, and the `meta.txt` build line. List what you did not check (desktop keys, hover, a surface you skipped) as not checked, never as passed.

## Helpers

| Script | Purpose |
| --- | --- |
| `scripts/tui.sh` | start, send, keys, wait, screen, capture, stop for one terminal run |
| `scripts/doctor.sh` | `tui <run>` or `desktop`: read-only health checks, exit 1 on a failure |
| `scripts/desktop-load.sh` | `on <run>` / `off <run>`: load a frozen build into the desktop app's new sessions, and undo it |
| `scripts/ansi2html.py` | `python3 scripts/ansi2html.py <in.ansi> <out.html> "<title>"`; `capture --html` calls it |
| `fixtures/othermod/` | a probe mod that draws one band row, for `start --other` |
