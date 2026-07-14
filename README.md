# Laminar plugin for Claude Code

Trace your [Claude Code](https://claude.com/claude-code) sessions in [Laminar](https://www.lmnr.ai).

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
   claude plugin install laminar@laminar --scope user
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
| `LMNR_PARENT_SPAN_CONTEXT` | — | Optional serialized Laminar span context (from `Laminar.serialize_span_context()` / SDK equivalent). When set, Claude Code turn root spans are emitted as children of that span so they join the caller's trace. |

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
