# Pi Coder

Pi Coder is a Pi extension that chooses a model once for each new user request and writes local usage records after provider responses. It uses Pi's agent loop and authentication; it is not a Pi fork or a separate TUI. It does **not** invoke, supervise, or reuse sessions from the Claude Code CLI or Codex CLI.

## Setup

Requires Node.js 22.19+ and Pi `@earendil-works/pi-coding-agent` 0.87.1. Bun is used to build and verify this repository.

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.87.1
bun install
bun run build
pi --list-models
```

Authenticate the direct `anthropic`, `openai-codex`, or `openai` provider using Pi's `/login` flow or its supported provider environment variables. Pi's `anthropic` login supports its own Claude Pro/Max OAuth credential; this is separate from harnessing or reusing a Claude Code CLI process/session. `openai-codex` is Pi's ChatGPT/Codex subscription provider; `openai` is the API-key provider. Pi Coder never stores credentials. It checks Pi's resolved endpoint and discards any returned authentication material without logging it. The auxiliary router call goes through `ctx.modelRegistry.streamSimple()`, which resolves Pi's provider authentication at request time. An authenticated Pi model is required for every configured routing candidate.

Create a user configuration file. Replace model IDs with exact IDs shown by `pi --list-models` if your Pi catalogue differs. The `tier` labels are your policy choices, not inferred model capabilities.

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/pi-coder"
cat > "${XDG_CONFIG_HOME:-$HOME/.config}/pi-coder/config.json" <<'JSON'
{
  "models": [
    { "provider": "anthropic", "id": "claude-haiku-4-5", "tier": "fast" },
    { "provider": "anthropic", "id": "claude-sonnet-4-6", "tier": "balanced" },
    { "provider": "anthropic", "id": "claude-opus-4-6", "tier": "strong" },
    { "provider": "openai-codex", "id": "gpt-5.6-sol", "tier": "strong" }
  ],
  "routerModel": "anthropic/claude-haiku-4-5"
}
JSON
```

`routerModel` is optional. Without it, Pi Coder uses the cheapest eligible configured model by Pi's input plus output list rates. If a configured router model is unavailable or its call fails, the current model stays selected when eligible; otherwise the policy tries a balanced candidate. Router output must be one valid `select_route` tool call with closed enum fields. Free-form text is never parsed as a decision.

Run from the project where you want to use Pi. Review the built extension first and pass its absolute path explicitly:

```sh
PI_CODER_EXT="/absolute/path/to/pi-coder/dist/extension.js"
pi --no-extensions --extension "$PI_CODER_EXT"
```

`--no-extensions` disables discovered and configured extensions, including project extensions; Pi still loads the explicit reviewed `--extension` path. Pi Coder has no `pi-coder` bin because Pi already provides the trusted launcher and TUI.

The package manifest also supports normal Pi package installation after publication (`pi install npm:@pal-bot/pi-coder@0.1.0`). Use the explicit command above when you want to restrict extension loading.

## Controls and policy

Use `/route status`, `/route auto`, `/route off`, or `/route tier fast|balanced|strong|long`. A manual tier wins over the router and the automatic high-risk floor. Selecting a Pi model manually turns routing off until `/route auto`; Pi keeps that model. The chosen model stays active through tool-loop continuations. Pi Coder sets both model and thinking level through Pi's public extension API.

Only models configured in `config.json`, available and authenticated in Pi, within Pi's active model scope, and hosted at the direct Anthropic, OpenAI Codex subscription, or OpenAI API endpoints are eligible for automatic routing. Pi Coder checks both the model URL and Pi's resolved endpoint override. OpenRouter and proxy endpoints are excluded. Image and context-window requirements filter candidates. Valid automatic decisions for high-risk requests require `strong` or `long`; low-confidence decisions cannot downgrade the current configured model. Large contexts discourage model and provider switches to preserve cache value. If no candidate meets a constraint, Pi Coder leaves Pi's current model alone and warns.

## Local usage and privacy

Pi Coder appends one `provider_response` JSONL event for each finalized assistant message, a separate `router_call` event for an attempted auxiliary call, and one `request_settled` aggregate after Pi reports full settlement. Files are stored at `${XDG_STATE_HOME:-~/.local/state}/pi-coder/usage/YYYY-MM/<Pi-session-id>.jsonl`. Created directories use mode `0700`; files use `0600` on systems that support POSIX permissions.

Records contain schema version, event and request IDs, Pi session ID, provider and model, tier/confidence/reason code, token and cache usage, reasoning tokens when reported, estimated USD cost, optional latency and stop reason, and pricing rates when available. They contain no prompts, responses, source files, commands, paths, headers, credentials, or project identifier. The router receives only the latest user prompt and coarse context band, image presence, current tier, and risk flag. There is no upload or telemetry sharing.

**Dollar amounts are equivalent API-price estimates, not billed charges.** Pi Coder multiplies reported token categories by Pi catalogue USD-per-million-token rates, including cache read/write and request-wide tiers. Reasoning tokens are a subset of output and are not charged twice. Missing or stale catalogue prices, subscription plans, and provider billing adjustments can make estimates differ from invoices. A zero estimate when pricing is unavailable does not mean the call was free.

## Verify

```sh
bun install
bun run format
bun run lint
bun run typecheck
bun run test
bun run build
bun audit
npm pack --dry-run
```

CI runs separate locked-install, format-check, lint, typecheck, test, build, audit, and package-verification steps. No release or publish automation is included.

## Current limits

The deterministic high-risk detector uses a conservative keyword check on the latest prompt; it does not inspect files or tool output. Tiers are configured manually, and no dashboard or project grouping is included. The auxiliary router uses a constrained tool schema with runtime validation, but a model that does not emit the tool call causes safe fallback. Pi's `message_end` and `agent_settled` hooks provide the usage and settlement boundaries; provider billing systems remain the source of billed amounts.

Pi API references: [extension hooks](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/core/extensions/types.ts), [model registry](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/core/model-registry.ts), [Pi packages](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/packages.md).
