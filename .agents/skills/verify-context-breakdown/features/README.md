# context-breakdown verification map

This folder is the maintained source for proving the mod's user-facing behaviour in a real Claude Code session. Read this index, then use the feature file as the recipe. The harness commands are in [../SKILL.md](../SKILL.md); paths in commands are relative to the skill folder.

## Baseline preconditions

- Unit checks pass: `claude plugin validate .`, `claude plugin test .`, `tsc -p .`.
- Terminal: a run started with `scripts/tui.sh start <run>` and a passing `scripts/doctor.sh tui <run>`. Default size `110x24`; the pane opens on the right, about 44 columns wide.
- Desktop: the user's go, `scripts/desktop-load.sh on <run>`, a passing `scripts/doctor.sh desktop`, and a **new** local session in the app.
- The session has had one prompt: `Print the numbers 1 to 40, one per line, and nothing else.` Before the first prompt the bar has a total but no legend, and the column `added` has no base.
- Never drive a terminal session that this run did not start. Drive the desktop app only inside the block the user agreed to.

## Driving conventions

- Wait for text, not for time: `scripts/tui.sh wait <run> '<ERE>'`.
- Stable handles: the bar's total (`[0-9.]+[kM]?/[0-9.]+[kM] +<?[0-9]+%`), the pane's `✕`, `free before compaction` (segments), `% of segment` (items), `item <n> of <m>` (content), the controls line (`⏎ 1-9: Open`, `b: Back`, `r: Refresh`, `x: Close`).
- Row digits and row order depend on the session's content. Read the screen, then press the digit of the row by its name.
- The terminal and the desktop use different keys: digits, `j` and `k` are terminal only. On the desktop, use clicks for navigation; which keys can be sent there is in [keyboard.md](./keyboard.md).

## Desktop handles

Found on 2026-11-23 in Claude 6.x (desktop):

- App: `bundle_id` `com.anthropic.claudefordesktop`; main window title `Claude`, a new window `New session`.
- New session: the sidebar's `New` button (pixel click), or the File menu's AX menu items `New Session` and `New Session in New Window`.
- Composer: web content, not in the AX tree. Placeholder `Describe a task or ask a question`, at the bottom centre of the window; pixel-click it.
- Model picker: the model name right of `Worktree` under the composer (`Fable 5.2 Medium`). Not yet driven.
- The pane: the right-hand panel, tab `Plugin`, opened by `/ctx` and two Returns.
- Below the composer: `This computer` (local session) and the folder name. A local session in this repo's folder loads the mod from the settings.

## Proof and skip reporting

- Capture before and after each action (`scripts/tui.sh capture <run> <label>`, or a desktop `screenshot_out_file`), into `.verify/<run>/`.
- Quote the lines of the capture that show the expected end state.
- Name the surface and the entry point with every artifact.
- Report a desktop step as not checked when no desktop picture shows its result (Tab and Enter so far, see [keyboard.md](./keyboard.md)); never report it as verified through the terminal. Hover and letter keys can be shown (see ../SKILL.md, Desktop app, Drive).

## Feature entry contract

Each feature file starts with an H1 title and one paragraph on the user-visible behaviour, then four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with tui.sh and cmux-cua`, `Gotchas`.

## Features

- [Context bar](./bar.md): the bar row with its segments, total and legend, on both surfaces.
- [Band order](./band-order.md): the bar is the last band row, right above the prompt; a blank row above it when alone.
- [Pane levels](./pane-levels.md): `/ctx` opens the segments; open a segment, open an item, go back, close.
- [/ctx arguments](./ctx-arguments.md): `/ctx <segment>`, `/ctx not`, and the note for a word that matches nothing.
- [Bar clicks on the desktop](./desktop-bar-click.md): a click on a segment opens its items; a click on the total or the legend opens the segments.
- [Keyboard](./keyboard.md): the pane's keys in the terminal (all drivable) and in the desktop app (partly drivable).
