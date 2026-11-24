# Keyboard

While the pane has the keyboard, keys move in it and press its controls. The terminal adds keys of its own (`j`, `k`, the arrows, digits); the desktop app uses its own keys only (Tab, Shift+Tab, Enter) plus the controls' letters. `Esc` gives the keyboard back to the prompt; `/ctx` gives it to the pane again. The full key table is in "Use" in `README.md`.

## Sub-features

- `key-move` terminal: `j`, `k` and the arrows move the ring row by row; desktop: Tab and Shift+Tab move the focus.
- `key-open` Enter opens the row with the ring; terminal: a digit opens that row.
- `key-letters` `b` back, `s` sort, `r` refresh, `x` close (and `n`, `p`, `f`, `v`, `c`, `m` at their levels).
- `key-escape` `Esc` gives the keyboard back. Terminal: the controls lose their keys and a hint line shows. Desktop: the key caps stay, and the hint line shows only after the window loses the focus once.
- `key-regain` `/ctx` on an open pane gives it the keyboard again.

## How to get to it (user POV)

- Type `/ctx`: the pane opens with the keyboard.
- Desktop: click the pane's text.

## Driving it with tui.sh and cmux-cua

Preconditions:

- Terminal: a run started with `--size 120x50` (at 24 rows the line that describes the ringed row falls below the visible pane; the hint line and the controls stand above the rows there, and scroll out once the ring moves below the first rows). Rows are numbered from what is in the session: in a session with no prompt yet there are only 5 rows that open, so a digit above 5 goes to the prompt.
- Desktop: the baseline desktop preconditions in [README.md](./README.md) and the user's go.

Terminal (proven on 2026-11-24 in Claude Code 2.1.331: `j`, Enter, `b`, a digit, `Esc`, `/ctx` again, `x`. Not run yet: `k`, the arrows, Tab, `r`, `s`; add a step with a visible result before you claim them):

- **Move and open.** `scripts/tui.sh send <run> "/ctx"`, wait for `⏎ 1-9: Open`, then `scripts/tui.sh keys <run> j j Enter`, wait for `% of segment`. The ring starts on row 1, so the third row opens (for example `Global  8.2k · 14% of used`).
- **Back.** `scripts/tui.sh keys <run> b`, wait for `free before compaction`.
- **Digit.** `scripts/tui.sh keys <run> 1`, wait for `% of segment`; the prompt line stays `❯` with nothing after it. Then `scripts/tui.sh keys <run> b` and wait for `free before compaction`: row 1 (System) has no rows that open, so the next steps start from the segments.
- **Escape.** `scripts/tui.sh keys <run> Escape`, wait for `For keys: click the pane, or run /ctx`. The controls line shows `Refresh  Close` without keys.
- **Regain.** `scripts/tui.sh send <run> "/ctx"`, wait for `r: Refresh` (a keyed control that every level shows; `⏎ 1-9: Open` shows only in a list with rows that open).
- **Close.** `scripts/tui.sh keys <run> x`: the `✕` and the `│` column are gone.

Desktop (partly proven on 2026-11-24):

- **Give the pane the keyboard.** After `/ctx` (two Returns) the keyboard stays in the composer: an Enter there did not open a row. Pixel-click the pane's text, for example the line `All numbers are estimates.`.
- **Letter.** `press_key` `x` with `delivery_mode: "foreground"`: the pane closed (proven). Use letters whose effect is visible: `b` at level 2, `s` in Your prompts (`Newest first` ↔ `Largest first`), `x`.
- **Tab and Enter.** `press_key` `tab` and `return` (foreground) showed no visible focus ring and opened no row in pictures. Not proven; report as not checked, or hand the user the lines of the desktop checklist in `docs/e2e.md`.
- **Escape.** `press_key` `escape` (foreground) gives the keyboard back to the composer: a following `x` types there (proven 2026-11-24). The line `Click the pane for keys` does not show then: the desktop app keeps reporting the pane as having the keyboard, also after a redraw from a new prompt. It shows after the window loses and regains the focus. Check the keyboard's place with a letter, never with the hint line.

## Gotchas

- After `Escape`, wait for the hint line with `tui.sh wait`, not a fixed sleep: tmux can hold an Escape briefly before it passes it on.
- A digit that matches no row goes into the prompt, on both surfaces. Read the row numbers on the screen first.
- On the desktop, a key sent while the composer has the keyboard types into the composer: a stray `bb` once ended up in a sent prompt. Check the composer is empty before each prompt.
- The desktop pictures can go stale once the app is not the active window (see ../SKILL.md, Drive). A key that shows no effect then proves nothing.
