#!/usr/bin/env bash
# Read-only check: is this instance worth driving? Changes nothing.
#
#   doctor.sh tui <run>    a terminal run of tui.sh (run OUTSIDE the sandbox: tmux socket)
#   doctor.sh desktop      the desktop app's loading setup (settings + app process)
#
# Prints one line per check, "ok" or "FAIL", and exits 1 when any check failed.
set -uo pipefail

REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
SETTINGS=$HOME/.claude/settings.json
BAR_RE='[0-9.]+[kM]?/[0-9.]+[kM] +<?[0-9]+%'
fail=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; fail=1; }

case ${1:-} in
tui)
  run=${2:?usage: doctor.sh tui <run>}
  meta=$REPO/.verify/$run/meta.txt
  sock=vctx-$(printf %s "$REPO" | shasum | cut -c1-6)-$run   # as in tui.sh
  t() { tmux -L "$sock" -f /dev/null "$@"; }
  [ -f "$meta" ] && ok "meta: $(sed -n 's/^build: //p' "$meta"), mod $(sed -n 's/^mod version: //p' "$meta")" || bad "no $meta: start the run with tui.sh start"
  root=$(sed -n 's/^root: //p' "$meta" 2>/dev/null)
  if t has-session 2>/dev/null; then ok "tmux server $sock is up"; else bad "tmux server $sock is not up"; fi
  # claude sets its process title to its version, so ask whether the pane's process ended.
  [ "$(t display -p '#{pane_dead}' 2>/dev/null)" = 0 ] && ok "claude is still running in the pane" || bad "claude exited, or the pane is gone"
  # The engine writes the API declarations into each mod folder it loads, so a
  # fresh file in the frozen build proves the session loaded THIS build.
  dts=$root/build/.claude-plugin/types/claude-code/index.d.ts
  if [ -f "$dts" ] && [ "$dts" -nt "$root/started" ]; then
    ok "session loaded the run's build ($(head -1 "$dts" | sed 's#^// ##'))"
  else
    bad "the run's build was not loaded (no fresh $dts)"
  fi
  n=$(t capture-pane -p 2>/dev/null | grep -Ec "$BAR_RE")
  [ "$n" = 1 ] && ok "exactly one bar on screen" || bad "$n bar lines on screen (0: not drawn yet or failed; 2: another copy of the mod also runs)"
  ;;
desktop)
  py() { python3 -c "import json,sys;d=json.load(open('$SETTINGS'));$1"; }
  dirs=$(py "print(d.get('env',{}).get('CLAUDE_CODE_PLUGIN_DIRS',''))")
  watch=$(py "print(d.get('env',{}).get('CLAUDE_CODE_PLUGIN_DIR_WATCH',''))")
  inst=$(py "print(d.get('enabledPlugins',{}).get('context-breakdown@claude-context-breakdown','unset'))")
  if [ -n "$dirs" ] && [ -f "$dirs/.claude-plugin/plugin.json" ]; then
    ok "CLAUDE_CODE_PLUGIN_DIRS=$dirs (mod $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$dirs/.claude-plugin/plugin.json"))"
  else
    bad "CLAUDE_CODE_PLUGIN_DIRS is '${dirs}', not a mod folder: the desktop app runs the installed copy. Use desktop-load.sh on"
  fi
  [ "$watch" = 1 ] && ok "CLAUDE_CODE_PLUGIN_DIR_WATCH=1" || echo "note  CLAUDE_CODE_PLUGIN_DIR_WATCH is not 1: a file change needs a new session"
  [ "$inst" = False ] && ok "installed copy disabled" || bad "installed copy is enabled ($inst): two bars, or the wrong one"
  if pgrep -x Claude >/dev/null 2>&1; then ok "Claude.app is running"; else echo "note  Claude.app is not running (or the sandbox hides it)"; fi
  [ -f "$dirs/.claude-plugin/types/claude-code/index.d.ts" ] &&
    echo "note  a session loaded that folder at $(stat -f '%Sm' "$dirs/.claude-plugin/types/claude-code/index.d.ts")"
  ;;
*) echo "usage: doctor.sh tui <run> | doctor.sh desktop" >&2; exit 2 ;;
esac
exit $fail
