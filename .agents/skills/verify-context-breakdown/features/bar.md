# Context bar

The bar is one row above the prompt. It shows the context window as coloured segments, then the total (`69k/1M 7%`), then a legend that names the largest segment and its tokens (`· ▉ System notifications 24k`). Until the pane is first opened in the session, the legend's place reads `· /ctx for details`. It updates after each measurement.

## Sub-features

- `bar-draw` the bar shows in a new session, before any prompt, with a total.
- `bar-hint` until `/ctx` or a click on the bar first opens the pane, the legend's place reads `· /ctx for details`.
- `bar-legend` after the pane was opened once, the legend names the largest segment and its tokens.
- `bar-update` the total grows after a turn that adds content.
- `bar-click` in the terminal's fullscreen layout, a click on the bar opens the pane at any width: a segment opens its items, a cell of several segments opens the segments.
- `bar-desktop` the desktop app draws the same row as a picture with the total, then the hint or the legend, as text.

## How to get to it (user POV)

- Start a session with the mod loaded. The bar is always visible above the prompt; there is nothing to open.

## Driving it with tui.sh and cmux-cua

Preconditions:

- Terminal: `scripts/tui.sh start bar` passed and `scripts/doctor.sh tui bar` exits 0.
- Desktop: the baseline desktop preconditions in [README.md](./README.md).

- **First look (terminal).** Run `scripts/tui.sh capture bar fresh`. One line matches the bar regex, for example `█▉▉▉····…▒▒▒ 41k/1M 4% · /ctx for details`.
- **After a prompt (terminal).** Run `scripts/tui.sh send bar "Print the numbers 1 to 40, one per line, and nothing else."`, then `scripts/tui.sh wait bar '✻ [^ ]+ for [0-9]' 90`, then `scripts/tui.sh capture bar after-prompt --html`. The total is larger than in `fresh` (for example `69k/1M 7%`) and the line still ends with `· /ctx for details`. Then `scripts/tui.sh send bar "/ctx"`, `scripts/tui.sh wait bar 'free before compaction'`, `scripts/tui.sh keys bar x`, and capture `after-ctx`: the line ends with `· ▉ <segment name> <tokens>`, for example `· ▉ System notifications 24k`.
- **Click (terminal, narrow).** Start a run at `--size 80x24`, then `scripts/tui.sh click <run> 1` (column 1 of the bar's row) and `scripts/tui.sh wait <run> '% of segment|free before compaction' 10`. The pane opens below 144 columns too. On 0.11.0 and earlier the same click opened nothing there: the open landed after the press, and Claude Code held it undrawn.
- **Desktop.** In a new desktop session send the same prompt, wait about 5 s, save `desktop-bar.png`. The row above the composer shows the bar picture, the total and the hint `· /ctx for details`; nothing is cut at the right edge. Then click the total, close the pane, and save `desktop-bar-legend.png`: the hint has made way for the legend, `· ▉ <segment name> <tokens>`.

## Gotchas

- A narrow check of `bar-click` must wait for both headings: a click on a lone segment opens its items (`% of segment`), a click on a shared cell opens the segments (`free before compaction`).
- Two bar lines on the terminal mean the installed copy also runs: `doctor` reports it. Do not judge a capture with two bars.
- The first measurement can take a few seconds after the prompt shows; `tui.sh start` already waits for the bar.
- In the desktop app, a session started before `desktop-load.sh on` runs the installed copy. Only a new session loads the build.
