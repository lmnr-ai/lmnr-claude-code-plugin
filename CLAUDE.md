# lmnr-claude-code-plugin

Laminar observability plugin for Claude Code. Stop/SessionEnd hooks parse the session transcript incrementally and export spans to Laminar via the OpenTelemetry SDK (OTLP/HTTP/JSON). Written in TypeScript, shipped as a single committed `dist/hook.cjs` bundle run on Node.

## Layout

- `.claude-plugin/plugin.json` — plugin manifest (no `userConfig`; the plugin is config-file-driven and installs with zero prompts, symmetric with the Codex plugin).
- `.claude-plugin/marketplace.json` — marketplace manifest so `claude plugin marketplace add lmnr-ai/lmnr-claude-code-plugin` works.
- `hooks/hooks.json` — wires Stop + SessionEnd to `node ${CLAUDE_PLUGIN_ROOT}/dist/hook.cjs`.
- `dist/hook.cjs` — **committed** esbuild bundle (all deps inlined). This is what the hooks run; end users install nothing. Rebuild + commit after any `src/` change (`npm run build`).
- `src/` — the hook, split by concern:
  - `hook.ts` — entrypoint: read stdin payload, resolve session/transcript, orchestrate, always exit 0.
  - `config.ts` — config reader: API key + base URL come from `~/.config/lmnr/claude-code-plugin.json` (written by `lmnr-cli plugin add claude-code`), with `LMNR_PROJECT_API_KEY`/`LMNR_BASE_URL` env as overrides; `user_id` from `LMNR_USER_ID` env or `credentials.json`. Also `LaminarConfig`, path resolvers (`stateDir`/`stateFile`/`lockFile`/`logFile`, overridable via `CC_LMNR_STATE_DIR`).
  - `logger.ts` — size-rotated debug/info log.
  - `state.ts` — `SessionState`, per-session state persistence, `withStateLock` (`proper-lockfile`).
  - `transcript.ts` — row helpers + incremental JSONL reading (byte offset + partial-line buffer).
  - `turns.ts` — turn assembly (`buildTurns`, `mergeAssistantRows`).
  - `notifications.ts` — `<task-notification>` row format parsing.
  - `deferral.ts` — **async-agent lifecycle**: launch detection (`isAsyncAgentLaunchResult`), deferral/stash/retry (`resolveDeferredAgentTurns`), and the agentId→toolUseId attribution bridge (`getTaskIdToToolUseId`).
  - `subagents.ts` — subagent transcript discovery/reading.
  - `tracer.ts` — OTel provider + collecting span processor, `startSpan`/`SpanHandle`, `exportWithTimeout`.
  - `genai.ts` — `gen_ai.*` wire-format serialization (Anthropic→OpenAI-style messages, usage) via `buildGenerationAttributes`.
  - `emit.ts` — Turn → OTel span **renderer** (root/LLM/tool/subagent spans); `emitTurn`.
  - `pipeline.ts` — transcript → turns → export **orchestration** (`emitNewTurnsFromTranscript`, `emitReadyTurns`); owns fs/offset/state and export gating, delegates rendering to `emit.ts`.
  - `util.ts` / `types.ts` — `jsonDumps`/`getLatestTimestamp`; shared `Row`/`Json` aliases.
- `tests/` — `node:test` suite run via `tsx --test`; `helpers.ts` builds transcript rows and reads collected spans.

## Development

- Install dev deps: `npm install` (the OTel SDK, `proper-lockfile`, `esbuild`, `tsx`, `typescript` are all **devDependencies** — build/test-time only; the shipped artifact is `dist/hook.cjs`).
- Run tests: `npm test` (`tsx --test tests/*.test.ts`). Typecheck: `npm run typecheck`.
- Build the runtime bundle: `npm run build` (esbuild → `dist/hook.cjs`, CJS, deps inlined). **Commit `dist/hook.cjs`** — plugins install into a versioned, CLI-managed cache dir (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`) recreated on every update, so a user-run `npm install` would not survive updates. Committing the bundle means the plugin works with zero install after add AND after every update. Do NOT switch the hook back to `tsx src/hook.ts` (would require `node_modules` in the cache dir).

## OTLP / Laminar ingestion gotchas (verified against app-server)

- Emission goes through the OTel SDK: a `BasicTracerProvider` + collecting span processor mint spans, and `@opentelemetry/exporter-trace-otlp-http` serializes OTLP/JSON and POSTs to `{base}/v1/traces` with `Authorization: Bearer <project api key>`. Trace ids (32 hex) / span ids (16 hex) / nanosecond times / attribute-value envelopes are produced by the SDK.
- The OTel JS OTLP/JSON serializer emits integer attribute values as JSON **numbers** (e.g. `{"intValue": 10}`), not decimal strings. app-server's JSON decoder accepts `intValue` as either a number or a string, so both wire forms ingest fine (pinned by the wire-format test).
- `LMNR_SPAN_CONTEXT` may carry a serialized Laminar span context from a caller (`Laminar.serialize_span_context()` / SDK equivalent). When present and valid, Claude Code turn root spans use it as their remote parent, joining the caller's trace; when absent/invalid, standalone trace behavior is preserved.
- Spans are one Laminar trace per Claude Code turn, grouped into a session via `lmnr.association.properties.session_id` on the root span; `user_id` also goes on the root. Trace-constant context (`source`, `os`, `cwd`, `git_branch`, `claude_code_version`, `turn_number`, `transcript`, `skills`) goes in `lmnr.association.properties.metadata.*`. No `tags` are emitted. NEVER put per-span details in metadata — the app-server flattens those keys into TRACE-level metadata across ALL spans (last write wins). Use plain span attributes (e.g. `claude_code.tool.name`) for span-scoped data.
- LLM spans: `lmnr.span.type=LLM`, `gen_ai.input.messages` / `gen_ai.output.messages` as JSON strings, usage via `gen_ai.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}`.
- Spans are backdated to transcript timestamps (`startSpan(..., startTime)` / `span.end(endTime)` take `Date`s). When verifying in ClickHouse, filter `start_time` by the session's era, not the export time; the `spans` table has no `created_at`. Trace rows live in `traces_replacing` (query with `FINAL`).

## Hook behavior invariants

- Fail-open: the hook must always exit 0; a Laminar outage must never block Claude Code. Export is capped by `exportWithTimeout` so a hung connection can't stall the session.
- Per-session state (`~/.claude/state/lmnr_state.json`, or under `CC_LMNR_STATE_DIR`) stores the transcript byte offset; only advance it AFTER a successful export (`exportFn` returns true from the `ExportResultCode.SUCCESS` signal), so failed exports retry next Stop. A per-turn `emitTurn` exception is different: the turn is skipped (not counted in `turnCount`, no retry) because a malformed turn would fail identically on every retry and poison the session. Delivery is at-least-once by design: if the state write itself fails after a successful export (`saveHookState` is fail-open and only logs), the next run re-reads and re-exports the same turns as duplicate traces — exports can't be rolled back, and duplicating beats silently losing data.
- Turns with async agent launches (`toolUseResult.status == "async_launched"`) are deferred until the task-notification row arrives, or flushed at SessionEnd.
- **Unterminated final line flush:** `readNewJsonl` holds the segment after the last newline in `sessionState.buffer` as a partial line. At SessionEnd (`flushBuffer=true`), a buffered segment that parses as complete JSON is flushed as a row — otherwise a transcript ending without a trailing newline would strand its final row in the buffer forever (offset is already at EOF, so later runs read zero bytes). A genuinely partial line always fails `JSON.parse` and stays buffered. Pinned by the "complete unterminated final line flushed at session end" test.
- **Incomplete trailing turn hold (`pendingTurnRows`):** Claude Code fires `Stop` before it writes the turn's final assistant row — measured 60–80 ms later in headless `claude -p`, and in interactive sessions often only after the hook exits, so waiting inside the hook doesn't help. `splitTrailingIncompleteTurn` therefore holds the trailing turn's raw rows in state, replayed (prepended) on the next run, when (a) its user prompt has no assistant row yet, (b) its last chat row is a `tool_result` (the reply to it isn't written yet), or (c) none of its assistant rows carries the end of the Stop payload's `last_assistant_message` (passed as `finalAssistantText`; the final message can span rows, so a row's text must be a suffix). The offset still advances; the rows are re-processed from state. When the row is late, the turn is emitted one hook run later (next `Stop`, or `SessionEnd`, which never holds and flushes everything). Without the hold, a tool-using turn was emitted without its final answer and the late row was dropped as an assistant row with no prompt in front of it. Pinned by the "incomplete trailing turn (flush race)" tests.
- The state file (`~/.claude/state/lmnr_state.json`, or under `CC_LMNR_STATE_DIR`) is purely local plugin state — no external consumer reads it — so its keys use the same camelCase convention as the rest of the code. The only fields serialized verbatim are raw Claude Code transcript rows (inside `pendingAgentTurns[].rows` / `pendingTurnRows` / `pendingTaskNotifications`); everything the code owns is a typed shape (`SessionState`, `PendingAgentTurn`, `ToolResultEntry`). Wire/OTLP names are the exception and stay in their required forms: `gen_ai.usage.*` keys, OpenAI-style `tool_call_id`/`name` in tool messages, `lmnr.*` attributes.
- Keep `emitReadyTurns` / `emitNewTurnsFromTranscript`'s test seams (`emitTurnFn` / `exportFn` injection, both in `pipeline.ts`): ESM can't monkeypatch imported bindings, so these are the injection points the tests use to simulate emit/export failure.
