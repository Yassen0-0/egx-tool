#!/usr/bin/env bash
# Run the EGX analyst in the DeepSeek Harness web UI from this checkout.
# Uses a project-local Harness home (.dsh-dev) so the user's ~/.dsh is untouched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export EGX_HOME="$ROOT"
export DSH_HOME="${DSH_HOME:-$ROOT/.dsh-dev}"
export EGX_UV="${EGX_UV:-$(command -v uv)}"
exec "$ROOT/harness/node_modules/.bin/dsh" --profile egx --no-open --port "${PORT:-3180}" "$@"
