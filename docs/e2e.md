# End-to-end tests

The end-to-end suite is in `tests/e2e/`. It drives the mounted bar and pane
the way a person uses them. It reads each drawing as text lines, with the
same cell widths the screen uses. Each journey runs on both surfaces,
`terminal` and `desktop`, unless the table says otherwise.

## What the suite covers

| Journey | File | What it checks |
| --- | --- | --- |
| J1 First look and focus | `focus.test.tsx` | Levels 1, 2 and 3 at 24, 45, 64, 88 and 140 columns. Without the keys the pane shows the hint line. On the terminal it also shows dim number marks and no hotkeys. On the desktop every Button keeps its hotkey in both states, because the desktop draws a hotkey as a key cap, and the mod draws no number mark. With the keys (Tab in) rows 1-9 have the hotkeys 1-9 and the tenth row has none. Below 32 columns no row has a mark or a hotkey. On the desktop a row with a key cap and a row without one start their names in the same column. After Escape the drawing is the first drawing again, mark for mark. The name, bar and figures columns do not move between the two states. At each level and width, no two Buttons hold the same hotkey. Only the terminal, with the keys, draws Down and Up (j and k); the desktop draws them at no level, in either state. |
| J2 Walk every segment | `walk.test.tsx` | Opens each of the ten level-1 rows, checks level 2 against level 1, opens the first item, and comes back with the ring on the row. |
| J3 File read to the end | `fileread.test.tsx` | A Read result as loaded, changed on disk, on disk, formatted and raw. Copy, mention, back and close. |
| J4 Every item kind | `kinds.test.tsx` | Fifteen item kinds at level 3: breadcrumb, facts, notes and first lines. No broken text and baseline rows that do not open. Three long lines are split into pieces of at most 1,000 characters that rejoin to the whole line: one of CJK, emoji and combining marks, one whose cut falls inside a surrogate pair, and one whose cut falls between an `e` and its combining mark. The split never cuts a surrogate pair; it can start a piece with a combining mark. |
| J5 Long item and keys | `longitem.test.tsx` | A 1,200-line result: n and p page it. On the terminal, 10 and 60 quick j and k presses move the window one row each; j at the bottom opens the next page and k at the top opens the previous page; without the keys no Button holds a hotkey. On the desktop, level 3 draws no Down or Up and no j or k key cap, with or without the keys; an arrow goes on to the engine untouched; n, p, f and v show their text and push no measure or place, so the scroll raised for each press lands where the engine resolved it. |
| J6 List navigation by keys | `listkeys.test.tsx` | On the terminal, at levels 1 and 2, j, k and the arrows move the ring row by row: after j, j, j, ↓, ↑ the mod asks for exactly rows 2, 3, 4, 5 and 4. Level 1 stops at its ends; there an arrow with no row and no page that way goes on to the engine as a scroll. A Shift+Tab back onto a row is where the next j starts. Level 2 crosses pages. Enter opens the row and b comes back with the ring on it. The wheel does not move the ring. At level 3 the arrows, j and k scroll. On the desktop no level draws Down, Up, j or k, and the key words name Tab alone. Every arrow and the wheel go on to the engine. A focus move that the desktop reports writes no ring key, and the tree still asks for the ring on the first row. The digits and Enter open rows, and b comes back with the ring on the row. Without the keys no hotkey presses, and a click still opens a row. |
| J7 Life of the session | `session.test.tsx` | Start, measure, a burst of tool calls (the Tool results figure grows by the new result's 14k, and level 2 lists it at 14k), compaction marks, `/clear`, the light theme and the bar at two widths, on the terminal. On the desktop: the bar is one Client with the terminal row's text; a click posted on a segment opens its items, and one on the total opens the segments; the widget glance; the compaction mark; the light theme in the Client, the pane and the widget's pictures, with no dark colour left. |
| Goldens | `golden.test.tsx`, `golden.ts` | The terminal pane at levels 1, 2 and 3, at 45 and 88 columns, with and without the keys, line by line with ring, off-control and dim marks. Terminal only. |
| Helpers | `helpers.test.tsx` | The text reader (`flatten`) on small trees, its marks included, and the acts (`hotkey`, `hold`, `setFocus`, `tap`) on a real pane. `hold` is checked by what the presses did: the ring record and the lit row. `hotkey` throws on a key that two Buttons hold. On the desktop, `hotkey` presses nothing while the pane does not have the keys, although the key is drawn. |

`helpers.ts` holds the text reader and the acts. `journeys.ts` holds
readers for parts of a drawing, such as the breadcrumb and the figures.

With `marks: true`, `flatten` marks the Button that holds the ring (autoFocus)
with ⟦ ⟧, a run in the colour of a control that does not apply (`subtle`,
listed in `OFF_COLORS`) with ⟪ ⟫, and a dim run with ⟨ ⟩. With `surface: 'desktop'`, `flatten`
prints `h: ` before the label of a Button with hotkey h, for the key cap
that the native button draws (about three cells with its gap). `hotkey`
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

- **Focus that the app moves by itself.** Tab and Shift+Tab raise no event on the desktop. By design: off the terminal the mod draws no key that steps the ring, and it keeps no record of the ring. Tests: `J6 desktop` in `listkeys.test.tsx` (no Down, Up, j or k at any level; a focus move writes no ring key; the tree still asks for the ring on the first row), `J1 desktop` in `focus.test.tsx` (no Down or Up in either state), and "off the terminal the mod keeps no record of the ring: a focus move there writes nothing" in `tests/scrollkeys.test.tsx`. That Tab walks the rows in order: manual checklist only.
- **The app's own scrolling.** By design: off the terminal every scroll of the person goes on to the engine untouched. Tests: `J6 desktop` and `J5 desktop`. That the wheel and the arrow keys move the text: manual checklist only.
- **The engine's clamp of the mod's own scrolls.** The desktop clamps a mod's scroll offset to a stale content height. By design: off the terminal the mod scrolls only to offset 0, after f, v, n and p. Test: `J5 desktop` checks that each of those scrolls lands at 0. That the new text shows from its top: manual checklist only.
- **How a native button draws.** The desktop shows only the label, applies `dimColor` on the Button, and draws the hotkey as a key cap. The kit sees the props only. Tests: "a desktop control that does not apply is drawn dimmer than a live one, with no child" in `tests/desktop.test.tsx` checks the props, and J1 checks the name columns under the `h: ` model of the key cap. How the app paints them: manual checklist only.
- **The pointer column that the desktop reports to the bar.** Tests: "targetAt maps a column to the target of the run that covers it" and "the Client module draws the runs, swaps the legend for a name under the pointer, and posts a click" in `tests/desktop.test.tsx` start from a given column. That the app's column matches the drawn cells: manual checklist only.
- **A held key.** `hold` is many presses, each one settled before the next. By design off the terminal: the pane has no key of its own that steps. Real key repeat in the terminal, and its speed: no check.
- **The refocus after a redraw with a new autoFocus key.** The desktop moves the focus to an element whose autoFocus key changed. By design: a rebuild keeps the autoFocus key on the row that had it. Test: "a rebuild that puts a new item first keeps the autoFocus key on the row that had it" in `tests/desktop.test.tsx`. That the focus stays: manual checklist only.
- **Key delivery.** The kit sends no Escape, Tab, Shift+Tab or arrow. `setFocus` redraws with `isFocused`, as the engine does when the pane gets or loses the keys. A test raises an arrow as a person-origin `ui.scroll`. That the desktop app delivers these keys: manual checklist only.
- **The mod's own focus and scroll calls.** The kit has no answer for `$.ui.focus`: the call rejects with "no implementation for ui.focus", and no hook of a test hears it. So no ring really moves. On the terminal a test sees the mod's ring record instead: the mod writes the target row to its `ring` state value just before each focus call, and `ringWrites` hears that write. The reveal scroll after a granted focus never runs, so no test sees it. The kit also refuses the mod's own `$.ui.scroll` before any hook, so the world in each test raises the scroll that the engine would raise, and plays the engine's window.
- **Paint.** `flatten` does not wrap text, draw borders, or apply grow, shrink or a percentage width. It does not show colours, apart from the ⟪ ⟫ marks for the faint colour of an off control. Its `h: ` for the desktop key cap is a model: the real cap's width is about three cells. On the desktop: manual checklist only.

## Manual checklist for the desktop app

`claude --plugin-dir .` starts a terminal session, not a desktop session. To
load this folder in the desktop app, follow "Development" in
[README.md](../README.md). Then start a new local session in the desktop
app, so that it loads the mod as the folder has it now. Do each check. One
line per check:

- [ ] Press Tab and Shift+Tab at level 1 and at level 2: the focus walks the rows and the controls in drawing order, forward and back.
- [ ] Press Enter on the focused row: that row opens. Press b, then a digit 1 to 9: that row opens.
- [ ] Put the focus on a row of Tool results at level 2, then let Claude run a tool, so that a new item joins the list: the focus stays on its row.
- [ ] Look at the pane at each level, with and without the keys: no Down or Up control and no j or k key cap.
- [ ] Scroll a list taller than the pane with the wheel, then with the arrow keys: the list scrolls.
- [ ] Open a long Markdown item, such as a skill body, and scroll it with the wheel, then with the arrow keys: the text scrolls.
- [ ] Scroll down a long item, then press n, then p: each page shows from its top.
- [ ] Scroll down a long item, then press f, and on a Read result v: each view shows from its top.
- [ ] Look at the controls on the last page of a list, and at an item without a file: the controls that do not apply (Next page, Copy path, Mention) look fainter than the live ones.
- [ ] Press Escape in the pane: the keys go back to the prompt, the hint line shows, and the key caps on the rows and controls stay in place and keep their style.
- [ ] Click the pane after Escape: the keys come back, and no row, bar or figure moves.
- [ ] Look at a row: the native button shows the key cap and the name, and the digit is drawn once.
- [ ] Look at the tenth row of a long list: its name starts in the same column as the names of rows 1 to 9.
- [ ] Point at each segment of the bar: the other segments turn dim, and the segment's name and tokens take the place of the legend.
- [ ] Click a segment of the bar: the pane opens its items. Click the total: the pane opens the segments.
