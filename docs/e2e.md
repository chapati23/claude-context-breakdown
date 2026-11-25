# End-to-end tests

The end-to-end suite is in `tests/e2e/`. It drives the mounted bar and pane
the way a person uses them. It reads each drawing as text lines, with the
same cell widths the screen uses. Each journey runs on both surfaces,
`terminal` and `desktop`, unless the table says otherwise.

## What the suite covers

| Journey | File | What it checks |
| --- | --- | --- |
| J1 First look and focus | `focus.test.tsx` | Levels 1, 2 and 3 at 24, 45, 64, 88 and 140 columns. Without the keys the pane shows the hint line. On the terminal it also shows dim number marks and no hotkeys. On the desktop every control keeps its hotkey in both states, because the desktop draws a hotkey as a key cap; no row has a hotkey, and the mod draws no number mark. On the terminal, with the keys (Tab in), rows 1-9 have the hotkeys 1-9, the tenth row has 0, and the rows after it have none. Below 32 columns no row has a mark or a hotkey. On the desktop every row, the eleventh too, starts its name in the same column. When `isFocused` turns false again (the terminal reports this on Escape; the desktop app does not, see the manual checklist), the drawing is the first drawing again, mark for mark. The name, bar and figures columns do not move between the two states. At each level and width, no two Buttons hold the same hotkey. Only the terminal, with the keys, draws the j and k controls (labelled ↓ and ↑); the desktop draws them at no level, in either state. The mobile app, which has no keyboard, draws the key words and the controls' key caps only while the pane holds the keys, as the terminal does; VS Code keeps them in both states, as the desktop does. That check is in `tests/desktop.test.tsx`. |
| J2 Walk every segment | `walk.test.tsx` | Opens each of the ten level-1 rows, checks level 2 against level 1 (its definition line, and p and n only for a list with pages), opens the first item (its facts line says `item 1 of` the list's count), and comes back with the ring on the row. After b, level 1 is the same drawing apart from the terminal's line that describes the ringed row, which then names the row b came back to (`levelOne` in `journeys.ts`). |
| J3 File read to the end | `fileread.test.tsx` | A Read result as loaded, changed on disk, on disk, formatted and raw. Its facts line says `item 2 of 2`, and Next item is off. Copy and mention. p steps to the Bash result before it (`item 1 of 2`); b comes back with the ring on that row. Back and close. |
| J4 Every item kind | `kinds.test.tsx` | Fifteen item kinds at level 3: breadcrumb, facts, notes and first lines. No broken text and baseline rows that do not open. Three long lines are split into pieces of at most 1,000 characters that rejoin to the whole line: one of CJK, emoji and combining marks, one whose cut falls inside a surrogate pair, and one whose cut falls between an `e` and its combining mark. The split never cuts a surrogate pair; it can start a piece with a combining mark. |
| J5 Long item and keys | `longitem.test.tsx` | A 1,200-line result: n and p page it. On the terminal, where it is the only item, n on the last page reads Next item, is off and does nothing. On the desktop, where the list has two more items, n on the last page opens the next item from its top, and Back keeps the autoFocus key. On the terminal, 10 and 60 quick j and k presses move the window one row each; j at the bottom opens the next page and k at the top opens the previous page; without the keys no Button holds a hotkey. On the desktop, level 3 draws no j or k control and no j or k key cap, with or without the keys; an arrow goes on to the engine untouched; n, p, f and v show their text and push no measure or place token, so the scroll raised for each press lands where the engine resolved it. The kit refuses the mod's own scroll calls, so the test cannot see where they land. |
| J6 List navigation by keys | `listkeys.test.tsx` | On the terminal, at levels 1 and 2, j, k and the arrows move the ring row by row: after j, j, j, ↓, ↑ the mod asks for exactly rows 2, 3, 4, 5 and 4. At the ends of level 1 the ring stays; there an arrow with no row and no page that way goes on to the engine as a scroll, and j or k asks for a scroll of one row (`scrollkeys.test.tsx`), as they do in a list with no row that opens. A Shift+Tab back onto a row is where the next j starts. Level 2 crosses pages. Enter opens the row and b comes back with the ring on it. The wheel does not move the ring. At level 3 the arrows, j and k scroll. On the desktop no level draws a j or k control or key cap, and the key words name Enter only (`⏎: Open`). Every arrow and the wheel go on to the engine. A focus move that the desktop reports writes no ring key (`keysWritten`): that is the proof that the mod moved nothing. Enter opens a row and no digit does; b comes back with the ring on the row. Without the keys no hotkey presses, and a click still opens a row. |
| J7 Life of the session | `session.test.tsx` | Start, measure, the band's hint `· /ctx for details` until `/ctx` opens the pane and then the legend with the largest segment's tokens, a burst of tool calls (the Tool results figure grows by the new result's 14k, and level 2 lists it at 14k), compaction marks, `/clear`, the light theme and the bar at two widths, on the terminal. A second terminal test follows the column `added`: none before a prompt; after the person's prompt and the burst, at 88 columns, Tool results gained 14k, the Conversation heading the sum, and the note above "All numbers are estimates."; at 64 columns (a side pane in a terminal of 150 columns) the length bars narrow and the column stays; none at 45 columns; the desktop draws the figure beside the row. Prompts of a task notification, a scheduled trigger, a peer, a plugin, an unclassified origin, `/ctx` and a meta prompt keep the base; the person's next prompt takes a new one, and so does a prompt through Remote Control (`bridge`) and one from an SDK host (`sdk`). A compaction, `/clear` and a new session remove the base: a later, larger measurement draws no column. Two more terminal tests: a prompt that a hook drops keeps the base; a prompt after a compaction takes no base from the snapshot measured before it, both before the compaction's measurement ran and after that measurement failed. On the desktop: the bar is one Client with the terminal row's text; a click posted on a segment opens its items, and one on the total opens the segments; the widget glance; the compaction mark; the light theme in the Client, the pane and the widget's pictures, with no dark colour left. |
| Goldens | `golden.test.tsx`, `golden.ts` | The terminal pane at levels 1, 2 (Tool results, and the list of servers whose tools are not loaded) and 3, at 45 and 88 columns, with and without the keys, line by line with ring, off-control and dim marks. One more entry, `level1-added/88/focused`, draws level 1 with the column `added`, after a prompt and a turn that adds a Bash result and a reply. The session has thirty such servers, so level 1 shows the Not loaded block and the list of servers has two pages. Four entries `band-1m-69k/<columns>/<hint or legend>` draw the terminal band of an early 1M session (69k used), at 145 and 85 band columns (terminals of 150 and 90), before and after `/ctx` first opens the pane. Terminal only. |
| Helpers | `helpers.test.tsx` | The text reader (`flatten`) on small trees, its marks included, and the acts (`hotkey`, `hold`, `setFocus`, `tap`) on a real pane. `hold` is checked by what the presses did: the ring record and the lit row. `hotkey` throws on a key that two Buttons hold. On the desktop, `hotkey` presses nothing while the pane does not have the keys, although the key is drawn: the test uses the key of a control (`r`), as rows there have no hotkey. |

`helpers.ts` holds the text reader and the acts. `journeys.ts` holds
readers for parts of a drawing, such as the breadcrumb and the figures.

With `marks: true`, `flatten` marks the Button that holds the ring (autoFocus)
with ⟦ ⟧, a run in the colour of a control that does not apply (`subtle`,
listed in `OFF_COLORS`) with ⟪ ⟫, and a dim run with ⟨ ⟩. With `surface: 'desktop'`, `flatten`
prints `h: ` before the label of a Button with hotkey h, for the key cap
that the native button draws (about three cells with its gap). Only
controls have a hotkey there. On `'desktop'` a numeric width on a column Box
pads a line and does not cut it: the surface wraps a long text, and an Svg,
printed `<svg>`, is wider in the text than the cells it takes on the surface.
On a row Box a numeric width still cuts the line. `hotkey`
throws when two Buttons in the drawing hold the key it presses. It presses
nothing and returns false while the pane does not have the keys (mounted or
redrawn with `isFocused` false), because a hotkey works only then. `ringWrites` records
each row the mod puts the ring on, from the writes of its `ring` state value.
Only the terminal writes a row's key; every surface writes `null` when a new
tree starts. `litRow` reads the row the terminal lights.

## How to run it

Run all checks from the mod's folder:

```sh
claude plugin test .
bunx -p typescript tsc -p .
claude plugin validate .
```

`claude plugin test .` runs the whole suite, `tests/e2e/` included, in about
4 seconds. It prints one pass or fail line per test.

## How to update the goldens

A test cannot read or write files under `claude plugin test`, so there is no
update switch. When the terminal drawing changes, the golden test fails and
prints the whole new `golden.ts` between the lines `GOLDEN-BEGIN` and
`GOLDEN-END`. To take it:

```sh
claude plugin test . 2>&1 | sed -n '/^GOLDEN-BEGIN$/,/^GOLDEN-END$/p' | sed '1d;$d' > tests/e2e/golden.ts.new
[ -s tests/e2e/golden.ts.new ] && mv tests/e2e/golden.ts.new tests/e2e/golden.ts || rm tests/e2e/golden.ts.new
```

The second line replaces `golden.ts` only when the run printed a golden
module. When it printed none, the new file is empty: the line deletes it and
keeps `golden.ts`.

Then read the diff of `golden.ts`. Keep only the lines you meant to change.
A line that changed by accident is a bug in the drawing, not a golden to
update.

## What the tests cannot see

The test kit runs the mod's hooks. It does not run the terminal or the
desktop app. A test sees the events that the mod receives, and the events
that the test raises in the engine's place. It cannot see what the app does
without an event.

The lesson came from the desktop app. An earlier design let j and k step
the ring from the row that the mod had noted last. A mix of j or k with Tab
sent the ring to the wrong row, and no test caught it. The kit models only
the events that the mod receives. Focus that the app moves by itself raises
no event, so no test could state where the focus was. Now the mod does not
assume where the focus is off the terminal: it uses the app's own keys only.

Each gap below says how it is covered: by design (the mod does not depend on
it), by a test, or only by the manual checklist.

- **Focus that the app moves by itself.** Tab and Shift+Tab raise no event on the desktop. By design: off the terminal the mod draws no key that steps the ring, and it keeps no record of the ring. Tests: `J6 desktop` in `listkeys.test.tsx` (no j or k control or key cap at any level; a focus move writes no ring key, which is the proof that the mod moved nothing), `J1 desktop` in `focus.test.tsx` (no j or k control in either state), and "off the terminal the mod keeps no record of the ring: a focus move there writes nothing" in `tests/scrollkeys.test.tsx`. That Tab walks the rows in order: manual checklist only.
- **The app's own scrolling.** By design: off the terminal every scroll of the person goes on to the engine untouched. Tests: `J6 desktop` and `J5 desktop`. That the wheel and the arrow keys move the text: manual checklist only.
- **The engine's clamp of the mod's own scrolls.** The desktop clamps a mod's scroll offset to a stale content height. By design: off the terminal the mod scrolls only to offset 0: after f, v, n and p, on a new level, and when `/ctx` opens a closed pane. `/ctx` on an open pane only gives it the keyboard there. Tests: `J5 desktop` checks that f, v, n and p push no measure or place token. "/ctx on an open level-3 pane off the terminal pushes no measure or place token and writes no ring key" in `tests/desktop.test.tsx` checks the same for `/ctx`. The kit refuses the mod's own scroll calls, so no test sees where they land. That the new text shows from its top: manual checklist only.
- **How a native button draws.** The desktop shows only the label, applies `dimColor` on the Button, and draws the hotkey as a key cap. The kit sees the props only. Tests: "a desktop control that does not apply is drawn dimmer than a live one, with no child" in `tests/desktop.test.tsx` checks the props, and J1 checks that every row starts its name in one column; rows have no key cap there. The `h: ` model of the key cap applies to the controls only. How the app paints them: manual checklist only.
- **The pointer column that the desktop reports to the bar.** Tests: "targetAt maps a bar column to its run, and every column from the total on to the total", "a click on the total’s last character or on the legend opens level 1; a click on a bar cell does as before" and "the Client module draws the runs, swaps the legend for a name under the pointer, and posts a click" in `tests/desktop.test.tsx` start from a given column. Only the bar's cells, the `·` with the spaces beside it, the legend's swatch and the space after it are in the code font; the total and the legend's words are in the app's face, so every column from the total on opens the segments. That the app's column matches the drawn bar cells: manual checklist only.
- **A held key.** `hold` is many presses, each one settled before the next. By design off the terminal: the pane has no key of its own that steps. Real key repeat in the terminal, and its speed: no check.
- **The refocus after a redraw with a new autoFocus key.** The desktop moves the focus to an element whose autoFocus key changed. By design: a rebuild keeps the autoFocus key on the row that had it. Test: "a rebuild that puts a new item first keeps the autoFocus key on the row that had it" in `tests/desktop.test.tsx`. A page or sort change of a list names no row for the focus off the terminal, so the focus stays on the pressed control. Test: "off the terminal a page or sort change of a list names no row for the focus, until the level changes" in the same file. A step of n or p to another item keeps level 3's autoFocus key (Back off the terminal). Test: "a step to another item keeps the autoFocus key of level 3, so off the terminal the focus stays on the pressed control" in the same file. That the focus stays: manual checklist only.
- **Key delivery.** The kit sends no Escape, Tab, Shift+Tab or arrow. `setFocus` redraws with `isFocused`, as the engine does when the pane gets or loses the keys. A test raises an arrow as a person-origin `ui.scroll`. That the desktop app delivers these keys: manual checklist only.
- **The ui.fault fallback for the bar.** When the desktop's bar Client fails, the `ui.fault` hook makes the band draw the picture row. No test can raise `ui.fault`, so the wiring of that hook is not tested. Test: "after the bar Client failed, bandTree draws the desktop bar as the picture row with the total as a Button" in `tests/desktop.test.tsx` checks only the drawing after the fault.
- **The mod's own focus and scroll calls.** The kit has no answer for `$.ui.focus`: the call rejects with "no implementation for ui.focus", and no hook of a test hears it. So no ring really moves. On the terminal a test sees the mod's ring record instead: the mod writes the target row to its `ring` state value just before each focus call, and `ringWrites` hears that write. The reveal scroll after a granted focus never runs, so no test sees it. Off the terminal the mod asks for the focus only on a new level: after n, p, s and v, and after a step of n or p to another item, the focus stays on the control that the person pressed. No test sees this either: manual checklist only. The kit also refuses the mod's own `$.ui.scroll` before any hook, so the world in each test raises the scroll that the engine would raise, and plays the engine's window.
- **The keys of controls that left the line.** On the terminal, while the pane has the keys, the pane takes the letter of a control that cannot apply on the screen (b on the segments, s in a list with one order, p and n in a list of one page or for an item of one page that is the only one of its list that opens, v, c and m for an item they do not fit) through a Button in a Box drawn `display: "none"`, keyed `taken-<letter>`. The kit presses a Button by its key, never by its hotkey, and it does not lay out `display`. A probe mod in Claude Code 2.1.328, in a terminal in tmux, showed on 2026-11-19 that such a Button keeps its hotkey (the prompt stayed empty) and also keeps a stop for Tab, on which no ring shows. So the mod's `ui.focus` hook lands a move onto a hidden Button on another element (`pastHidden` in `hooks/pane.tsx`): from Close on to the element after them (the Next page button below level 3's text, else the first element of the pane), from anywhere else back to Close. Tests: "the keys stand in fixed groups, in one order; a control that cannot apply here leaves the line" in `tests/levels.test.tsx`, "c copies the path and m mentions it" and "an item of one page that is the only one of its list that opens: p and n leave the line" there check which Buttons are drawn and which keys are taken. "on the terminal Tab passes over the hidden Buttons that take a letter" in `tests/scrollkeys.test.tsx` raises the person's focus moves onto them and reads the ring record. That the engine draws the ring where the hook lands it: seen live on 2026-11-19 in Claude Code 2.1.328 in a terminal in tmux, with Tab and Shift+Tab around the whole cycle at levels 1, 2 and 3, the ring visible on every press, and b at level 1 kept in the pane. Tab from Close then passes over the pane's close mark, which no hook can name; Shift+Tab still reaches it. That a hidden Button keeps its hotkey in a later Claude Code: no check. Off the terminal no hidden Button is drawn, as no surface but the terminal was checked.
- **The controls line's wrap.** Each group of the controls line is a row Box that wraps inside a row Box that wraps. `flatten` lays out the groups the same way: a group goes to a new line where it would pass the edge, and a group wider than the line wraps inside itself. Tests: the goldens, and "the key line breaks only between groups" in `tests/levels.test.tsx`. That the engine's layout breaks the line the same way: no check beyond the live view.
- **Which submissions raise `prompt.submit`.** The kit raises `prompt.submit` itself, with the origin, the command and `isMeta` that a test gives. It cannot show which real submissions raise the event, or with which fields. By design: only an origin of `composer`, `bridge` or `sdk`, with no command and no `isMeta`, takes the base of the column `added`, and only when no hook dropped the prompt. Test: the J7 test of the column `added`. A live check in Claude Code 2.1.328, in a terminal in tmux, showed on 2026-11-19 that `/ctx` after two prompts keeps the base: the pane opened with the column. The origin of a prompt typed in the desktop app or in VS Code was not observed live: the mod counts `sdk` because the API declarations describe it as an SDK host's own turn, and these apps are probably such hosts. Other origins: no check.
- **Paint.** `flatten` does not wrap text, draw borders, or apply grow, shrink or a percentage width. On the terminal the pane breaks the text below a table, the level 1 line that describes the ringed row, and the level 2 definition into lines itself, so the goldens show those lines as they are drawn. Off the terminal those texts wrap where the surface paints them, and `flatten` shows each as one line. It does not show colours, apart from the ⟪ ⟫ marks for the faint colour of an off control. So the heading's free part in the `warning` colour, while free space is below 10% of the window, shows only in the props: "while free space is low, the heading draws the free part in the warning colour and names the largest segment" in `tests/pane.test.tsx` checks them on all four surfaces. The goldens have 68% free, so they show no warning. The `h: ` of `flatten` for the desktop key cap is a model: the real cap's width is about three cells. Off the terminal the swatches, the length bars and the bar at level 1 are Svg pictures, which `flatten` prints as `<svg>` and counts as the cells they take: the Svg's width in cells, or else the width of its Box. Off the terminal `flatten` cuts a row Box at its numeric width, so a text that overflows a fixed column fails a test. A column Box with a numeric width only pads there, because the surface shrinks what it holds. The declarations state no size of a cell in CSS pixels, so the pictures are drawn for 8.8 pixels a cell (`MEASURED_CELL_PX`, one Mac's). Each length bar and the bar at level 1 stands in a Box of whole cells. A swatch is 10 by 10 pixels (`SVG_SWATCH_PX`). Test: "every picture whose width matters sets none and stands in a Box of whole cells, drawn for the measured cell" in `tests/grid.test.tsx` checks the props. On the desktop: manual checklist only.

## Manual checklist for the desktop app

`claude --plugin-dir .` starts a terminal session, not a desktop session. To
load this folder in the desktop app, follow
[Development](development.md). Then start a new local session in the desktop
app, so that it loads the mod as the folder has it now. Do each check. One
line per check:

- [ ] Press Tab and Shift+Tab at level 1 and at level 2: the focus walks the rows and the controls in drawing order, forward and back.
- [ ] Press Enter on the focused row: that row opens. Press b, then a digit 1 to 9: no row opens, and the digit goes to the prompt.
- [ ] Put the focus on a row of Tool results at level 2, then let Claude run a tool, so that a new item joins the list: the focus stays on its row.
- [ ] Look at the pane at each level, with and without the keys: no ↓ or ↑ control and no j or k key cap.
- [ ] Scroll a list taller than the pane with the wheel, then with the arrow keys: the list scrolls.
- [ ] Open a long Markdown item, such as a skill body, and scroll it with the wheel, then with the arrow keys: the text scrolls.
- [ ] Scroll down a long item, then press n, then p: each page shows from its top.
- [ ] Put the focus on Next page below a long item's text, then press Enter twice: two pages open, the item stays open, and the focus stays on Next page.
- [ ] Press n on the last page of an item: the next item opens from its top, and the focus stays on Next item.
- [ ] Scroll down a long item, then press f, and on a Read result v: each view shows from its top.
- [ ] Look at the controls on the last page of a list of several pages: Next page looks fainter than the live controls. Look at a list of one page and at an item without a file: Prev page and Next page (in the list), On disk, Copy path and Mention (for the item) are not in the line.
- [ ] Open the MCP tools row of Not loaded: the list of servers shows, with grey bars. Press b: the focus is on the MCP tools row again.
- [ ] Send a prompt that reads a file, then look at the segments in a pane wider than about 60 columns: the column `added` stands after the share, in line with the header, and `added: tokens since your last prompt.` is below the table.
- [ ] Look at the controls line of a pane narrower than its keys: it breaks between groups, never inside a group that fits on one row.
- [ ] Press Escape in the pane: the keys go back to the prompt, and the key caps on the controls stay in place and keep their style. The rows have no key cap. The hint line does not show at once: in Claude Code 2.1.331 the desktop app keeps telling the mod that the pane has the keyboard after Escape, also across a redraw after a prompt (seen 2026-11-24). It shows once the window loses and regains the focus.
- [ ] Click the pane after Escape: the keys come back, and no row, bar or figure moves.
- [ ] Look at a segment's row at level 1: the swatch, then the native button with the name and no key cap.
- [ ] Look at the rows of a long list, the tenth and the eleventh included: every name starts in the same column, and the length bars and each figure column line up from row to row.
- [ ] Look at the segments: the picture of the bar fills the grid's width under the heading, and the column names stand over their figures.
- [ ] Point at each segment of the bar: the other segments turn dim, and a name with its tokens takes the place of the legend: the full name where it fits, else the short name, else the short name cut with an ellipsis. A cut with an ellipsis is correct. Nothing is cut at the right edge. Where the legend's place is very narrow, no name shows.
- [ ] Click a segment of the bar: the pane opens its items. Click the total, then the legend: the pane opens the segments. Point at the total and at the legend: no segment turns dim.
- [ ] Look at the segments in a session with less than 10% of the window free: the free part of the heading is in the theme's warning colour and bold, in the dark and the light theme.
- [ ] Make the band as wide as the bar row needs, or a little narrower: the total and the legend show whole, with nothing cut at the right. Point at the largest segment: its name and tokens show whole in the legend's place.
- [ ] Load a second mod that draws a row above the prompt, then look at the band: the bar is the last row, right above the prompt, and the other mod's row stands above it. Without the second mod: one blank row separates the bar from the line above the band.
- [ ] In a new session, before you open the pane, look right of the total: it reads `· /ctx for details`. Click the bar or run `/ctx`, close the pane: the legend names the largest segment and its tokens.
- [ ] Look at the text right of the bar in the desktop app: the gaps before the `·`, after it and after the legend's swatch are each as wide as one cell of the bar. The total, the swatch and the legend's words do not stand closer than that.
- [ ] Set the app's zoom to 90%, then to 110%, and look at each level: no picture passes its column or the grid's right edge, every figure stays on one line, each figure column lines up from row to row, and no item title's button runs into its detail. App zoom scales the cell and the text together, so this item checks proportional scaling only.
- [ ] If the app offers another interface font size, set it, and look at each level again with the same checks: this changes the text against the cell.
- [ ] Make the pane about 60, then about 66 columns wide: the bar picture and the right figure column end inside the pane, with space before its right edge.
- [ ] Make the pane about 60 columns wide, then about 46. At level 1, look at `System prompt and built-in tools` at each width: the row shows the full name where it fits, else its short name, else the short name cut. At about 46 columns, open MCP tools and instructions in a session with two tools of one server, such as `mcp__notes__search` and `mcp__notes__lookup`: each title is cut in its middle, keeps both ends, and the two labels differ. Open Tool results with a Read result of a long file path: the path is cut at its head, stays inside its column and keeps the end of its file name.
- [ ] Look at the segments in the dark and in the light theme: the dots of free space and the stripes of the reserve can be seen on their grey ground.
- [ ] Open the pane and the bar in the editor (VS Code): the total, the `·` and the legend's words are in the editor's own face, and the figures line up.
