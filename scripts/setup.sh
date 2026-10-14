#!/usr/bin/env bash
# One-time setup: Python tools, pinned Harness CLI, and an `egx` profile with the bundle installed.
# Needs: uv, node >= 22.19, pnpm (brew install uv pnpm).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export DSH_HOME="${DSH_HOME:-$ROOT/.dsh-dev}"
export EGX_HOME="$ROOT"

echo "→ Python MCP server"
uv sync --project "$ROOT/mcp"

echo "→ DeepSeek Harness CLI"
npm install --prefix "$ROOT/harness" --no-audit --no-fund
npm install-scripts approve --prefix "$ROOT/harness" \
  @deepseek-ai/dsh-subprocess-local node-pty koffi protobufjs @google/genai >/dev/null
npm rebuild --prefix "$ROOT/harness" >/dev/null

DSH="$ROOT/harness/node_modules/.bin/dsh"
if [ ! -d "$DSH_HOME/profiles/egx" ]; then
  echo "→ Creating the egx profile from the web template"
  "$DSH" --profile egx --from-default-profile web --help >/dev/null
fi

echo "→ Installing the EGX bundle"
"$DSH" plugin --profile egx add "link:$ROOT/bundle"

echo "Done. Start with: $ROOT/scripts/run-dev.sh"
