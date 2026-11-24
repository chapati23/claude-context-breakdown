# Bar clicks on the desktop

In the desktop app the bar is clickable: a click on a segment opens that segment's items, and a click on the total, the legend or anywhere right of the bar opens the segments. Hover dims the other segments and shows the segment's name in the legend's place.

## Sub-features

- `click-segment` a click on a segment opens its items.
- `click-total` a click on the total opens the segments.
- `click-legend` a click on the legend opens the segments.
- `hover-legend` the pointer on a segment dims the others and names it.

## How to get to it (user POV)

- Click the bar above the composer in a desktop session. (In the terminal's fullscreen layout a segment click also opens its items; not covered here.)

## Driving it with tui.sh and cmux-cua

Preconditions:

- The baseline desktop preconditions in [README.md](./README.md), the user's go, and one finished prompt in a new session.

- **Locate.** `get_window_state` with `screenshot_out_file: ".verify/<run>/desktop-before-click.png"`. Find the bar row above the composer in the picture.
- **Segment.** Pixel-click the middle of the widest segment. Wait 2 s, move the pointer once, save `desktop-click-segment.png`. The pane shows that segment's items (`% of segment`).
- **Total.** Take a new `get_window_state` (the total moves when the pane opens), pixel-click the middle of the total text, wait, save `desktop-click-total.png`. The pane shows the segments (`free before compaction`).
- **Legend.** Click the widest segment again so the items show, take a new `get_window_state`, pixel-click the middle of the legend's words, wait, save `desktop-click-legend.png`. The pane shows the segments again.
- **Hover.** A foreground pixel click leaves the real pointer where it clicked. Capture right after the segment click: the other segments are dim and the legend's place holds the cell's name, for example `System +5 more 7…` (seen 2026-11-24). `move_cursor` moves only an overlay and shows no hover.

## Gotchas

- A cell that holds several small segments opens the segments, not one segment's items. While the pane is open the bar is narrower, so in a session where one segment does not pass about a third of the window every cell can be shared: on 2026-11-24 both cells were shared (`System +5 more`, `Notifications +2`), and `click-segment` could not be shown. Read the legend after the click before you call it a failure; to show it, close the pane first or use a session with one large segment.
- Use foreground delivery for the click; background delivery may not reach the app's web view.
- The bar's total shifts when the pane opens or closes. Never reuse a coordinate.
