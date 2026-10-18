#!/usr/bin/env bash
# Install the EGX bundle into the «Monos» desktop app (the rebranded DeepSeek Harness copy,
# created by scripts/rebrand-desktop.sh).
# Prerequisites: "Monos.app" in /Applications, launched once (creates ~/.dsh/profiles/desktop),
# and `uv` installed. Quit the app before running this.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
APP="/Applications/Monos.app"
DSH="$APP/Contents/Resources/runtime/cli/bin/dsh"
UV="$(command -v uv || true)"

[ -x "$DSH" ] || { echo "Monos.app is not installed in /Applications (create it with scripts/rebrand-desktop.sh)" >&2; exit 1; }
[ -n "$UV" ] || { echo "uv is not installed (brew install uv)" >&2; exit 1; }
[ -f "$DSH_HOME/profiles/desktop/package.json" ] || { echo "Launch Monos once, quit it, then rerun" >&2; exit 1; }
if pgrep -f "Monos.app/Contents/MacOS" >/dev/null; then
  echo "Quit Monos first (the app owns its profile while running)" >&2; exit 1
fi

echo "→ Python MCP server"
"$UV" sync --project "$ROOT/mcp"

echo "→ Harness-home environment ($DSH_HOME/.env)"
ENV_FILE="$DSH_HOME/.env"
touch "$ENV_FILE"
for pair in "EGX_HOME=$ROOT" "EGX_DATA_DIR=$ROOT/data" "EGX_UV=$UV"; do
  key="${pair%%=*}"
  grep -v "^$key=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  echo "$pair" >> "$ENV_FILE"
done

echo "→ EGX bundle into the desktop profile"
"$DSH" plugin --profile desktop add "link:$ROOT/bundle"

echo "Done. Open Monos: new sessions use the egx-analyst preset, and the sidebar has المحفظة."
