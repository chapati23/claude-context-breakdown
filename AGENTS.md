# Agent instructions

This repository is a Claude Code mod. The repository root is the mod folder. The marketplace installs the mod from `main`.

- Checks, and how to get the API declarations: see [docs/development.md](docs/development.md).
- Product record: [PRODUCT.md](PRODUCT.md). It states the users, the purpose and the constraints that bind a design.
- Project terms: [CONTEXT.md](CONTEXT.md). Use them in code, comments and prose.
- Decision records: [docs/adr](docs/adr).
- Live checks in a real Claude Code session, in the terminal and in the desktop app: the `verify-context-breakdown` skill in [.agents/skills/verify-context-breakdown](.agents/skills/verify-context-breakdown/SKILL.md). Evidence goes to `.verify/`, which git ignores.

## Reviews on pull requests

Two reviewers read each pull request. Both are advisory: neither review is a required check.

Two rule sets guard `main`. "main: version check required" requires the version check (see "Releases"). "Pull Requests" requires a pull request with one approving review and with every review thread resolved, allows only a squash merge, and forbids a force push and the deletion of the branch. GitHub does not count an author's approval of their own pull request. A repository admin can bypass "Pull Requests"; that bypass is the maintainer's to use, not an agent's. So bring a pull request to ready, answer and resolve every thread, and hand it to the maintainer for the merge.

- **Claude** (`.github/workflows/claude-review.yml`). It reviews a pull request once: when the pull request opens, leaves draft, or is reopened. It does not review a later push. To get another review of the current head, add the label `re-review`; the job removes the label when it starts. Add the label once per head, after a push that fixes a [P1] or [P2] finding or that changes behaviour beyond what the last review saw. Do not add it for a [P3] fix, a docs change, or a merge of the base branch. Add it also when the first review failed or was cancelled: a push that arrives while the review starts makes the job fail, because the job reviews only the head that started it.
- **Codex** (the `chatgpt-codex-connector` app). It reviews each push by itself.

The Claude review posts inline comments and one summary comment with a numbered list of every finding. Answer each finding on its own surface. Start the reply to a finding that you decline with `Won't fix:`.

The prompt of the Claude review is `.github/claude/review-prompt.md`. The job reads it from the base commit, so a pull request that edits the prompt is reviewed with the prompt on its base. GitHub runs the workflow file itself from the pull request, so this does not hold for a pull request that edits the workflow file. The job runs on a GitHub-hosted runner, skips pull requests from forks and from bots, and needs the repository secret `CLAUDE_CODE_OAUTH_TOKEN`. The reviewer can read the checkout and post comments; it cannot run commands, so it does not run the checks. Of the comments on a pull request, it reads only those by the repository owner and by the two review bots.

## Releases

A release is a merge to `main` that raises `version` in `.claude-plugin/plugin.json`. Claude Code updates an installed copy only when that string differs from the one the copy has. A merge that keeps the version reaches no installed copy, and `claude plugin update` reports "already at the latest version".

### When to raise the version

Raise it in every pull request that changes a file under `hooks/`, `types/` or `.claude-plugin/`. These are the files that an installed copy runs.

Do not raise it in a pull request that changes only other files: tests, `README.md`, `CONTEXT.md`, `docs/`, this file, or repository configuration.

To decide, commit the change, fetch the base, and run the check:

```
git fetch origin main
scripts/check-version.sh origin/main
```

The script lists the shipped files that the branch's commits change against the base, and compares the two versions. It exits with 0 when the rule holds. It exits with 1 when a shipped file changed and the version on the branch is not higher than the version on the base, or when a version is not `major.minor.patch`. It exits with 2 when it cannot run the check: for example, the base is not fetched. It reads commits, not the working tree.

CI runs the same script on every pull request and on every push to `main` (`.github/workflows/version.yml`). The rule set "main: version check required" makes this check required: a pull request merges only when the check passed. The rule does not require the branch to be up to date with `main`.

- In a clone of a fork, `origin` is the fork. Fetch the repository that the pull request targets, and use its `main` in these commands and in the steps below.
- For a pull request whose base is another branch (a stacked pull request), use that branch in place of `origin/main`.
- If a pull request adds a folder or a root file that the mod loads, add the path to this section, to `SHIPPED` in the script and to [docs/development.md](docs/development.md), in the same pull request. If you cannot tell whether a file ships, raise the version.
- Change shipped files on `main` only through a pull request.

### Which number

The version has three numbers: `major.minor.patch`. Before 1.0.0:

- Raise `minor` and set `patch` to 0 when the person sees new or changed behaviour: a new key, a new segment, a changed look, a changed figure. Example: 0.2.0 becomes 0.3.0.
- Raise `patch` when the change only repairs behaviour that the README or docs/reference.md already describes, or when the person can see no difference. Example: 0.2.0 becomes 0.2.1.
- If you cannot tell which one applies, raise `minor`.

The step to 1.0.0 is the maintainer's decision. Do not take it without their instruction.

### How to raise it

1. Read the version on the base, after the fetch: `git show origin/main:.claude-plugin/plugin.json`.
2. Set `version` in `.claude-plugin/plugin.json` to the next number above it. This is the only place that states the version. `.claude-plugin/marketplace.json` has no version field. Do not add one.
3. Commit the new version in the same pull request as the change. A pull request has one raise above its base, however many commits it has. If a later commit changes which number applies, correct the raise: for example, from 0.2.1 to 0.3.0.
4. State the result in the pull request's Validation section: `**Version:** 0.2.0 → 0.3.0`, or `**Version:** not raised, no shipped file changed`.
5. Before the pull request merges, and after its base changes, fetch and compare again. If the version on the base is now the same as the version on the branch, or higher, merge the base into the branch and raise the version above the base's. Git reports no conflict when both sides chose the same number, so do not wait for one. CI checks a pull request again when its commits change or when it moves to another base branch, not when new commits land on its base branch. So a pull request that passed can break the rule after another one merges, and GitHub still allows its merge. The check on `main` then fails after the merge. Repair that with a new pull request that raises the version.

Never use a version again: a copy that already has that string does not update. Never lower a version: Claude Code compares the strings, not their order, but this rule and its readers depend on each release being higher than the one before. A pull request that reverts a release is a release too: raise the version in it.

Do not create a tag, a GitHub release or a changelog. The merge is the release.

### After the merge

An installed copy takes the new version when its owner updates it. The commands are in "Update" in [README.md](README.md). When a pull request raised the version, give these commands in the hand-back, and say that they take effect after the merge.
