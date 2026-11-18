# Agent instructions

This repository is a Claude Code mod. The repository root is the mod folder. The marketplace installs the mod from `main`.

- Checks, and how to get the API declarations: see "Development" in [README.md](README.md).
- Project terms: [CONTEXT.md](CONTEXT.md). Use them in code, comments and prose.
- Decision records: [docs/adr](docs/adr).

## Releases

A release is a merge to `main` that raises `version` in `.claude-plugin/plugin.json`. Claude Code updates an installed copy only when that string differs from the one the copy has. A merge that keeps the version reaches no installed copy, and `claude plugin update` reports "already at the latest version".

### When to raise the version

Raise it in every pull request that changes a file under `hooks/`, `types/` or `.claude-plugin/`. These are the files that an installed copy runs.

Do not raise it in a pull request that changes only other files: tests, `README.md`, `CONTEXT.md`, `docs/`, this file, or repository configuration.

To decide, fetch the base, then list the shipped files that the branch changes against it:

```
git fetch origin main
git diff --name-only origin/main...HEAD -- hooks types .claude-plugin
```

If the second command prints a path, the version on the branch must be higher than the version on the base. If it prints nothing, leave the version as it is.

- In a clone of a fork, `origin` is the fork. Fetch the repository that the pull request targets, and use its `main` in these commands and in the steps below.
- For a pull request whose base is another branch (a stacked pull request), use that branch in place of `origin/main`.
- If a pull request adds a folder or a root file that the mod loads, add the path to this section, to the command above and to "Development" in the README, in the same pull request. If you cannot tell whether a file ships, raise the version.
- Change shipped files on `main` only through a pull request.

### Which number

The version has three numbers: `major.minor.patch`. Before 1.0.0:

- Raise `minor` and set `patch` to 0 when the person sees new or changed behaviour: a new key, a new segment, a changed look, a changed figure. Example: 0.2.0 becomes 0.3.0.
- Raise `patch` when the change only repairs behaviour that the README already describes, or when the person can see no difference. Example: 0.2.0 becomes 0.2.1.
- If you cannot tell which one applies, raise `minor`.

The step to 1.0.0 is the maintainer's decision. Do not take it without their instruction.

### How to raise it

1. Read the version on the base, after the fetch: `git show origin/main:.claude-plugin/plugin.json`.
2. Set `version` in `.claude-plugin/plugin.json` to the next number above it. This is the only place that states the version. `.claude-plugin/marketplace.json` has no version field. Do not add one.
3. Commit the new version in the same pull request as the change. A pull request has one raise above its base, however many commits it has. If a later commit changes which number applies, correct the raise: for example, from 0.2.1 to 0.3.0.
4. State the result in the pull request's Validation section: `**Version:** 0.2.0 → 0.3.0`, or `**Version:** not raised, no shipped file changed`.
5. Before the pull request merges, and after its base changes, fetch and compare again. If the version on the base is now the same as the version on the branch, or higher, merge the base into the branch and raise the version above the base's. Git reports no conflict when both sides chose the same number, so do not wait for one.

Never use a version again: a copy that already has that string does not update. Never lower a version: Claude Code compares the strings, not their order, but this rule and its readers depend on each release being higher than the one before. A pull request that reverts a release is a release too: raise the version in it.

Do not create a tag, a GitHub release or a changelog. The merge is the release.

### After the merge

An installed copy takes the new version when its owner updates it. The commands are in "Update" in [README.md](README.md). When a pull request raised the version, give these commands in the hand-back, and say that they take effect after the merge.
