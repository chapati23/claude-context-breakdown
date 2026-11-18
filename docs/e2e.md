# End-to-end tests

The end-to-end suite is in `tests/e2e/`. It drives the mounted bar and pane
the way a person uses them. It reads each drawing as text lines, with the
same cell widths the screen uses. Each journey runs on both surfaces,
`terminal` and `desktop`, unless the table says otherwise.

## What the suite covers

| Journey | File | What it checks |
| --- | --- | --- |
| J1 First look and focus | `focus.test.tsx` | Levels 1, 2 and 3 at 24, 45, 64, 88 and 140 columns. Without the keys the pane shows the hint line. On the terminal it also shows dim number marks and no hotkeys. On the desktop every Button keeps its hotkey in both states, because the desktop draws a hotkey as a key cap, and the mod draws no number mark. With the keys (Tab in) rows 1-9 have the hotkeys 1-9 and the tenth row has none. Below 32 columns no row has a mark or a hotkey. On the desktop a row with a key cap and a row without one start their names in the same column. After Escape the drawing is the first drawing again, mark for mark. The name, bar and figures columns do not move between the two states. At each level and width, no two Buttons hold the same hotkey. |
| J2 Walk every segment | `walk.test.tsx` | Opens each of the ten level-1 rows, checks level 2 against level 1, opens the first item, and comes back with the ring on the row. |
| J3 File read to the end | `fileread.test.tsx` | A Read result as loaded, changed on disk, on disk, formatted and raw. Copy, mention, back and close. |
| J4 Every item kind | `kinds.test.tsx` | Fifteen item kinds at level 3: breadcrumb, facts, notes and first lines. No broken text and baseline rows that do not open. Three long lines are split into pieces of at most 1,000 characters that rejoin to the whole line: one of CJK, emoji and combining marks, one whose cut falls inside a surrogate pair, and one whose cut falls between an `e` and its combining mark. |
| J5 Long item and keys | `longitem.test.tsx` | A 1,200-line result: n and p page it. On the terminal, 10 and 60 quick j and k presses move the window one row each, against a real window and a stale window; j at the bottom opens the next page and k at the top opens the previous page; without the keys nothing moves. On the desktop, j and k push no scroll step: 10 and 60 presses start the text one line later or earlier each, under a title and controls that stay at the top; k at the first line of page 2 opens page 1 at its end with about one window of lines; j at the last line opens the next page; without the keys no key works, and a click on Down still moves the text. In the formatted view of a skill whose text is one paragraph of 430 lines, j and k move the text one line per press, and the facts line follows. |
| J6 List navigation by keys | `listkeys.test.tsx` | At levels 1 and 2, j, k and the arrows move the ring row by row: after j, j, j, ↓, ↑ the mod asks for exactly rows 2, 3, 4, 5 and 4, on both surfaces. Level 1 stops at its ends. There an arrow with no row and no page that way goes on to the engine as a scroll. Level 2 crosses pages. Enter opens the row and b comes back with the ring on it. The wheel does not move the ring. At level 3 the arrows scroll, and so do j and k on the terminal; on the desktop j and k push no scroll step. On the desktop without the keys, a press of Down or Up at a list level changes nothing. |
| J7 Life of the session | `session.test.tsx` | Start, measure, a burst of tool calls (the Tool results figure grows by the new result's 14k, and level 2 lists it at 14k), compaction marks, `/clear`, the light theme, the bar at two widths, the desktop Client bar and the widget glance. |
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
each row the mod puts the ring on, from the writes of its `ring` state value;
`litRow` reads the row the terminal lights.

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
claude plugin test . 2>&1 | sed -n '/^GOLDEN-BEGIN$/,/^GOLDEN-END$/p' | sed '1d;$d' > tests/e2e/golden.ts.new \
  && mv tests/e2e/golden.ts.new tests/e2e/golden.ts
```

Then read the diff of `golden.ts`. Keep only the lines you meant to change.
A line that changed by accident is a bug in the drawing, not a golden to
update.

## What the kit cannot prove

The test kit runs the mod's hooks. It does not run the terminal or the
desktop app. So these stay unproven:

- **Real key repeat.** `hold` is many presses, each one settled before the
  next. The kit cannot show whether the desktop app repeats a held hotkey,
  or how fast.
- **Key delivery.** The kit sends no Escape, Tab, Shift+Tab or arrow.
  `setFocus` redraws with `isFocused`, as the engine does on Tab in and
  Escape out. An arrow is a person-origin `ui.scroll` that the test raises.
  The kit cannot show that the desktop app delivers these keys, or that it
  raises a scroll for an arrow at the bottom of the window.
- **Real focus moves.** The kit has no answer for the mod's own
  `$.ui.focus`: the call rejects with "no implementation for ui.focus", and
  no hook of a test hears it, with any matcher, beneath the plugins or in an
  inline plugin. So no ring really moves, and the test cannot see the focus
  requests themselves. It sees the mod's ring record instead: the mod writes
  the target row to its `ring` state value just before each focus call, and
  a test's `state.set` hook hears that write (`ringWrites`). The reveal
  scroll (`$.ui.scroll` to the row's key) runs only after a granted focus,
  so no test sees it or checks that it names the same key. The kit also
  refuses the mod's own `$.ui.scroll` before any hook (see J5), so the
  world in each test raises the scroll the engine would raise, and plays
  the engine's window. The desktop draws no lit row, and its
  drawing does not change on a ring move at level 1.
- **Paint.** `flatten` does not wrap text, draw borders, or apply grow,
  shrink or a percentage width. It does not show colours, apart from the
  ⟪ ⟫ marks for the faint colour of an off control. Its `h: ` for the
  desktop key cap is a model: the real cap's width is about three cells.

## Manual checklist for the desktop app

Run the mod in the desktop app with `claude --plugin-dir .` and do each
check. One line per check:

- [ ] Open a long item and press j at once, without a scroll first: the text starts one line later, and the title, facts line and controls stay at the top.
- [ ] Hold j on a long item at level 3: the text moves up line by line without a stop until you let go.
- [ ] Hold k on the same item: the text moves back down without a stop, and Up is drawn off at the first line of page 1.
- [ ] Hold j to the last line of page 1 of a long item: the next page opens at its top.
- [ ] Press k at the first line of page 2: page 1 opens at its end, with about one pane of text.
- [ ] Press j and k in the formatted view of a skill with a long paragraph, a code block and a table: each press moves the text one line, as in the raw view; inside the code block its first line stays at the top, and inside the table its header row and separator row stay at the top.
- [ ] Scroll with the wheel at level 3, then press j: the wheel scrolled the pane, and j still moves the first line by one.
- [ ] Hold j at level 2: the ring moves down row by row and crosses to the next page.
- [ ] Press ↓ and ↑ at level 1 in a list taller than the pane: the ring moves one row each, and the list does not scroll.
- [ ] Press ↓ on the last visible row of a list taller than the pane: the ring goes to the next row and the row comes into view.
- [ ] Press Tab and Shift+Tab in the pane: the ring walks the rows and controls in drawing order.
- [ ] Press Enter on the ring's row: that row opens.
- [ ] Press Escape in the pane: the keys go back to the prompt, the hint line shows, and the key caps on the rows and controls stay in place and keep their style.
- [ ] Click the pane after Escape: the keys come back, and no row, bar or figure moves.
- [ ] Scroll with the wheel at level 1: the list scrolls and the ring does not move.
- [ ] Look at a row: the native button shows the key cap and the name, and the digit is drawn once.
- [ ] Look at the tenth row of a long list: its name starts in the same column as the names of rows 1 to 9.
- [ ] Known limit: press Tab to move the ring to another row, then j. The desktop app does not tell a mod when Tab or Shift+Tab moves the focus ring, so j goes on from the row j and k last moved to, not from the row Tab went to.
- [ ] Known limit: press ↓ and ↑ in a list that fits in the pane. The arrow keys move the ring only in a list taller than the pane; in a list that fits, the app sends a mod no event for them.
