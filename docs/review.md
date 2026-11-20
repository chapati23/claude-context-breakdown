# Review guide

This file records checks from this repository's own review findings that were fixed. Each section names a trigger. Apply only the sections whose trigger matches the changed paths or behaviour. The checks add to the review skill's instructions; they do not replace them.

Each bullet ends with a `(class: <slug>)` tag. Each slug resolves to a line in `docs/review-classes.md`.

## The pane and the bar off the terminal

**Trigger:** a change to `hooks/grid.tsx`, `hooks/svgbar.ts`, `hooks/band.tsx` or `hooks/barclient.tsx`, or to a test of the desktop, editor or mobile surface.

- A value that off-terminal code takes from the terminal's table (a name form, a width, a fallback such as a short name) is chosen against the off-terminal surface's own room, not the terminal table's column. The grid can be wider or narrower than that column. (class: terminal-choice-reused-off-terminal)
- A test that claims a structural property off the terminal (a swatch, a padding, a left edge, a column's width) asserts the element tree: the node types, their props or a found index, not only `flatten`'s lines. `flatten` prints a picture as `<svg>`, shows no colour, drops spaces at the end of a line and ignores grow and shrink (`docs/e2e.md`, "Paint"). A lookup that finds nothing fails the test; it does not fall back to another line. (class: weak-test-oracle)
- In a row Box off the terminal, a fixed column has `flexShrink={0}`, and a text that may cut or wrap sits in a Box with `minWidth={0}`. Without them a long neighbour can squeeze the figures onto several lines or push a path past the pane's edge. `flatten` ignores shrink, so only a test of the props catches a missing bound. (class: flex-item-missing-shrink-bound)

## What a person sees

**Trigger:** a change under `hooks/` that changes what a person sees or presses on any surface.

- README (above all "Use"), `CONTEXT.md`, `docs/e2e.md` (its proof notes and the manual checklist) and the comments in the changed files and in their tests state the new behaviour. Search them for the old claim, and check each surface by name: a sentence true for the desktop app can be false for the mobile app or the terminal. (class: doc-contradicts-code)
