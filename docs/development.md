# Development

The repository root is the mod folder. Three checks must pass:

```
claude plugin validate .
claude plugin test .
tsc -p .
```

`tsc` needs TypeScript 5.4 or newer and the API declarations in `.claude-plugin/types/`. Claude Code writes them when it loads the folder as a mod, for example with `claude --plugin-dir .`. Git ignores that folder, so a new clone or worktree does not have it. Load the folder once as a mod, or copy `.claude-plugin/types/` from a checkout that has it. `claude plugin validate .` and `claude plugin test .` do not need the folder; only `tsc -p .` does. Without the folder, `tsc` stops with TS5083 and writes no file. If `tsc` is not on your PATH, run `npx --yes -p typescript@5.9.3 tsc -p .`, or use any other TypeScript 5.4 or newer.

The icon `.claude-plugin/icon.png` is a 1024 px export of `docs/img/icon.svg`. `icon` in `plugin.json` names the file for the plugin directory; Claude Code does not read that field. One unit of the drawing is one pixel at 34 px. The lists of the directory at claude.ai/directory drew their icons at that size on 2026-11-20. To change the icon, change the drawing and export it again; a browser at a 1024 by 1024 window can do that. The plugin directory accepts a square PNG of 512 to 2048 px on each side, under 2 MB, and reads it only once: the first time the plugin is saved or submitted in the developer portal. A later change of the file does not change the icon of that listing. `claude plugin validate` states this rule when the file is missing. So settle the icon before the first save, and check it in the portal.

A pull request that changes a file under `hooks/`, `types/` or `.claude-plugin/` must raise the version in `.claude-plugin/plugin.json`. Without a new version, an installed copy does not update. The rule is in "Releases" in [AGENTS.md](../AGENTS.md). `scripts/check-version.sh origin/main` checks it, and CI runs that script on every pull request. A pull request merges only when this check passed.

The desktop app has no `--plugin-dir` flag. To load the folder in its local sessions, add two entries to the `env` block of `~/.claude/settings.json`, then start a new session:

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/claude-context-breakdown",
  "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
}
```

`CLAUDE_CODE_PLUGIN_DIR_WATCH` makes the session reload the mod when a file changes.

Project terms are defined in [CONTEXT.md](../CONTEXT.md). The users, the purpose and the constraints that bind a design are in [PRODUCT.md](../PRODUCT.md). Decision records are in [docs/adr](adr).
