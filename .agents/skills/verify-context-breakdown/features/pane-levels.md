# Pane levels

`/ctx` opens the pane. Level 1 lists the segments with tokens and shares; a segment opens level 2, its items; an item opens level 3, its content. `b` goes back one level, `x` closes the pane, `r` measures again.

## Sub-features

- `pane-open` `/ctx` opens level 1 with the heading `<n>k used · <n>k free before compaction`.
- `pane-items` a segment row opens its items (`% of segment`).
- `pane-content` an item row opens its content with the facts line `item <n> of <m> · <tokens> tokens · …`.
- `pane-back` `b` returns one level with the ring on the row that was opened.
- `pane-close` `x` closes the pane.

## How to get to it (user POV)

- Type `/ctx` at the prompt.
- Terminal: press a row's digit, or move the ring with `j`, `k`, the arrows or Tab and press Enter.
- Desktop: click a row; Tab and Enter work only with a real keyboard.

## Driving it with tui.sh and cmux-cua

Preconditions:

- A terminal run with one finished prompt (see [README.md](./README.md)).

- **Open.** `scripts/tui.sh send <run> "/ctx"`, then `scripts/tui.sh wait <run> 'free before compaction'`, then `scripts/tui.sh capture <run> pane-1`. The right side shows `✕`, the heading, `Baseline` and `Conversation` groups, and rows `1: System …`.
- **Items.** Read the digit of `Your prompts` in the capture, press it: `scripts/tui.sh keys <run> <digit>`, wait for `% of segment`, capture `pane-2`. The list shows `1: Print the numbers…` and the controls `⏎ 1-9: Open  j: ↓  k: ↑  b: Back`.
- **Content.** `scripts/tui.sh keys <run> 1`, wait for `item 1 of`, capture `pane-3`. The text `Print the numbers 1 to 40, one per line, and nothing else.` shows below the controls.
- **Back and close.** `scripts/tui.sh keys <run> b b`, wait for `free before compaction`; then `scripts/tui.sh keys <run> x`, and capture `closed`: no `✕` and no `│` column on screen.
- **Desktop.** Send `/ctx` in the composer, save `desktop-pane-1.png`; click the `Your prompts` row, save `desktop-pane-2.png`; click the first item, save `desktop-pane-3.png`; click `Back` twice and `Close`. Each picture shows the level's heading as above.

## Gotchas

- Digits work only while the pane has the keys; `/ctx` gives them. After a click elsewhere, send `/ctx` again.
- A digit typed while the pane has no keys goes into the prompt. Check the prompt line is empty after each key.
- The desktop pane draws no `j`/`k` controls and no digits; do not look for them there.
