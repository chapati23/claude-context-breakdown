# Bar clicks on the desktop

In the desktop app the bar is clickable: a click on a segment opens that segment's items, and a click on the total, the legend or anywhere right of the bar opens the segments. Hover dims the other segments and shows the segment's name in the legend's place.

## Sub-features

- `click-segment` a click on a segment opens its items.
- `click-total` a click on the total or the legend opens the segments.
- `hover-legend` the pointer on a segment dims the others and names it (needs real hover).

## How to get to it (user POV)

- Click the bar above the composer in a desktop session. (In the terminal's fullscreen layout a segment click also opens its items; not covered here.)

## Driving it with tui.sh and cmux-cua

Preconditions:

- The baseline desktop preconditions in [README.md](./README.md), the user's go, and one finished prompt in a new session.

- **Locate.** `get_window_state` with `screenshot_out_file: ".verify/<run>/desktop-before-click.png"`. Find the bar row above the composer in the picture.
- **Segment.** Pixel-click the middle of the widest segment. Wait 2 s, move the pointer once, save `desktop-click-segment.png`. The pane shows that segment's items (`% of segment`).
- **Total.** Take a new `get_window_state` (the total moves when the pane opens), pixel-click the middle of the total text, wait, save `desktop-click-total.png`. The pane shows the segments (`free before compaction`).
- **Hover.** Not drivable: `move_cursor` moves an overlay, not the pointer. Report `hover-legend` as not checked, or hand the user the matching line of `docs/e2e.md`.

## Gotchas

- A cell that holds several small segments opens the segments, not one segment's items. Click a wide segment.
- Use foreground delivery for the click; background delivery may not reach the app's web view.
- The bar's total shifts when the pane opens or closes. Never reuse a coordinate.
