#!/usr/bin/env bash
# Run the EGX analyst in the DeepSeek Harness web UI from this checkout.
# Uses a project-local Harness home (.dsh-dev) so the user's ~/.dsh is untouched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export EGX_HOME="$ROOT"
export DSH_HOME="${DSH_HOME:-$ROOT/.dsh-dev}"
# Development uses its own database so the desktop app's real data is never touched.
export EGX_DB_PATH="${EGX_DB_PATH:-$DSH_HOME/egx-dev.sqlite}"
# The desktop app owns the automatic EODHD refresh; dev only syncs when asked (button or EGX_AUTO_SYNC=1).
export EGX_AUTO_SYNC="${EGX_AUTO_SYNC:-0}"
export EGX_UV="${EGX_UV:-$(command -v uv)}"
exec "$ROOT/harness/node_modules/.bin/dsh" --profile egx --no-open --port "${PORT:-3180}" "$@"
