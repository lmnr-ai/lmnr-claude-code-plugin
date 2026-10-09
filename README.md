# Laminar plugin for Claude Code

Trace your [Claude Code](https://claude.com/claude-code) sessions in [Laminar](https://laminar.sh).

## What the plugin sends, and where

The plugin does nothing until you configure a Laminar project API key (see
[Installation](#installation)). Once a key is set, it runs on Claude Code's
`Stop` and `SessionEnd` hooks in every session. Each time, it reads the new part
of the session transcript and sends the completed turns to your Laminar project
as OpenTelemetry traces. They go to `https://api.lmnr.ai`, or to the `baseUrl`
you configure for a self-hosted Laminar.

Each trace contains:

- your prompt and Claude's text responses
- every tool call, with its input and output. Tool calls can include file
  contents, command output, and fetched web pages
- subagent activity, read from the subagent transcripts Claude Code writes
  next to the session transcript
- the model name and token usage of each LLM call
- the definitions of the tools offered to each LLM call: Claude Code's
  built-in tools and the tools of the MCP servers you have configured (names,
  descriptions and input schemas)
- session metadata: session id, turn number, operating system, working
  directory, git branch, Claude Code version, the transcript file's name, and
  the names of skills used in the turn
- a user id: `LMNR_USER_ID` if you set it; otherwise, if you've logged in with
  `lmnr-cli`, the email address (or user id) stored in
  `~/.config/lmnr/credentials.json`

The plugin caps each text field at 20,000 characters (`CC_LMNR_MAX_CHARS`). It
sends data only to the Laminar endpoint above: no analytics or other
third-party calls. Laminar stores the traces in your project under the
[Laminar privacy policy](https://laminar.sh/policies/privacy).

To stop sending traces, disable the plugin (`claude plugin disable lmnr@lmnr`)
or delete `~/.config/lmnr/claude-code-plugin.json`.

## Installation

```
npx lmnr-cli plugin add claude-code
```

This logs you in, lets you pick the Laminar project that should receive your
Claude Code traces, mints a project API key, writes it to
`~/.config/lmnr/claude-code-plugin.json`, and installs the plugin. No `npm
install` is needed — the runtime bundle is committed to the plugin.

### Manual installation

If you'd rather not use `lmnr-cli`, wire the plugin up by hand: install it with
Claude Code's own plugin commands, then create the config file yourself.

1. Add the Laminar marketplace and install the plugin:

   ```
   claude plugin marketplace add lmnr-ai/lmnr-claude-code-plugin
   claude plugin install lmnr@lmnr --scope user
   ```

2. Create `~/.config/lmnr/claude-code-plugin.json` with a project API key. Get
   one from the Laminar dashboard under your project's settings → API keys
   (create a dedicated key so it's clear it belongs to the plugin):

   ```
   mkdir -p ~/.config/lmnr
   cat > ~/.config/lmnr/claude-code-plugin.json <<'EOF'
   { "projectApiKey": "your-project-api-key", "baseUrl": "https://api.lmnr.ai" }
   EOF
   chmod 600 ~/.config/lmnr/claude-code-plugin.json
   ```

   `projectApiKey` is required; `baseUrl` is optional (defaults to
   `https://api.lmnr.ai`; set it to your instance for self-hosted, e.g.
   `http://localhost:8000`).

3. **Quit Claude Code and open it in a new terminal window** so it loads the
   plugin — relaunching in the same terminal can reuse the previous session and
   skip the newly installed plugin.

## Configuration

The project API key and base URL are read from
`~/.config/lmnr/claude-code-plugin.json` (written by `lmnr-cli plugin add
claude-code`):

```json
{ "projectApiKey": "...", "baseUrl": "https://api.lmnr.ai" }
```

| Source | Default | Description |
| --- | --- | --- |
| `~/.config/lmnr/claude-code-plugin.json` `projectApiKey` | — (required) | Laminar project API key |
| `~/.config/lmnr/claude-code-plugin.json` `baseUrl` | `https://api.lmnr.ai` | Laminar API base URL; for self-hosted use e.g. `http://localhost:8000` |
| `LMNR_USER_ID` | — | Optional user id attached to traces. If unset, the identity from `lmnr-cli login` (`~/.config/lmnr/credentials.json`) is used when present. |
| `LMNR_SPAN_CONTEXT` | — | Optional serialized Laminar span context (from `Laminar.serialize_span_context()` / SDK equivalent). When set, Claude Code turn root spans are emitted as children of that span so they join the caller's trace. |

The environment variables `LMNR_PROJECT_API_KEY` / `LMNR_BASE_URL` override the
file when set (handy for CI or a shell you already have configured).

Advanced env-only knobs (rarely needed): `CC_LMNR_DEBUG=true` writes a debug log
to `~/.claude/state/lmnr_hook.log`; `CC_LMNR_MAX_CHARS` caps per-field capture
length (default `20000`); `CC_LMNR_STATE_DIR` relocates the state file/lock/log
(used by the test suite).

## How it works

- **Stop hook** — fires after each assistant response; the plugin reads the new
  portion of the transcript (tracked by byte offset in
  `~/.claude/state/lmnr_state.json`), assembles complete turns, and emits them.
- **SessionEnd hook** — flushes any turns still deferred (e.g. waiting for
  background agent notifications).
- Turns that launched an async agent are deferred until the agent's task
  notification arrives, so the subagent's full trace lands under the right
  tool span.

## Development

```
npm install
npm test          # tsx --test tests/*.test.ts
npm run typecheck # tsc --noEmit
npm run build     # esbuild -> dist/hook.cjs (commit this)
```

`dist/hook.cjs` is a committed build artifact — the hooks run it directly, so
re-run `npm run build` and commit the result after changing anything in `src/`.

## License

Apache-2.0
