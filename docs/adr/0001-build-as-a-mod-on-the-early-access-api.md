---
status: accepted
---

# Build as a mod on the early-access mods API

Inside an interactive Claude Code session, code can read the per-category breakdown of the context window in one way only: the engine call `$.session.usage({ breakdown })`, which returns the data behind `/context` and is open to mods. We build the project as a Claude Code mod (a plugin of function hooks) on that call, and we accept that the mods API is early access and can change between releases without notice.

## Considered options

- **Status line script.** Rejected: the status line receives totals only (tokens used, window size, percent). Anthropic closed the request to add categories (anthropics/claude-code issue 17728) as not planned. A status line also cannot open a detail view or take clicks.
- **Transcript parser.** Rejected: the session transcript file does not hold the system prompt, the tool schemas, or the instruction files, so the baseline would be invisible. It also stores rows, not what the next request sends.
- **API proxy between Claude Code and the API.** Rejected: it sees the exact request, but it needs the user to route all traffic through a local proxy, and it cannot draw inside the session.
- **Agent SDK host.** Rejected: the SDK's `get_context_usage` request returns the same breakdown, but only to a program that hosts the session. It does not reach a session that the user started in the terminal.
- **Adopt or fork an existing mod** (whats-in-the-box, context-budget). Rejected: both draw one stretch per `/context` category. Neither splits the instruction files or the conversation, and neither shows the items inside a segment. The changes would replace most of their code.

## Consequences

- An engine update can break the mod. The checks (`claude plugin validate`, `claude plugin test`, type-check against the generated declarations) must run against each new Claude Code release.
- The mod can only be as exact as the engine's estimates. The conversation split is our own estimate on top of the engine's total for messages.
- The mod works only where mods load: Claude Code 2.1.287 or newer.
