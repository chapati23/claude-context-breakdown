# Review classes

The defect classes that `docs/review.md` names. One line per class.

- `terminal-choice-reused-off-terminal`: Code for a surface other than the terminal reuses a choice that was made against the terminal table's column, so it is wrong for the other surface's room. First seen 2026-11-20.
- `weak-test-oracle`: A test oracle checks only part of the output, so a mutated or wrong result still passes. First seen 2026-11-20.
- `flex-item-missing-shrink-bound`: A flex item lacks the shrink bound its role needs, so a fixed column shrinks or a long text cannot shrink below its content. First seen 2026-11-20.
- `doc-contradicts-code`: Documentation or a code comment states behaviour that the code does not have. First seen 2026-11-20.
