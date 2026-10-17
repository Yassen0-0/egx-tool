#!/usr/bin/env python3
"""Keep the dsh desktop profile free of the DeepSeek account surface («Monos»).

The desktop app composes its plugin tree from profile layers:

    bundles (@deepseek-ai/dsh-base -> @deepseek-ai/dsh-web-app -> dsh-egx-bundle)
    -> <profile>/cordis.patch.yml     (the layer edited here)
    -> any --patch overlays

Every user-visible DeepSeek feature is a plugin row, so they are switched off here in
the patch layer instead of inside the app — idempotent, upgrade-safe, reversible one
row at a time:

  * `disabled: true` on the rows in DISABLED: the account settings page and the
    sidebar sign-in chip, the DeepSeek LLM providers (account + api-key) with their
    request extensions, DeepSeek-backed web search and its settings page, and the
    DeepSeek-bound product analytics / telemetry sinks.  (Web-search note: the
    DeepSeek provider was the only one installed, so the web_search tool has no
    provider while these rows stay off — that is the point.)
  * `deepseek-account` + `account-controller` are deliberately kept ENABLED: the
    Desktop Host probes `account/getState` over its local HTTP API while opening the
    first window and aborts into the recovery dialog when the endpoint is missing
    (observed: crash log "desktop welcome: Web request failed").  With
    `ui-settings-account` disabled they are invisible plumbing with no entry point.
  * `agent-default-model` -> provider google / model gemini-2.5-flash /
    reasoningEffort low, so new sessions do not start on a DeepSeek model.  Edit
    DEFAULT_MODEL below if this machine should default to something else.

Edits are surgical and idempotent: unrelated rows and comments are preserved byte for
byte and re-running on a compliant file changes nothing.  --apply writes a timestamped
backup next to the file before touching it.

    python3 scripts/strip-deepseek-profile.py --check    # dry run (default); exit 1 = pending
    python3 scripts/strip-deepseek-profile.py --apply    # write (backup first)
    python3 scripts/strip-deepseek-profile.py --check --profile-dir /path/to/profiles/desktop
"""
from __future__ import annotations

import argparse
import difflib
import os
import re
import shutil
import sys
import time
from pathlib import Path

# --- the desired state ------------------------------------------------------
DISABLED = [
    ('ui-settings-account', '@deepseek-ai/dsh-client-ui-settings-account'),
    ('llm-deepseek-account', '@deepseek-ai/dsh-llm-deepseek-account'),
    ('llm-deepseek', '@deepseek-ai/dsh-llm-deepseek-api-key'),
    ('deepseek-llm-api-extensions', '@deepseek-ai/dsh-deepseek-llm-api-extensions'),
    ('session-log-deepseek', '@deepseek-ai/dsh-session-log-deepseek'),
    ('plugin-package-inventory-deepseek', '@deepseek-ai/dsh-plugin-package-inventory-deepseek'),
    ('web-search-deepseek', '@deepseek-ai/dsh-web-search-deepseek'),
    ('ui-settings-web-search', '@deepseek-ai/dsh-client-ui-settings-web-search'),
    ('desktop-product-telemetry', '@deepseek-ai/dsh-host-product-telemetry-otel'),
    ('product-analytics', '@deepseek-ai/dsh-client-product-analytics'),
    ('session-telemetry-otel', '@deepseek-ai/dsh-session-telemetry-otel'),
]
KEEP_ENABLED = [
    ('deepseek-account', '@deepseek-ai/dsh-deepseek-account-platform'),
    ('account-controller', '@deepseek-ai/dsh-api-account-controller'),
]
MODEL_ROW = ('agent-default-model', '@deepseek-ai/dsh-agent-default-model')
DEFAULT_MODEL = [('provider', 'google'), ('model', 'gemini-2.5-flash'), ('reasoningEffort', 'low')]

ENTRY_RE = re.compile(r'^- id:[ \t]*["\']?([^"\'\s]+)["\']?[ \t]*$')
DISABLED_RE = re.compile(r'^([ \t]*)disabled:[ \t]*(\S.*?)[ \t]*$')
ADDED_COMMENT = '# --- added by strip-deepseek-profile.py (row was missing) ---'


def parse_entries(lines):
    """Map top-level `- id: <id>` blocks to (start, end) line indices (end exclusive)."""
    starts = []
    for i, raw in enumerate(lines):
        m = ENTRY_RE.match(raw.rstrip('\r\n'))
        if m:
            starts.append((m.group(1), i))
    entries = {}
    for n, (rid, i) in enumerate(starts):
        end = starts[n + 1][1] if n + 1 < len(starts) else len(lines)
        entries[rid] = (i, end)
    return entries


def _ensure_trailing_newline(lines, nl):
    if lines and not lines[-1].endswith(('\n', '\r')):
        lines[-1] += nl


def ensure_disabled(lines, rid, name, nl):
    """Return a change description, or None when the row is already disabled."""
    entries = parse_entries(lines)
    if rid not in entries:
        _ensure_trailing_newline(lines, nl)
        lines += [
            f'{ADDED_COMMENT}{nl}',
            f'- id: {rid}{nl}',
            f'  name: "{name}"{nl}',
            f'  disabled: true{nl}',
        ]
        return 'row was missing -> add it, disabled'
    start, end = entries[rid]
    for i in range(start + 1, end):
        m = DISABLED_RE.match(lines[i].rstrip('\r\n'))
        if m:
            if m.group(2) == 'true':
                return None
            lines[i] = f'{m.group(1)}disabled: true{nl}'
            return '"disabled: false" -> true'
    lines.insert(start + 1, f'  disabled: true{nl}')
    return 'add "disabled: true"'


def ensure_kept_enabled(lines, rid, nl):
    """Return a change description when the row is mis-disabled, else None."""
    entries = parse_entries(lines)
    if rid not in entries:
        return None  # not listed => base layers ship it enabled
    start, end = entries[rid]
    for i in range(start + 1, end):
        m = DISABLED_RE.match(lines[i].rstrip('\r\n'))
        if m and m.group(2) == 'true':
            del lines[i]
            return 'remove "disabled: true" (Desktop Host boot probe needs it)'
    return None


def ensure_model(lines, rid, name, pairs, nl):
    """Return a change description, or None when the default model is already set."""
    if rid not in parse_entries(lines):
        _ensure_trailing_newline(lines, nl)
        lines += [f'{ADDED_COMMENT}{nl}',
                  f'- id: {rid}{nl}', f'  name: "{name}"{nl}', f'  config:{nl}']
        for k, v in pairs:
            lines.append(f'    {k}: {v}{nl}')
        return 'row was missing -> add it with provider google / gemini-2.5-flash / low'
    msgs = []
    for k, v in pairs:
        entries = parse_entries(lines)
        if rid not in entries:
            break
        start, end = entries[rid]
        key_i, ind, cur = None, '    ', None
        for i in range(start + 1, end):
            m = re.match(r'^([ \t]*)' + re.escape(k) + r':[ \t]*(\S.*?)[ \t]*$',
                         lines[i].rstrip('\r\n'))
            if m:
                key_i, ind, cur = i, m.group(1), m.group(2)
        if key_i is not None:
            if cur.strip('\'"') != v:
                lines[key_i] = f'{ind}{k}: {v}{nl}'
                msgs.append(f'{k}: {cur} -> {v}')
            continue
        cfg_i = None
        for i in range(start + 1, end):
            if re.match(r'^[ \t]*config:[ \t]*$', lines[i].rstrip('\r\n')):
                cfg_i = i
                break
        if cfg_i is None:
            lines.insert(start + 1, f'  config:{nl}')
            lines.insert(start + 2, f'    {k}: {v}{nl}')
        else:
            lines.insert(cfg_i + 1, f'    {k}: {v}{nl}')
        msgs.append(f'add {k}: {v}')
    return '; '.join(msgs) if msgs else None


def apply_all(lines, nl):
    """Run every rule once over a copy of `lines`; return (new_lines, results)."""
    lines = list(lines)
    results = []
    for rid, name in DISABLED:
        results.append(('disabled', rid, ensure_disabled(lines, rid, name, nl)))
    for rid, name in KEEP_ENABLED:
        results.append(('kept', rid, ensure_kept_enabled(lines, rid, nl)))
    results.append(('model', MODEL_ROW[0],
                    ensure_model(lines, MODEL_ROW[0], MODEL_ROW[1], DEFAULT_MODEL, nl)))
    return lines, results


def describe(kind, rid, msg):
    if msg is not None:
        return f'  {rid:34s} -> {msg}'
    if kind == 'disabled':
        return f'  {rid:34s} OK (row disabled)'
    if kind == 'kept':
        return f'  {rid:34s} OK (left enabled — Desktop Host boot probe)'
    return f'  {rid:34s} OK ({" / ".join(v for _, v in DEFAULT_MODEL)})'


def main(argv=None):
    ap = argparse.ArgumentParser(
        description='Re-assert the DeepSeek-free dsh desktop profile layer '
                    '(see the module docstring for the full rationale).')
    ap.add_argument('--check', action='store_true',
                    help='dry run; exit 1 when changes are pending (this is the default)')
    ap.add_argument('--apply', action='store_true',
                    help='write the file (timestamped backup first); default is a dry run')
    ap.add_argument('--profile-dir', metavar='DIR',
                    help='profile folder holding cordis.patch.yml')
    ap.add_argument('--profile', default='desktop', metavar='NAME',
                    help='profile name under <DSH_HOME>/profiles (default: desktop)')
    ap.add_argument('--diff', action='store_true', help='show a unified diff of pending changes')
    ap.add_argument('--quiet', action='store_true', help='only print the summary line')
    args = ap.parse_args(argv)

    if args.profile_dir:
        profile_dir = Path(args.profile_dir).expanduser()
    else:
        dsh_home = Path(os.environ.get('DSH_HOME') or (Path.home() / '.dsh'))
        profile_dir = dsh_home / 'profiles' / args.profile
    patch = profile_dir / 'cordis.patch.yml'
    if not patch.is_file():
        print(f'error: {patch} not found (use --profile-dir to point at the profile folder)',
              file=sys.stderr)
        return 2

    text = patch.read_text(encoding='utf-8')
    nl = '\r\n' if '\r\n' in text else '\n'
    lines = text.splitlines(keepends=True)
    new_lines, results = apply_all(lines, nl)
    changes = [(kind, rid, msg) for kind, rid, msg in results if msg is not None]

    # safety: a second sweep over the result must find nothing left to do
    _, again = apply_all(list(new_lines), nl)
    leftover = [rid for _, rid, msg in again if msg is not None]
    if leftover:
        print(f'internal error: changes did not stabilize for {leftover}', file=sys.stderr)
        return 2

    if not args.quiet:
        print(f'profile: {patch}')
        for kind, rid, msg in results:
            print(describe(kind, rid, msg))

    if not changes:
        print('apply: nothing to change — up to date' if args.apply
              else 'check: profile already DeepSeek-free — up to date')
        return 0

    if args.diff:
        sys.stdout.writelines(difflib.unified_diff(
            lines, new_lines,
            fromfile=f'{patch} (current)', tofile=f'{patch} (desired)'))

    if not args.apply:
        print(f'check: {len(changes)} change(s) pending — rerun with --apply to write '
              '(a timestamped backup is taken first)')
        return 1

    stamp = time.strftime('%Y%m%d-%H%M%S')
    backup = patch.with_name(f'{patch.name}.bak-{stamp}-strip-deepseek')
    shutil.copy2(patch, backup)
    patch.write_text(''.join(new_lines), encoding='utf-8')
    print(f'apply: wrote {len(changes)} change(s)')
    print(f'backup: {backup}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
