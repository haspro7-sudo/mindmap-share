#!/usr/bin/env bash
# Install (or update) the OpenAI Codex CLI and verify that GPT-6 Astra is usable.
#
# Usage:
#   scripts/setup-codex.sh            # install/update + verify
#   scripts/setup-codex.sh --check    # verify only (no install)
#
# GPT-6 Astra needs:
#   * Codex CLI >= 0.153.1
#   * an OpenAI credential (OPENAI_API_KEY, or `codex login`)
#   * network access to api.openai.com / chatgpt.com
#   * an OpenAI account/workspace where the model is enabled
set -euo pipefail

MIN_VERSION="0.153.1"
MODEL="gpt-6-astra"

log()  { printf '[setup-codex] %s\n' "$*"; }
fail() { printf '[setup-codex] ERROR: %s\n' "$*" >&2; exit 1; }

# version_ge A B  -> true if A >= B
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }

if [ "${1:-}" != "--check" ]; then
  command -v npm >/dev/null 2>&1 || fail "npm not found; install Node.js 22+ first."
  log "installing @openai/codex@latest ..."
  npm install -g @openai/codex@latest
fi

command -v codex >/dev/null 2>&1 || fail "codex is not on PATH."

ver="$(codex --version | awk '{print $NF}')"
version_ge "$ver" "$MIN_VERSION" \
  || fail "Codex CLI $ver is too old for $MODEL (need >= $MIN_VERSION). Run: npm install -g @openai/codex@latest"
log "codex $ver OK (>= $MIN_VERSION)"

# The model catalog is embedded in the binary, so this works offline.
if codex debug models 2>/dev/null | grep -qE "\"slug\": *\"$MODEL\""; then
  log "model catalog contains $MODEL"
else
  fail "$MODEL not found in the Codex model catalog."
fi

if [ -n "${OPENAI_API_KEY:-}" ] || [ -n "${CODEX_API_KEY:-}" ] || [ -f "${CODEX_HOME:-$HOME/.codex}/auth.json" ]; then
  log "credentials found"
else
  log "WARNING: no OpenAI credentials. Set OPENAI_API_KEY or run: codex login"
fi

code="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' https://api.openai.com/v1/models 2>/dev/null || true)"
case "$code" in
  200|401) log "api.openai.com reachable" ;;
  *)       log "WARNING: api.openai.com is not reachable (HTTP '$code'). Check network policy / proxy; Codex cannot call $MODEL until it is." ;;
esac

log "done. Try:  codex -m $MODEL \"hello\"    or    codex exec -m $MODEL \"...\""
