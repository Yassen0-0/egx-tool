#!/usr/bin/env bash
# Install the Monos plugins (plugins/monos-*) into the «Monos» desktop app's profile.
# Each plugin is its own package: monos-core (egx MCP server + /egx/api), monos-analyst (the
# analyst preset), monos-identity, monos-market, monos-analyses, monos-portfolio. The packages are
# linked, so later edits in this checkout show after an app restart without reinstalling.
# The single bundle the project used before (dsh-egx-bundle) is removed if it is still installed.
#
# Prerequisites: "Monos.app" in /Applications (scripts/rebrand-desktop.sh), launched once (creates
# ~/.dsh/profiles/desktop), and `uv` installed. Quit the app before running this.
#
#   ./scripts/install-desktop.sh                 full install (Python env, ~/.dsh/.env, plugins)
#   ./scripts/install-desktop.sh --plugins-only  only (re)link the plugins
# Testing on a copy: DSH_HOME=<copy> MONOS_PROFILE=<name> ./scripts/install-desktop.sh --plugins-only
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${MONOS_PROFILE:-desktop}"
APP="${MONOS_APP:-/Applications/Monos.app}"
DSH="$APP/Contents/Resources/runtime/cli/bin/dsh"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PLUGINS_ONLY=0
[ "${1:-}" = "--plugins-only" ] && PLUGINS_ONLY=1

[ -x "$DSH" ] || { echo "Monos.app is not installed in /Applications (create it with scripts/rebrand-desktop.sh)" >&2; exit 1; }
[ -f "$PROFILE_DIR/package.json" ] || { echo "Launch Monos once, quit it, then rerun (no $PROFILE_DIR)" >&2; exit 1; }
if [ "$PROFILE" = "desktop" ] && pgrep -f "$(basename "$APP")/Contents/MacOS" >/dev/null; then
  echo "Quit Monos first (the app owns its profile while running)" >&2; exit 1
fi

if [ "$PLUGINS_ONLY" = 0 ]; then
  UV="$(command -v uv || true)"
  [ -n "$UV" ] || { echo "uv is not installed (brew install uv)" >&2; exit 1; }
  echo "→ Python MCP server"
  "$UV" sync --project "$ROOT/mcp"

  echo "→ App environment ($DSH_HOME/.env)"
  ENV_FILE="$DSH_HOME/.env"
  touch "$ENV_FILE"
  # The file can hold EODHD_API_KEY: keep it private to this user, and rewrite it in place
  # (cat >, not mv) so its inode and permissions survive.
  chmod 600 "$ENV_FILE"
  for pair in "EGX_HOME=$ROOT" "EGX_DATA_DIR=$ROOT/data" "EGX_UV=$UV"; do
    key="${pair%%=*}"
    kept="$(grep -v "^$key=" "$ENV_FILE" || true)"
    { [ -n "$kept" ] && printf '%s\n' "$kept"; echo "$pair"; } > "$ENV_FILE"
  done
fi

# pnpm (dsh plugin) runs in the profile directory; keep a copy of its manifest to roll back.
cp "$PROFILE_DIR/package.json" "$PROFILE_DIR/package.json.before-monos-plugins"

if grep -q '"dsh-egx-bundle"' "$PROFILE_DIR/package.json"; then
  echo "→ Removing the old single bundle (dsh-egx-bundle)"
  (cd "$PROFILE_DIR" && "$DSH" plugin --profile "$PROFILE" remove dsh-egx-bundle)
fi

LINKS=()
for dir in "$ROOT"/plugins/monos-*/; do
  [ -f "$dir/package.json" ] && LINKS+=("link:${dir%/}")
done
echo "→ Linking ${#LINKS[@]} Monos plugins into profile $PROFILE"
(cd "$PROFILE_DIR" && "$DSH" plugin --profile "$PROFILE" add "${LINKS[@]}")

echo "→ Checking the composed profile"
# dsh refuses --dump-config on "desktop" (the Electron app owns it), so compose a throwaway copy of
# the profile's manifest and patch layer instead; the real profile is not touched.
CHECK_HOME="$(mktemp -d)"
trap 'rm -rf "$CHECK_HOME"' EXIT
mkdir -p "$CHECK_HOME/profiles/monos-check"
for f in package.json cordis.patch.yml cordis.yml pnpm-workspace.yaml; do
  [ -f "$PROFILE_DIR/$f" ] && cp "$PROFILE_DIR/$f" "$CHECK_HOME/profiles/monos-check/"
done
sed -i '' 's/"dsh-profile-[^"]*"/"dsh-profile-monos-check"/' "$CHECK_HOME/profiles/monos-check/package.json"
(cd "$CHECK_HOME/profiles/monos-check" && DSH_HOME="$CHECK_HOME" "$DSH" plugin --profile monos-check install >/dev/null 2>&1)
DUMP="$(EGX_HOME="$ROOT" DSH_HOME="$CHECK_HOME" "$DSH" --profile monos-check --dump-config 2>&1)" || {
  echo "$DUMP" | tail -20 >&2; echo "The profile does not compose; restore with: cp $PROFILE_DIR/package.json.before-monos-plugins $PROFILE_DIR/package.json && (cd $PROFILE_DIR && $DSH plugin --profile $PROFILE install)" >&2; exit 1; }
missing=0
# Rows every install needs, plus one row per plugin that has a host half (index.js or host/).
ROWS="egx-mcp preset-egx-analyst"
for dir in "$ROOT"/plugins/monos-*/; do
  if [ -f "$dir/index.js" ] || [ -d "$dir/host" ]; then ROWS="$ROWS $(basename "$dir")"; fi
done
for row in $ROWS; do
  printf '%s\n' "$DUMP" | grep -q -- "- id: $row\$" || { echo "   missing row: $row" >&2; missing=1; }
done
printf '%s\n' "$DUMP" | grep -q 'default: egx-analyst' || { echo "   egx-analyst is not the default preset" >&2; missing=1; }
[ "$missing" = 0 ] || exit 1
echo "   all Monos rows are present"

echo "Done. Open Monos: the sidebar has Monos («السجل»); the market and analyses screens are off; new sessions still use the egx-analyst preset."
