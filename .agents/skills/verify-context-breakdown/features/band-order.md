# Band order

When other mods also draw rows above the prompt, the bar takes the last row, right above the prompt. When the bar is the only row and the band has room for two rows, a blank row separates it from the line above the band. When the rows do not all fit, the bar keeps its own place.

## Sub-features

- `band-last` with another mod's row, the bar is the row right above the prompt.
- `band-blank` alone, one blank row stands between the turn line and the bar.
- `band-overflow` when the rows exceed the band's room, the order is unchanged (unit-tested only; no live recipe).

## How to get to it (user POV)

- Use Claude Code with this mod and another mod that draws a row above the prompt.
- Use it alone and finish a turn: the turn line (`✻ Cogitated for 2s · done 7:37 PM`) is the line above the band.

## Driving it with tui.sh and cmux-cua

Preconditions:

- Two terminal runs: `scripts/tui.sh start band-other --other` and `scripts/tui.sh start band-alone`. Both doctors exit 0.

- **Fill the transcript.** In each run: `scripts/tui.sh send <run> "Print the numbers 1 to 40, one per line, and nothing else."` then `scripts/tui.sh wait <run> '✻ [A-Za-z]+ for [0-9]' 90`.
- **Capture.** `scripts/tui.sh capture band-other band --html` and `scripts/tui.sh capture band-alone band --html`.
- **band-last proof.** In `.verify/band-other/band.txt` the lines read, in order: `✻ … for …`, `OTHER MOD ROW · this row comes first … [-]`, the bar line. The bar line comes after the probe row, and the next band-free line is the prompt's rule (a Claude Code notice line, such as the tmux focus-events hint, can stand between them).
- **band-blank proof.** In `.verify/band-alone/band.txt` the line after `✻ … for …` is empty (it can hold only `[-]` at the right edge), and the bar line follows it.
- **Desktop.** Load a second mod in the desktop app as well (only with the user's go; how `CLAUDE_CODE_PLUGIN_DIRS` separates two folders is not checked yet: find out, then record it here), then look at the band in a new session: the bar is the last row. Without it: one blank row above the bar.

## Gotchas

- Claude Code draws the band's collapse mark `[-]` on the band's first row. When the bar is alone, `[-]` stands on the blank row. That is expected; the mod cannot move it.
- A short transcript leaves empty lines above the band, so the blank row cannot be told apart. Always send the 1-to-40 prompt first.
- Size the tmux window at start (`--size`); a resize after start can leave stale cells.
