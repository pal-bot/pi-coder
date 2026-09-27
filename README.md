# Pi Coder

Pi Coder is a Pi extension that chooses a model once for each new user request and writes local usage records after provider responses. It uses Pi's agent loop and authentication; it is not a Pi fork or a separate TUI. Anthropic Claude Pro/Max OAuth compatibility is provided by the pinned [`@gotgenes/pi-anthropic-auth`](https://github.com/gotgenes/pi-anthropic-auth) companion extension. Pi Coder does not invoke or supervise the Claude Code CLI itself.

## Install

Requires Git, Bun 1.3.12+, and Node.js 22.19+. Download the installer, inspect it, then run it:

```sh
curl -fsSLo /tmp/pic-install.sh \
  https://raw.githubusercontent.com/pal-bot/pi-coder/main/scripts/install.sh
${PAGER:-less} /tmp/pic-install.sh
bash /tmp/pic-install.sh install
```

The installer clones `main` to `${XDG_DATA_HOME:-$HOME/.local/share}/pi-coder`, performs a frozen Bun install and build, and links `pic` into `${PIC_BIN_DIR:-$HOME/.local/bin}`. Ensure that directory is on `PATH`.

Use `pic` anywhere you would use Pi. It launches Pi with extension discovery disabled and explicitly loads the pinned Anthropic OAuth compatibility extension before Pi Coder. User arguments pass through unchanged.

```sh
pic
pic --model anthropic/claude-sonnet-4-6
pic update
```

`pic update` refuses a checkout with tracked changes, fetches `origin/main`, fast-forwards only, reinstalls the frozen lockfile, and rebuilds. Set `PIC_HOME`, `PIC_BIN_DIR`, or `PIC_REPOSITORY` to override installer defaults.

Authenticate the direct `anthropic`, `openai-codex`, or `openai` provider using Pi's `/login` flow or its supported provider environment variables. Run `/login anthropic` to use a Claude Pro/Max OAuth credential instead of `ANTHROPIC_API_KEY`. The companion extension preserves Pi's native login/refresh flow and applies the OAuth-compatible Anthropic request shaping to Pi Coder's main and auxiliary router calls. `openai-codex` is Pi's ChatGPT/Codex subscription provider; `openai` is the API-key provider. Pi Coder never stores credentials. It checks Pi's resolved endpoint and discards any returned authentication material without logging it. An authenticated Pi model is required for every configured routing candidate.

Run `/anthropic-auth:status` to verify that the compatibility extension loaded. Anthropic and Pi can still warn about or bill extra usage on unsupported call paths; OAuth is not a guarantee that every request consumes only subscription-plan allowance. Pi Coder's own calls use Pi's `ModelRuntime` path covered by the companion transport wrapper.

Pi Coder ships an opinionated model-to-tier policy, so configuration is optional. The policy is versioned in [`config/default-model-policy.json`](config/default-model-policy.json) and currently classifies the supported direct-provider catalogue by model family:

- `fast`: Haiku, Codex Spark/Luna, and selected OpenAI mini/nano models
- `balanced`: Sonnet and general GPT models
- `strong`: Opus, Sol, and Pro models
- `long`: Fable, Terra, and Astra models selected for long-context policy

Only exact IDs present in both the shipped policy and Pi's authenticated catalogue become eligible. Inspect the resolved policy and user controls with:

```sh
pic config show
pic config path
```

Use `pic config` to narrow or override the shipped policy:

```sh
# A non-empty whitelist enables allow-only mode.
pic config whitelist add anthropic/claude-sonnet-4-6
pic config whitelist remove anthropic/claude-sonnet-4-6
pic config whitelist clear

# The blacklist always wins, including over whitelist entries.
pic config blacklist add openai-codex/gpt-5.6-sol
pic config blacklist remove openai-codex/gpt-5.6-sol
pic config blacklist clear

# Override a shipped tier or restore its shipped value.
pic config tier anthropic/claude-sonnet-4-6 strong
pic config tier anthropic/claude-sonnet-4-6 default

# Pin the auxiliary routing decision model, or return to automatic selection.
pic config router anthropic/claude-haiku-4-5
pic config router auto

# Catalogue IDs absent from the shipped policy require an explicit tier.
pic config whitelist add openai-codex/future-model strong
```

Configuration is written atomically to `${XDG_CONFIG_HOME:-$HOME/.config}/pi-coder/config.json`; the directory uses mode `0700` and the file uses `0600`. Empty whitelist means the shipped defaults are active. A non-empty whitelist means only listed models are considered. These controls cannot authorize providers, proxy endpoints, or models that Pi does not report as authenticated and available.

Existing `models` arrays remain supported as a legacy explicit policy. The first mutating `pic config` command converts that array to an equivalent allow-only policy before applying the requested change; it never widens the legacy list. Without a pinned router model, Pi Coder uses the cheapest eligible resolved model by Pi's input plus output list rates; this is not necessarily Pi's currently selected model. If the router model is unavailable or its call fails, the current model stays selected when eligible; otherwise deterministic policy chooses a fallback.

Every fresh turn displays the selected worker model, tier, confidence, reason code, routing model (or policy-only fallback), and total routing-decision latency. `/route status` retains the last settled decision rather than losing it when the tool loop ends.

For development or manual loading, the command equivalent to `pic` is:

```sh
PI_CODER_EXT="/absolute/path/to/pi-coder/dist/extension.js"
pi --no-extensions \
  --extension npm:@gotgenes/pi-anthropic-auth@3.3.2 \
  --extension "$PI_CODER_EXT"
```

`--no-extensions` disables discovered and configured extensions, including project extensions; Pi still loads the two explicit reviewed extensions. The OAuth compatibility extension must load before Pi Coder.

The package manifest also supports normal Pi package installation after publication (`pi install npm:@pal-bot/pi-coder@0.2.0`). Use the explicit command above when you want to restrict extension loading.

## Controls and policy

Use `/route status`, `/route auto`, `/route off`, or `/route tier fast|balanced|strong|long`. A manual tier wins over the router and the automatic high-risk floor. Selecting a Pi model manually turns routing off until `/route auto`; Pi keeps that model. The chosen model stays active through tool-loop continuations. Pi Coder sets both model and thinking level through Pi's public extension API.

Only models resolved from the shipped policy plus user controls, available and authenticated in Pi, within Pi's active model scope, and hosted at the direct Anthropic, OpenAI Codex subscription, or OpenAI API endpoints are eligible for automatic routing. Pi Coder checks both the model URL and Pi's resolved endpoint override. OpenRouter and proxy endpoints are excluded. Image and context-window requirements filter candidates. Valid automatic decisions for high-risk requests require `strong` or `long`; low-confidence decisions cannot downgrade the current configured model. Large contexts discourage model and provider switches to preserve cache value. If no candidate meets a constraint, Pi Coder leaves Pi's current model alone and warns.

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

CI runs separate locked-install, format-check, lint, typecheck, test, build, audit, and package-verification steps.

## Releases

Conventional commits feed semantic-release. The existing OAuth MVP is baselined at `v0.1.0`; future `feat:` and `fix:` commits resolve to minor and patch releases. Release execution is deliberately manual through the GitHub Actions **Release** workflow.

The workflow uses Node 24, reruns the complete gate, updates `package.json`, creates the version commit/tag, and creates a GitHub release. `@semantic-release/npm` is configured with `npmPublish: false`: npm publication remains disabled until the package scope and registry credentials are explicitly approved.

Validate release configuration locally without publishing:

```sh
GITHUB_TOKEN="$(gh auth token)" bun run release:dry-run --no-ci
```

## Current limits

The deterministic high-risk detector uses a conservative keyword check on the latest prompt; it does not inspect files or tool output. Shipped tiers are opinionated policy and must be maintained as provider catalogues change; users can override them with `pic config`. No dashboard or project grouping is included. The auxiliary router uses a constrained tool schema with runtime validation, but a model that does not emit the tool call causes safe fallback. Pi's `message_end` and `agent_settled` hooks provide the usage and settlement boundaries; provider billing systems remain the source of billed amounts.

Pi API references: [extension hooks](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/core/extensions/types.ts), [model registry](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/core/model-registry.ts), [Pi packages](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/packages.md).
