# Domain glossary — lmnr-claude-code-plugin

The ubiquitous language for the plugin. The pipeline is a chain of
representations: **Row → Turn → OTel spans (a Laminar trace)**. Keep these
terms in code, comments, and commits; don't drift into "message", "event", or
"log line" for a Row, or "component"/"service" for a module.

## Data representations

- **Row** — one raw line of a Claude Code session transcript JSONL (`~/.claude/projects/.../<session>.jsonl`), parsed to a plain object. The untyped source shape. Row accessors live in `transcript.ts`.
- **Turn** — one conversational exchange assembled from Rows: a user prompt, the assistant messages that answer it (merged by `message.id`), the tool results, and injected context. Built by `buildTurns` in `turns.ts`. One Turn → one Laminar trace.
- **Generation** (a.k.a. "LLM Call") — a single assistant model response within a Turn; becomes an `LLM` span carrying the `gen_ai.*` attributes.
- **Laminar trace** — the OTel span tree emitted for one Turn: a root `DEFAULT` span with child `LLM` / `TOOL` / subagent spans, grouped into a session via `lmnr.association.properties.session_id`.

## Async-agent lifecycle (owned by `deferral.ts`)

- **Async-agent launch** — a `Task`/`Agent` tool whose result is deferred (Claude Code marks it `toolUseResult.status == "async_launched"`). Detected by `isAsyncAgentLaunchResult`.
- **Deferral** — holding a Turn that launched an async agent until its result arrives, so the Turn's trace is complete. Deferred Turns' Rows live in `SessionState.pendingAgentTurns` and are replayed on a later hook run.
- **Task-notification** — the `<task-notification>` Row Claude Code writes when an async agent reports back; parsed by `notifications.ts`, attributed to its launching tool via `tool-use-id` or the **agentId→toolUseId bridge** (`getTaskIdToToolUseId`), then merged into the Turn as the tool result's `finalContent`.
- **Subagent** — a Task/Agent's own transcript (a nested set of Rows under `.../subagents/`), discovered by `subagents.ts` and rendered as a nested span subtree under its launching tool span.

## Module roles (the two seams that matter)

- **Renderer** (`emit.ts`) — pure `Turn → OTel spans`. Knows nothing about fs, byte offsets, or `SessionState`.
- **Pipeline** (`pipeline.ts`) — the stateful orchestration around the renderer: incremental Row reading, trailing-turn hold, deferral resolution, subagent discovery, byte-offset persistence, and export gating.
- **Wire-format serializer** (`genai.ts`) — owns the `gen_ai.*` message/usage translation (Anthropic content → OpenAI-style messages); knows nothing about span timing.
