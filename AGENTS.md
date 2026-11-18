# Agent instructions

This repository is a Claude Code mod. The repository root is the mod folder. The marketplace installs the mod from `main`.

- Checks, and how to get the API declarations: see "Development" in [README.md](README.md).
- Project terms: [CONTEXT.md](CONTEXT.md). Use them in code, comments and prose.
- Decision records: [docs/adr](docs/adr).

## Releases

A release is a merge to `main` that raises `version` in `.claude-plugin/plugin.json`. Claude Code keeps an installed copy on its build until that string changes. A merge that does not raise the version reaches no installed copy, and `claude plugin update` reports "already at the latest version".

### When to raise the version

Raise it in every pull request that changes a file under `hooks/`, `types/` or `.claude-plugin/`. These are the files that an installed copy runs.

Do not raise it in a pull request that changes only other files: tests, `README.md`, `CONTEXT.md`, `docs/`, this file, or repository configuration.

To decide, list the shipped files that the branch changes against its base:

```
git diff --name-only origin/main...HEAD -- hooks types .claude-plugin
```

If the command prints a path, the version on the branch must be higher than the version on `main`. If it prints nothing, leave the version as it is.

### Which number

The version has three numbers: `major.minor.patch`. Before 1.0.0:

- Raise `minor` and set `patch` to 0 when the person sees new or changed behaviour: a new key, a new segment, a changed look, a changed figure. Example: 0.2.0 becomes 0.3.0.
- Raise `patch` when the change only repairs behaviour that the README already describes, or when the person can see no difference. Example: 0.2.0 becomes 0.2.1.
- If you cannot tell which one applies, raise `minor`.

The step to 1.0.0 is the maintainer's decision. Do not take it without their instruction.

### How to raise it

1. Read the version on the base: `git show origin/main:.claude-plugin/plugin.json`.
2. Set `version` in `.claude-plugin/plugin.json` to the next number above it. This is the only place that states the version. `.claude-plugin/marketplace.json` has no version field. Do not add one.
3. Commit the new version in the same pull request as the change. Raise it once for each pull request, not once for each commit.
4. State the result in the pull request's Validation section: `**Version:** 0.2.0 → 0.3.0`, or `**Version:** not raised, no shipped file changed`.
5. If `main` gets a higher version before the pull request merges, merge `main` into the branch and raise the version again, above the new one. Git reports this as a conflict on the `version` line.

Never lower a version, and never use a version again. An installed copy that has that version does not update. A pull request that reverts a release is a release too: raise the version in it.

Do not create a tag, a GitHub release or a changelog. The merge is the release.

### After the merge

An installed copy takes the new version when its owner updates it. The commands are in "Update" in [README.md](README.md). Give them to the maintainer in the hand-back when the pull request raised the version.
