#!/usr/bin/env bash
# Point the Claude desktop app's local sessions at a build of this mod, and back.
# The desktop app has no --plugin-dir flag: it reads two env entries from
# ~/.claude/settings.json (see "Development" in README.md).
#
#   desktop-load.sh on <run> [--ref <git-ref>]   freeze a build, edit settings, keep a backup
#   desktop-load.sh off <run>                    undo exactly that edit, delete the build
#
# `on` writes a frozen copy of the mod (git archive of HEAD, or of --ref), so
# edits to the checkout during the run cannot change what the app loads. It
# sets CLAUDE_CODE_PLUGIN_DIRS to that copy, CLAUDE_CODE_PLUGIN_DIR_WATCH=1,
# and disables the installed copy. Only a NEW local session picks this up.
#
# The settings file is the user's own (here a link into a dotfiles repo).
# Ask the user before `on`. Run both commands OUTSIDE the agent sandbox: the
# sandbox denies writes to the link's target. Always run `off` when done.
set -euo pipefail

REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
SETTINGS=$(python3 -c "import os;print(os.path.realpath(os.path.expanduser('~/.claude/settings.json')))")
KEY=context-breakdown@claude-context-breakdown
die() { echo "desktop-load.sh: $*" >&2; exit 1; }
[ $# -ge 2 ] || die "usage: desktop-load.sh on|off <run> [--ref <git-ref>]"
cmd=$1 run=$2; shift 2
[[ $run =~ ^[a-z0-9-]+$ ]] || die "run name must match [a-z0-9-]+"
EVID=$REPO/.verify/$run
STATE=$EVID/desktop-state

case $cmd in
on)
  ref=HEAD
  [ "${1:-}" = --ref ] && ref=$2
  [ -d "$STATE" ] && die "run $run already holds a desktop load; run 'off' first"
  # One desktop load at a time, across all runs: a second load would record the
  # first one's entries as "previous" and restore a deleted build later.
  for other in "$REPO"/.verify/*/desktop-state; do
    [ -d "$other" ] && die "another run holds a desktop load ($other); run 'off' for it first"
  done
  current=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('env',{}).get('CLAUDE_CODE_PLUGIN_DIRS',''))" "$SETTINGS")
  [[ $(basename "${current:-none}") == vctx-desktop-* ]] && die "settings already load a verify build ($current); undo that load first"
  build=$(mktemp -d "${TMPDIR:-/tmp}/vctx-desktop-$run.XXXXXX")
  # Until the settings change, a failure leaves nothing behind, so `on` can be retried.
  trap 'rm -rf "$build" "$STATE"' ERR
  git -C "$REPO" archive "$ref" | tar -x -C "$build"
  mkdir -p "$STATE"
  echo "$build" > "$STATE/build"
  cp -p "$SETTINGS" "$STATE/settings.before.json"
  python3 - "$SETTINGS" "$build" "$KEY" "$STATE/prev.json" <<'EOF'
import json, sys
path, build, key, prev = sys.argv[1:]
d = json.load(open(path))
env = d.setdefault('env', {})
ep = d.setdefault('enabledPlugins', {})
json.dump({'dirs': env.get('CLAUDE_CODE_PLUGIN_DIRS'), 'watch': env.get('CLAUDE_CODE_PLUGIN_DIR_WATCH'),
           'enabled': ep.get(key, '__unset__')}, open(prev, 'w'))
env['CLAUDE_CODE_PLUGIN_DIRS'] = build
env['CLAUDE_CODE_PLUGIN_DIR_WATCH'] = '1'
ep[key] = False
open(path, 'w').write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
EOF
  trap - ERR
  cp -p "$SETTINGS" "$STATE/settings.ours.json"
  {
    echo "desktop build: $ref ($(git -C "$REPO" rev-parse --short "$ref"))"
    echo "mod version: $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$build/.claude-plugin/plugin.json")"
    echo "loaded: $(date '+%Y-%m-%d %H:%M:%S %z')"
  } >> "$EVID/meta.txt"
  echo "settings now load $build. Start a NEW local session in the desktop app."
  ;;
off)
  [ -d "$STATE" ] || die "run $run has no desktop load to undo"
  if cmp -s "$SETTINGS" "$STATE/settings.ours.json"; then
    # Nobody touched the file since `on`: restore its exact bytes.
    cat "$STATE/settings.before.json" > "$SETTINGS"
  else
    # The file changed meanwhile: undo only those of our three entries that
    # still hold the value this run wrote; a newer value is someone's edit.
    python3 - "$SETTINGS" "$KEY" "$STATE/prev.json" "$(cat "$STATE/build")" <<'EOF'
import json, sys
path, key, prev, build = sys.argv[1:]
d = json.load(open(path)); p = json.load(open(prev))
env = d.setdefault('env', {}); ep = d.setdefault('enabledPlugins', {})
for k, ours, v in (('CLAUDE_CODE_PLUGIN_DIRS', build, p['dirs']), ('CLAUDE_CODE_PLUGIN_DIR_WATCH', '1', p['watch'])):
    if env.get(k) != ours: continue
    if v is None: env.pop(k, None)
    else: env[k] = v
if ep.get(key) is False:
    if p['enabled'] == '__unset__': ep.pop(key, None)
    else: ep[key] = p['enabled']
open(path, 'w').write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
EOF
    echo "note: settings changed during the run; removed only this run's entries"
  fi
  build=$(cat "$STATE/build")
  if [[ $(basename "$build") == vctx-desktop-$run.* ]]; then rm -rf "$build"; fi
  rm -rf "$STATE"
  echo "settings restored; the installed copy runs again in NEW desktop sessions. Evidence kept in $EVID"
  ;;
*) die "unknown subcommand $cmd" ;;
esac
