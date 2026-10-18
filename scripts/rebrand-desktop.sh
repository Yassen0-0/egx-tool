#!/usr/bin/env bash
# Rebrand the installed DeepSeek Harness desktop app as «Monos»: the Monos app icon, the
# display name (Dock, menu bar, Force Quit) and the four helper apps Electron expects.
# Run it:
#   - once to create /Applications/Monos.app from the original app, or
#   - again after a DeepSeek app update, to re-apply the icon and name in place.
# To pick up a newer DeepSeek build, put the new "DeepSeek Harness.app" in /Applications
# first, delete the copy and re-run:
#     rm -rf /Applications/Monos.app && ./scripts/rebrand-desktop.sh
# The original app is no longer shipped on disk (owner request: nothing DeepSeek should stay
# launchable on the machine): it is archived as a zip in ~/.dsh/backups/ and this script
# unpacks that zip automatically when a fresh copy is needed. Restore to /Applications with:
#     ditto -x -k ~/.dsh/backups/DeepSeek-Harness.app.*.zip /Applications/
# It also refreshes the Dock. Quit the app(s) first.
#
# Why a copy: macOS App Management (TCC) refuses writes inside the installed, signed app
# ("operation not permitted"). Copying the bundle with ditto and clearing the quarantine /
# macl xattrs makes the copy writable. The bundle identifier is kept (com.deepseek.dsh), so
# the copy shares the same ~/.dsh home: sessions, database and portfolio.
#
# Why the re-sign: Info.plist is part of the code signature (CodeDirectory special slot).
# Under the hardened runtime, macOS (amfid) SIGKILLs any process whose main binary was exec'd
# with a modified Info.plist — even the app itself would no longer launch. Re-signing ad-hoc
# (entitlements and runtime flags preserved) makes the modified bundle executable again.
# Side effect: the auto-updater can no longer replace it (Team ID gone).
#
# Why the helpers: at startup Electron resolves the child process path as
#   Contents/Frameworks/<CFBundleName> Helper*.app/Contents/MacOS/<CFBundleName> Helper*
# (shell/app/electron_main_delegate_mac.mm, with the name coming from GetApplicationName()
# in shell/common/application_info_mac.mm which reads CFBundleName). With CFBundleName
# switched to "Monos" the "DeepSeek Harness Helper" bundles are invisible to it and the app
# dies with: FATAL electron_main_delegate_mac.mm "Unable to find helper app". So the four
# helper bundles are renamed to "Monos Helper*.app" (folder, executable and Info.plist)
# and re-signed.
#
# Why the executable rename: the main binary is still named "DeepSeek Harness", and macOS
# surfaces that file name in Activity Monitor, Force Quit and launch feedback — the last
# DeepSeek identity on the machine. The script renames Contents/MacOS/DeepSeek Harness to
# Monos, updates CFBundleExecutable and the CLI shim (Resources/runtime/cli/bin/dsh), and
# clears the DeepSeek strings from Info.plist — including NSMicrophoneUsageDescription,
# which is shown verbatim in the microphone permission prompt. The re-sign below covers all
# of it.
#
# Why the asar: the desktop UI inside Contents/Resources/app.asar (sidebar wordmark,
# boot screen, welcome window, menus, About panel, account copy) still says DeepSeek
# Harness; scripts/asar-brand.py patches those strings, the welcome lockup, the About
# icon and the ElectronAsarIntegrity hash. See that script for the full edit list.
#
# Why the profile layer: the DeepSeek account UI, the DeepSeek LLM providers, the
# DeepSeek web-search provider and the DeepSeek analytics/telemetry sinks are plugins
# composed from ~/.dsh/profiles/desktop (bundles -> cordis.patch.yml). They are
# disabled in that patch layer, not in the app bundle, so a DeepSeek update cannot
# bring them back — this script re-asserts the layer on every rebrand. What the layer
# does, and why the account platform + controller stay enabled, is documented in
# scripts/strip-deepseek-profile.py.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICNS="$ROOT/bundle/assets/monos/Monos.icns"
TARGET="/Applications/Monos.app"
SOURCE="/Applications/DeepSeek Harness.app"

[ -f "$ICNS" ] || { echo "Icon not found: $ICNS" >&2; exit 1; }
if pgrep -f "Monos.app/Contents/MacOS" >/dev/null || pgrep -f "DeepSeek Harness.app/Contents/MacOS" >/dev/null; then
  echo "Quit the DeepSeek/Monos app first." >&2; exit 1
fi

if [ ! -d "$TARGET" ]; then
  if [ -d "$SOURCE" ]; then
    echo "→ Creating $TARGET from the original app in /Applications"
    ditto "$SOURCE" "$TARGET"
  else
    SOURCE_ZIP="$(ls -1t "$HOME/.dsh/backups/"DeepSeek-Harness.app*.zip 2>/dev/null | head -1 || true)"
    [ -n "$SOURCE_ZIP" ] || {
      echo "No $TARGET, no $SOURCE and no archived zip in ~/.dsh/backups/." >&2
      echo "Restore the original first: ditto -x -k ~/.dsh/backups/DeepSeek-Harness.app.*.zip /Applications/" >&2
      exit 1
    }
    echo "→ Creating $TARGET from the archived original: $SOURCE_ZIP"
    SRC_TMP="$(mktemp -d)"
    trap 'rm -rf "$SRC_TMP"' EXIT
    ditto -x -k "$SOURCE_ZIP" "$SRC_TMP"
    ditto "$SRC_TMP/DeepSeek Harness.app" "$TARGET"
  fi
fi

echo "→ Clearing xattrs that block writes and setting the icon + name"
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true
xattr -dr com.apple.macl "$TARGET" 2>/dev/null || true
xattr -dr com.apple.provenance "$TARGET" 2>/dev/null || true
cp "$ICNS" "$TARGET/Contents/Resources/icon.icns"
/usr/libexec/PlistBuddy -c "Set :CFBundleName Monos" -c "Set :CFBundleDisplayName Monos" "$TARGET/Contents/Info.plist"

echo "→ In-app branding: patching Resources/app.asar (sidebar wordmark, boot screen, welcome, menus…)"
python3 "$ROOT/scripts/asar-brand.py" "$TARGET"

echo "→ Helper apps: rename to match the new name and re-sign"
for suffix in "" " (GPU)" " (Plugin)" " (Renderer)"; do
  old="$TARGET/Contents/Frameworks/DeepSeek Harness Helper${suffix}.app"
  new="$TARGET/Contents/Frameworks/Monos Helper${suffix}.app"

  if [ -d "$old" ] && [ ! -d "$new" ]; then
    mv "$old" "$new"
  fi
  [ -d "$new" ] || { echo "   ERROR: helper missing ($old or $new)" >&2; exit 1; }
  if [ -f "$new/Contents/MacOS/DeepSeek Harness Helper${suffix}" ]; then
    mv "$new/Contents/MacOS/DeepSeek Harness Helper${suffix}" "$new/Contents/MacOS/Monos Helper${suffix}"
  fi

  python3 - "$new/Contents/Info.plist" "Monos Helper${suffix}" <<'PY'
import plistlib, sys
path, name = sys.argv[1], sys.argv[2]
raw = open(path, 'rb').read()
d = plistlib.loads(raw)
d['CFBundleExecutable'] = name
d['CFBundleDisplayName'] = name
d['CFBundleName'] = name
open(path, 'wb').write(plistlib.dumps(
    d, fmt=plistlib.FMT_BINARY if raw.startswith(b'bplist') else plistlib.FMT_XML))
PY
  codesign --force --sign - --preserve-metadata=entitlements,flags "$new" 2>&1 | tail -1
done

echo "→ Main executable + Info.plist: switch to the Monos name"
if [ -f "$TARGET/Contents/MacOS/DeepSeek Harness" ]; then
  mv "$TARGET/Contents/MacOS/DeepSeek Harness" "$TARGET/Contents/MacOS/Monos"
fi
[ -f "$TARGET/Contents/MacOS/Monos" ] || { echo "   ERROR: $TARGET/Contents/MacOS/Monos is missing" >&2; exit 1; }
python3 - "$TARGET/Contents/Info.plist" <<'PY'
import plistlib, sys
path = sys.argv[1]
raw = open(path, 'rb').read()
d = plistlib.loads(raw)
d['CFBundleExecutable'] = 'Monos'
for entry in d.get('CFBundleURLTypes', []) or []:
    if entry.get('CFBundleURLName') == 'DeepSeek Harness':
        entry['CFBundleURLName'] = 'Monos'
if 'DeepSeek' in str(d.get('NSHumanReadableCopyright', '')):
    d['NSHumanReadableCopyright'] = 'Copyright © 2026 Monos'
mic = str(d.get('NSMicrophoneUsageDescription', ''))
if 'DeepSeek' in mic:
    d['NSMicrophoneUsageDescription'] = mic.replace('DeepSeek Harness', 'Monos')
open(path, 'wb').write(plistlib.dumps(
    d, fmt=plistlib.FMT_BINARY if raw.startswith(b'bplist') else plistlib.FMT_XML))
PY

SHIM="$TARGET/Contents/Resources/runtime/cli/bin/dsh"
if [ -f "$SHIM" ] && grep -q 'MacOS/DeepSeek Harness' "$SHIM"; then
  echo "→ CLI shim: runtime/cli/bin/dsh now execs Contents/MacOS/Monos"
  python3 - "$SHIM" <<'PY'
import sys
p = sys.argv[1]
open(p, 'w', encoding='utf-8').write(
    open(p, encoding='utf-8').read().replace('MacOS/DeepSeek Harness', 'MacOS/Monos'))
PY
fi

echo "→ Re-signing the main bundle ad-hoc (entitlements + runtime kept)"
codesign --force --sign - --preserve-metadata=entitlements,flags "$TARGET" 2>&1 | tail -1

touch "$TARGET"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$TARGET" || true
killall Dock 2>/dev/null || true

echo "→ Profile layer: re-asserting the DeepSeek-free patch (account UI, DeepSeek models…)"
if [ -f "$HOME/.dsh/profiles/desktop/cordis.patch.yml" ]; then
  python3 "$ROOT/scripts/strip-deepseek-profile.py" --apply --quiet \
    || echo "   WARN: could not re-assert the DeepSeek-strip profile patch — run scripts/strip-deepseek-profile.py --check" >&2
else
  echo "   (no ~/.dsh/profiles/desktop found — skipped)"
fi
echo "Done. Open $TARGET"
