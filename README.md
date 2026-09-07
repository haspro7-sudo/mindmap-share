# mindmap-share

## Codex CLI with GPT-6 Astra

This repository is pre-configured to run the OpenAI Codex CLI with the
`gpt-6-astra` model (released 2026-09-03, supported by Codex CLI >= 0.153.1).

* `.codex/config.toml` – project-level Codex config (`model = "gpt-6-astra"`,
  `model_reasoning_effort = "high"`). Codex applies it once the repo is trusted.
* `scripts/setup-codex.sh` – installs/updates the Codex CLI and checks the
  version, model catalog, credentials and network reachability.

### One-time setup

```bash
# 1. Install / update Codex CLI and run the checks
scripts/setup-codex.sh

# 2. Authenticate (one of)
export OPENAI_API_KEY=sk-...
codex login

# 3. Run
codex -m gpt-6-astra "hello"            # interactive
codex exec -m gpt-6-astra "summarize this repo"   # non-interactive
```

`-m gpt-6-astra` is optional once the repo is trusted, because the project
config already selects the model. Override the reasoning level with
`-c model_reasoning_effort="xhigh"` (`low|medium|high|xhigh|max|ultra`).

### Requirements outside this repo

* An OpenAI account/workspace where GPT-6 Astra is enabled. For Enterprise
  workspaces the model is disabled by default and an admin must enable it.
* Outbound HTTPS to `api.openai.com` (API key auth) or `chatgpt.com`
  (`codex login`). In Claude Code on the web this is controlled by the
  environment's network policy; add those hosts to the allowlist and set
  `OPENAI_API_KEY` as an environment variable there.

Run `scripts/setup-codex.sh --check` (or `codex doctor`) at any time to see
which of these is still missing.
