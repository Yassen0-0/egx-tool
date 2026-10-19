#!/usr/bin/env python3
"""Patch the DeepSeek Harness desktop app so its IN-APP UI shows the Monos brand.

The desktop shell (dsh-desktop-host) ships its whole UI inside
Contents/Resources/app.asar: the sidebar wordmark ("deepseek HARNESS"), the boot
screen, the welcome window, the menus, the About panel and the settings copy. The
bundled EGX plugin (our repo bundle) cannot reach any of that, so this script
patches the archive itself:

  1. extracts app.asar (own reader — the format is header-pickle + concatenated
     file data),
  2. applies the Monos replacements (idempotent — safe to re-run),
  3. repacks it (writer validated: an unmodified extract+repack is byte-identical
     to the original archive),
  4. updates ElectronAsarIntegrity.Resources/app.asar in Info.plist — Electron
     verifies this sha256 at launch and would refuse a stale hash,
  5. swaps Resources/icon.png (About panel / welcome window icon) for the Monos one,
  6. rebrands the web entry document: <title> (window title / Mission Control), both
     favicons (the DeepSeek whale) and manifest.webmanifest ("DeepSeek Harness" / "DSH").

Run it AFTER quitting the app and BEFORE re-signing the bundle (the asar, the
plist and icon.png are all sealed by the code signature). rebrand-desktop.sh
calls this script automatically; standalone use:

    python3 scripts/asar-brand.py --check /Applications/Monos.app   # dry run
    python3 scripts/asar-brand.py         /Applications/Monos.app   # apply
"""
from __future__ import annotations

import hashlib
import json
import os
import plistlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'plugins/monos-identity/assets/monos'

PRODUCT = 'DeepSeek Harness'   # the brand token as baked into the app UI
BRAND = 'Monos'                # our replacement

# ---------------------------------------------------------------------------
# asar read / write (format: UInt32 4 | UInt32 H | header[H] | file data...;
# header = UInt32 P | UInt32 S | utf-8 json (S bytes) | padding to 4;
# H = 4 + P and P = 4 + S + padding).  File "offset" values are relative to the
# start of the data section (8 + H) and files are stored in ascending offset
# order — this script preserves that order so unmodified files do not shuffle.
# ---------------------------------------------------------------------------


def read_archive(archive: Path):
    with archive.open('rb') as f:
        first, hlen = struct.unpack('<II', f.read(8))
        if first != 4:
            raise SystemExit(f'{archive}: unexpected asar prefix {first}')
        hb = f.read(hlen)
    psize, slen = struct.unpack('<II', hb[:8])
    tree = json.loads(hb[8:8 + slen].decode('utf-8'))
    return tree, 8 + hlen


def walk_files(tree):
    def rec(node, rel):
        for name, ent in node.get('files', {}).items():
            path = f'{rel}/{name}' if rel else name
            if 'files' in ent:
                yield from rec(ent, path)
            else:
                yield path, ent
    yield from rec(tree, '')


def extract(archive: Path, dest: Path):
    tree, data_off = read_archive(archive)
    entries = sorted(
        ((int(e['offset']), p, e) for p, e in walk_files(tree) if not e.get('unpacked')),
        key=lambda x: x[0])
    with archive.open('rb') as f:
        for off, path, ent in entries:
            f.seek(data_off + off)
            buf = f.read(ent.get('size', 0))
            out = dest / path
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(buf)
            if ent.get('executable'):
                os.chmod(out, 0o755)
    return tree, len(entries)


def file_integrity(buf: bytes, block_size: int) -> dict:
    """Per-file integrity entry as @electron/asar writes it: sha256 of the whole file plus one
    sha256 per block. Electron checks these when it reads a file, once asar integrity is on."""
    blocks = [hashlib.sha256(buf[i:i + block_size]).hexdigest() for i in range(0, len(buf), block_size)] \
        or [hashlib.sha256(b'').hexdigest()]
    return {'algorithm': 'SHA256', 'hash': hashlib.sha256(buf).hexdigest(),
            'blockSize': block_size, 'blocks': blocks}


def header_hash(archive_bytes: bytes) -> str:
    """ElectronAsarIntegrity hashes the header JSON string only, not the whole archive (the
    original app's Info.plist records exactly this value)."""
    _, hlen = struct.unpack('<II', archive_bytes[:8])
    _, slen = struct.unpack('<II', archive_bytes[8:16])
    return hashlib.sha256(archive_bytes[16:16 + slen]).hexdigest()


def pack(tree, srcdir: Path, out: Path):
    entries = sorted(
        ((int(e['offset']), p, e) for p, e in walk_files(tree) if not e.get('unpacked')),
        key=lambda x: x[0])
    datas = []
    off = 0
    for _, path, ent in entries:
        buf = (srcdir / path).read_bytes()
        ent['size'] = len(buf)
        ent['offset'] = str(off)
        if 'integrity' in ent:
            ent['integrity'] = file_integrity(buf, ent['integrity'].get('blockSize', 4 * 1024 * 1024))
        datas.append(buf)
        off += len(buf)
    jstr = json.dumps(tree, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    pad = (4 - ((len(jstr) + 4) % 4)) % 4
    rest = struct.pack('<I', len(jstr)) + jstr + b'\x00' * pad
    with out.open('wb') as f:
        f.write(struct.pack('<I', 4))
        f.write(struct.pack('<I', 4 + len(rest)))
        f.write(struct.pack('<I', len(rest)))
        f.write(rest)
        for buf in datas:
            f.write(buf)
    return len(entries)


# ---------------------------------------------------------------------------
# the brand edits
# ---------------------------------------------------------------------------

# 1) files where every "DeepSeek Harness" occurrence is the user-visible product
#    name (menus, welcome window, sidebar/account copy, notices, agent identity).
TOKEN_FILES = [
    'lib/main.js',                                                              # menus, welcome window, About panel, update labels
    'lib/preload-app.cjs',                                                      # in-window menu bar, startup-failure and update copy
    'lib/preload-welcome.cjs',                                                  # the same locale table, for the welcome window
    'dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js',         # window title
    'dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-account/lib/client.js',   # account area + onboarding
    'dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js',    # models welcome copy
    'dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js',     # plugin-install safety notice
    'dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js',  # office-preview notice
    'dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js',             # agent identity line
    'dsh/node_modules/@deepseek-ai/dsh-web-app/lib/index.js',                   # web-GUI prompt section
    'dsh/node_modules/@deepseek-ai/dsh-web-app/lib/startup.js',                 # CLI description
    'dsh/node_modules/@deepseek-ai/dsh-sdk-app/lib/index.js',                   # CLI description
    'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js',                             # CLI description
]

# 2) exact one-off strings.
EXACT = [
    # desktop sidebar brand: the whale + "deepseek" + "HARNESS" badge live in two
    # small components; swap them for the Monos trend mark and the Monos wordmark.
    ('dsh/node_modules/@deepseek-ai/dsh-client-ui-brand-official/lib/client.js',
     '\t\t\treturn (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.FishLogo, { size });',
     '\t\t\treturn (0, react_jsx_runtime.jsxs)("svg", {\n'
     '\t\t\t\twidth: size,\n'
     '\t\t\t\theight: size,\n'
     '\t\t\t\tviewBox: "0 0 48 48",\n'
     '\t\t\t\tfill: "none",\n'
     '\t\t\t\t"aria-hidden": "true",\n'
     '\t\t\t\tchildren: [\n'
     '\t\t\t\t\t(0, react_jsx_runtime.jsx)("path", { d: "M6 34L16 22L24 29L38 10", stroke: "currentColor", strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round" }),\n'
     '\t\t\t\t\t(0, react_jsx_runtime.jsx)("circle", { cx: 6, cy: 34, r: 3, fill: "currentColor" }),\n'
     '\t\t\t\t\t(0, react_jsx_runtime.jsx)("circle", { cx: 16, cy: 22, r: 3, fill: "currentColor" }),\n'
     '\t\t\t\t\t(0, react_jsx_runtime.jsx)("circle", { cx: 24, cy: 29, r: 3, fill: "currentColor" }),\n'
     '\t\t\t\t\t(0, react_jsx_runtime.jsx)("circle", { cx: 38, cy: 10, r: 3, fill: "#37B77A" })\n'
     '\t\t\t\t]\n'
     '\t\t\t});'),
    ('dsh/node_modules/@deepseek-ai/dsh-client-ui-brand-official/lib/client.js',
     '\t\t\treturn (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.BrandWordmark, { includeMark: false });',
     '\t\t\treturn (0, react_jsx_runtime.jsx)("span", {\n'
     '\t\t\t\tstyle: { fontSize: "18px", fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.1, whiteSpace: "nowrap" },\n'
     '\t\t\t\tchildren: "Monos"\n'
     '\t\t\t});'),
    # boot-screen wordmark ("HARNESS" under the loading screen).  The bundle file
    # name is content-hashed, so this is matched across the assets folder below.
    ('@boot-wordmark',
     'yn(xn.wordmark,"HARNESS")',
     'yn(xn.wordmark,"Monos")'),
    # welcome window key hint: point at Settings instead of the DeepSeek service.  `old` may be a
    # tuple of alternatives: main.js also accepts the wording an earlier version of this
    # script wrote, so an already-patched app upgrades in place.
    ('lib/main.js',
     ('"Configure official DeepSeek models to start using Harness"',
      '"Configure official DeepSeek models to start using Monos"'),
     '"Configure a model provider in Settings to start using Monos"'),
    ('lib/preload-app.cjs',
     '"Configure official DeepSeek models to start using Harness"',
     '"Configure a model provider in Settings to start using Monos"'),
    ('lib/preload-welcome.cjs',
     '"Configure official DeepSeek models to start using Harness"',
     '"Configure a model provider in Settings to start using Monos"'),
    ('lib/main.js', '"配置 DeepSeek 官方模型，即可开始使用"', '"在设置中配置模型提供方，即可开始使用"'),
    ('lib/preload-app.cjs', '"配置 DeepSeek 官方模型，即可开始使用"', '"在设置中配置模型提供方，即可开始使用"'),
    ('lib/preload-welcome.cjs', '"配置 DeepSeek 官方模型，即可开始使用"', '"在设置中配置模型提供方，即可开始使用"'),
    # the welcome window only offers a DeepSeek sign-in (platform.deepseek.com) or a DeepSeek
    # API key, and it opens on every launch once those are gone.  Monos uses the providers set
    # in Settings, so the gate is switched off and the app always opens the workspace.
    ('lib/main.js',
     'function needsWelcome(authentication) {\n\treturn !authentication.loggedIn && !authentication.hasApiKey;\n}',
     'function needsWelcome(authentication) {\n\treturn false; // Monos: no DeepSeek sign-in gate\n}'),
    # empty conversation: the headline under the hero mark (the mark itself is filled by the
    # bundle through the conversation.hero.brand.mark slot, the monos-identity plugin, plugins/monos-identity).
    ('dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js',
     '"hero.headline": "Into the Unknown"', '"hero.headline": "Monos"'),
    ('dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js',
     '"hero.headline": "探索未至之境"', '"hero.headline": "Monos"'),
    ('dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js',
     '"hero.preview": "Preview"', '"hero.preview": "EGX30"'),
    ('dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js',
     '"hero.preview": "预览版"', '"hero.preview": "EGX30"'),
    # copy that only reads well rewritten as a whole, applied before the STRING_RULES below.
    ('dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js',
     '"Configure the official DeepSeek provider to start building."',
     '"Configure a model provider to start building."'),
    ('dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js',
     '"配置 DeepSeek 官方模型，即可开始使用。"', '"配置模型提供方，即可开始使用。"'),
    ('dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-session-log/lib/client.js',
     '"Help improve DeepSeek models and products."', '"Help improve Monos."'),
    ('dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-session-log/lib/client.js',
     '"帮助改进 DeepSeek 模型与产品"', '"帮助改进 Monos"'),
    # account area: the signed-in line names the app account.
    ('dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-account/lib/client.js',
     '"Signed in to DeepSeek"', '"Signed in to Monos"'),
    ('dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-account/lib/client.js',
     '已登录 DeepSeek', '已登录 Monos'),
    # web entry document: the window title (Mission Control / window menu) + PWA metadata.
    ('dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
     '<title>DeepSeek Harness</title>', '<title>Monos</title>'),
    ('dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/manifest.webmanifest',
     '"name": "DeepSeek Harness"', '"name": "Monos"'),
    ('dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/manifest.webmanifest',
     '"short_name": "DSH"', '"short_name": "Monos"'),
]

# 3) a brand word inside the user-visible copy of a host package.  Applied only inside
#    double-quoted string literals and only as a whole word, so identifiers such as
#    DSH_HOME, __DSH_LOCALE__, isDSHRemoteError or validateDeepSeekModels are never touched.
#    Already-branded files simply have nothing left to replace.
STRING_LITERAL = re.compile(r'"(?:[^"\\\n]|\\.)*"')
_UI = 'dsh/node_modules/@deepseek-ai/dsh-client-ui-{}/lib/client.js'.format
_WORD = lambda w: re.compile(r'(?<![A-Za-z0-9_$])' + w + r'(?![A-Za-z0-9_$])')
STRING_RULES = [
    ('lib/main.js', _WORD('DSH'), BRAND),               # "Another DSH instance …" startup error
    ('lib/preload-app.cjs', _WORD('DSH'), BRAND),
    ('lib/preload-welcome.cjs', _WORD('DSH'), BRAND),
    (_UI('agent-preset'), _WORD('DSH'), BRAND),         # "extend DSH with Create mode"
    (_UI('plugin-manager'), _WORD('DSH'), BRAND),       # plugin compatibility notices
    (_UI('sidebar-browser'), _WORD('DSH'), BRAND),      # "cannot open the DSH application itself"
    (_UI('conversation'), _WORD('DSH'), BRAND),         # "session already in use by another DSH instance"
    (_UI('model-selection'), _WORD('DSH'), BRAND),
    (_UI('shortcuts'), _WORD('Harness'), BRAND),        # "Upgrade Harness", "restart Harness"
    (_UI('chat'), _WORD('DeepSeek'), BRAND),            # "signed out of DeepSeek"
    (_UI('model-selection'), _WORD('DeepSeek'), BRAND),  # "DeepSeek Account"
    (_UI('settings-account'), _WORD('DeepSeek'), BRAND),
    (_UI('settings-models'), _WORD('DeepSeek'), BRAND),
    (_UI('settings-session-log'), _WORD('DeepSeek'), BRAND),
    (_UI('settings-web-search'), _WORD('DeepSeek'), BRAND),
]

BOOT_GLOB = 'dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js'

WELCOME_SVG_PATH = 'renderer/assets/welcome-brand.svg'
WELCOME_SVG = '''<svg width="472" height="40" viewBox="0 0 472 40" fill="none" xmlns="http://www.w3.org/2000/svg">
<style>
  :root {
    --dsw-alias-label-primary: #0f1115;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --dsw-alias-label-primary: #f9fafb;
    }
  }
</style>
<path d="M7 29.5L16.5 18.5L24 25.5L38 8" stroke="var(--dsw-alias-label-primary)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="7" cy="29.5" r="2.75" fill="var(--dsw-alias-label-primary)"/>
<circle cx="16.5" cy="18.5" r="2.75" fill="var(--dsw-alias-label-primary)"/>
<circle cx="24" cy="25.5" r="2.75" fill="var(--dsw-alias-label-primary)"/>
<circle cx="38" cy="8" r="2.75" fill="#37B77A"/>
<text x="53" y="30.5" fill="var(--dsw-alias-label-primary)" font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif" font-size="29" font-weight="600" letter-spacing="-1.2">Monos</text>
</svg>
'''

# both favicons carry the DeepSeek whale; replace them with the Monos app-icon mark (the same
# drawing as plugins/monos-identity/assets/monos/monos-app-icon.svg).  The XML comment doubles as the
# idempotence marker.
FAVICON_FILES = [
    'dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon.svg',
    'dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon-dark.svg',
]
FAVICON_SVG = (
    '<!-- Monos favicon: what used to be the DeepSeek whale -->\n'
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 1024 1024">'
    '<rect width="1024" height="1024" rx="230" fill="#37B77A"/>'
    '<path d="M301 672L442 506L550 595L730 352" stroke="#fff" stroke-width="96"'
    ' stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
    '<circle cx="301" cy="672" r="48" fill="#fff"/><circle cx="442" cy="506" r="48" fill="#fff"/>'
    '<circle cx="550" cy="595" r="48" fill="#fff"/><circle cx="730" cy="352" r="48" fill="#fff"/>'
    '</svg>\n')

ICON_OLD = 'Contents/Resources/icon.png'
ICON_NEW = ASSETS / 'monos-1024.png'


def apply_edits(src: Path, log):
    changed = []

    def replace_all(rel, old, new):
        p = src / rel
        if not p.is_file():
            raise SystemExit(f'brand patch: missing file in archive: {rel}')
        text = p.read_text(encoding='utf-8')
        n = 0
        for alt in (old if isinstance(old, tuple) else (old,)):
            n += text.count(alt)
            text = text.replace(alt, new)
        if n:
            p.write_text(text, encoding='utf-8')
            log.append(f'  {rel}: "{(old if isinstance(old, str) else old[0])[:40]}" x{n}')
            changed.append(rel)
        elif new in text:
            log.append(f'  {rel}: already branded')
        else:
            raise SystemExit(f'brand patch: no occurrence and no branded marker in {rel}')

    for rel in TOKEN_FILES:
        replace_all(rel, PRODUCT, BRAND)

    booted = False
    for p in sorted(src.glob(BOOT_GLOB)):
        text = p.read_text(encoding='utf-8')
        if 'yn(xn.wordmark,"HARNESS")' in text:
            replace_all(str(p.relative_to(src)), 'yn(xn.wordmark,"HARNESS")', 'yn(xn.wordmark,"Monos")')
            booted = True
        elif 'yn(xn.wordmark,"Monos")' in text:
            booted = True
    if not booted:
        raise SystemExit('brand patch: boot wordmark not found in dsh-web-frontend assets')

    for rel, old, new in EXACT:
        if rel == '@boot-wordmark':
            continue
        replace_all(rel, old, new)

    for rel, pattern, new in STRING_RULES:
        p = src / rel
        if not p.is_file():
            raise SystemExit(f'brand patch: missing file in archive: {rel}')
        text = p.read_text(encoding='utf-8')
        n = 0

        def in_literal(m):
            nonlocal n
            replaced, k = pattern.subn(new, m.group(0))
            n += k
            return replaced
        text = STRING_LITERAL.sub(in_literal, text)
        if n:
            p.write_text(text, encoding='utf-8')
            log.append(f'  {rel}: {pattern.pattern} -> {new} x{n} (in string literals)')
            changed.append(rel)
        else:
            log.append(f'  {rel}: {pattern.pattern}: already branded')

    svg = src / WELCOME_SVG_PATH
    if not svg.is_file():
        raise SystemExit(f'brand patch: missing file in archive: {WELCOME_SVG_PATH}')
    if 'Monos' not in svg.read_text(encoding='utf-8'):
        svg.write_text(WELCOME_SVG, encoding='utf-8')
        log.append(f'  {WELCOME_SVG_PATH}: replaced with Monos lockup')
        changed.append(WELCOME_SVG_PATH)
    else:
        log.append(f'  {WELCOME_SVG_PATH}: already branded')

    for rel in FAVICON_FILES:
        p = src / rel
        if not p.is_file():
            raise SystemExit(f'brand patch: missing file in archive: {rel}')
        text = p.read_text(encoding='utf-8')
        if 'Monos favicon' in text:
            log.append(f'  {rel}: already branded')
        else:
            p.write_text(FAVICON_SVG, encoding='utf-8')
            log.append(f'  {rel}: replaced the DeepSeek whale favicon')
            changed.append(rel)

    return changed


def syntax_check(src: Path, changed, log):
    node = shutil.which('node')
    if not node or not changed:
        return
    for rel in sorted(set(changed)):
        if not rel.endswith(('.js', '.cjs')):
            continue
        p = src / rel
        tmp = p.with_suffix('.check.cjs' if rel.endswith('.cjs') else '.check.mjs')
        tmp.write_bytes(p.read_bytes())
        r = subprocess.run([node, '--check', str(tmp)], capture_output=True, text=True)
        tmp.unlink()
        if r.returncode == 0:
            log.append(f'  syntax OK: {rel}')
        else:
            # a broken patch must never reach the app: stop before anything is written.
            print('\n'.join(log))
            raise SystemExit(f'brand patch: syntax check failed for {rel}: '
                             f'{r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "?"}')


# ---------------------------------------------------------------------------


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    check = '--check' in flags
    if not args:
        raise SystemExit(__doc__)
    app = Path(args[0]).resolve()
    asar = app / 'Contents/Resources/app.asar'
    plist = app / 'Contents/Info.plist'
    icon = app / ICON_OLD
    for p in (asar, plist, icon):
        if not p.is_file():
            raise SystemExit(f'not a DeepSeek Harness app bundle: missing {p}')

    if not check:
        probe = subprocess.run(['pgrep', '-f', f'{app.name}/Contents/MacOS'],
                               capture_output=True)
        if probe.returncode == 0 and '--force' not in flags:
            raise SystemExit('quit the app first (or pass --force)')

    log = []
    with tempfile.TemporaryDirectory(prefix='asar-brand-') as tmp:
        src = Path(tmp) / 'root'
        tree, count = extract(asar, src)
        log.append(f'extracted {count} files from {asar}')
        changed = apply_edits(src, log)
        new_archive = Path(tmp) / 'app.asar.new'
        pack(tree, src, new_archive)
        syntax_check(src, changed, log)
        new_bytes = new_archive.read_bytes()

    old_bytes = asar.read_bytes()
    asar_changed = new_bytes != old_bytes
    new_hash = header_hash(new_bytes)

    pdata = plistlib.loads(plist.read_bytes())
    try:
        old_hash = pdata['ElectronAsarIntegrity']['Resources/app.asar']['hash']
    except KeyError:
        raise SystemExit('ElectronAsarIntegrity hash missing from Info.plist')
    plist_changed = old_hash != new_hash

    icon_changed = icon.read_bytes() != ICON_NEW.read_bytes()

    for line in log:
        print(line)
    print(f'asar: {"CHANGED" if asar_changed else "up to date"} '
          f'({len(old_bytes)} -> {len(new_bytes)} bytes)')
    print(f'Info.plist hash: {"UPDATE" if plist_changed else "up to date"} ({new_hash[:16]}…)')
    print(f'icon.png: {"UPDATE" if icon_changed else "up to date"}')

    if check:
        print('(--check: nothing written)')
        return
    if not (asar_changed or plist_changed or icon_changed):
        print('nothing to do — already branded.')
        return

    if asar_changed:
        tmp_asar = asar.with_suffix('.asar.tmp')
        tmp_asar.write_bytes(new_bytes)
        os.chmod(tmp_asar, asar.stat().st_mode & 0o777)
        os.replace(tmp_asar, asar)
    if plist_changed:
        pdata['ElectronAsarIntegrity']['Resources/app.asar']['hash'] = new_hash
        plist.write_bytes(plistlib.dumps(
            pdata, fmt=plistlib.FMT_BINARY if plist.read_bytes().startswith(b'bplist') else plistlib.FMT_XML))
    if icon_changed:
        shutil.copy2(ICON_NEW, icon)
    print('patched. Re-sign the bundle now (rebrand-desktop.sh does this automatically).')


if __name__ == '__main__':
    main()
