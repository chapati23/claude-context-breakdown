#!/usr/bin/env bash
# Drive the context-breakdown mod in a real Claude Code terminal session, in a
# private tmux server. Run every subcommand OUTSIDE the agent sandbox: the
# sandbox blocks the tmux socket.
#
#   tui.sh start   <run> [--ref <git-ref> | --worktree] [--other] [--size 110x24] [--model haiku]
#   tui.sh send    <run> "<text>"          type literal text, then Enter
#   tui.sh keys    <run> <tmux key>...     e.g. Tab Escape Enter Down j 2 b
#   tui.sh wait    <run> "<ERE>" [secs]    wait until the screen matches (default 60 s)
#   tui.sh capture <run> <label> [--html]  save the screen as evidence
#   tui.sh screen  <run>                   print the screen as plain text
#   tui.sh stop    <run>                   end the session, delete the build; keep evidence
#
# <run> is a short name of your choice ([a-z0-9-]). Each run has its own tmux
# server (-L vctx-<run>), its own frozen build of the mod and its own empty
# working folder, so several runs can go side by side. Evidence goes to
# <repo>/.verify/<run>/ (git ignores .verify/) and survives `stop`.
set -euo pipefail

REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
HERE=$(cd "$(dirname "$0")" && pwd)
BAR_RE='[0-9.]+[kM]?/[0-9.]+[kM] +[0-9]+%'

die() { echo "tui.sh: $*" >&2; exit 1; }
[ $# -ge 2 ] || die "usage: tui.sh <start|send|keys|wait|capture|screen|stop> <run> ..."
cmd=$1 run=$2; shift 2
[[ $run =~ ^[a-z0-9-]+$ ]] || die "run name must match [a-z0-9-]+"
EVID=$REPO/.verify/$run
SOCK=vctx-$run
t() { tmux -L "$SOCK" -f /dev/null "$@"; }
screen() { t capture-pane -p | sed 's/[[:space:]]*$//'; }

wait_for() { # <ERE> <secs>
  local re=$1 secs=$2 i=0
  while [ $i -lt $((secs * 2)) ]; do
    screen 2>/dev/null | grep -Eq -- "$re" && return 0
    sleep 0.5; i=$((i + 1))
  done
  echo "tui.sh: timed out after ${secs}s waiting for /$re/. Screen:" >&2
  screen >&2 || true
  return 1
}

case $cmd in
start)
  src=worktree other=0 size=110x24 model=haiku ref=""
  while [ $# -gt 0 ]; do
    case $1 in
      --ref) src=ref ref=$2; shift 2 ;;
      --worktree) src=worktree; shift ;;
      --other) other=1; shift ;;
      --size) size=$2; shift 2 ;;
      --model) model=$2; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  t has-session 2>/dev/null && die "run $run is already up; stop it first"
  root=$(mktemp -d "${TMPDIR:-/tmp}/vctx-$run.XXXXXX")
  build=$root/build work=$root/work
  mkdir -p "$build" "$work" "$EVID"
  if [ "$src" = ref ]; then
    git -C "$REPO" archive "$ref" | tar -x -C "$build"
    label="$ref ($(git -C "$REPO" rev-parse --short "$ref"))"
  else
    (cd "$REPO" && git ls-files -z --cached --others --exclude-standard -- . ':!:.agents' ':!:.claude' ':!:.verify' |
      xargs -0 tar -cf - 2>/dev/null) | tar -x -C "$build"
    label="worktree of $(git -C "$REPO" rev-parse --short HEAD)$(git -C "$REPO" diff --quiet HEAD || echo ' + uncommitted changes')"
  fi
  dirs="--plugin-dir $build"
  [ $other = 1 ] && dirs="$dirs --plugin-dir $HERE/../fixtures/othermod"
  touch "$root/started"
  cat > "$EVID/meta.txt" <<EOF
run: $run
build: $label
mod version: $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$build/.claude-plugin/plugin.json")
claude: $(claude --version)
size: $size
other mod: $([ $other = 1 ] && echo yes || echo no)
started: $(date '+%Y-%m-%d %H:%M:%S %z')
root: $root
EOF
  t new-session -d -x "${size%x*}" -y "${size#*x}" -c "$work" \
    "FORCE_COLOR=3 COLORTERM=truecolor claude $dirs --model $model"
  # A new folder can ask for trust first. The folder is our own empty scratch folder.
  for _ in $(seq 1 60); do
    s=$(screen 2>/dev/null || true)
    if grep -q 'trust' <<<"$s" && grep -q 'Yes' <<<"$s"; then t send-keys Enter; sleep 1; fi
    grep -Eq "$BAR_RE" <<<"$s" && grep -q '❯' <<<"$s" && break
    sleep 1
  done
  wait_for "$BAR_RE" 5 >/dev/null || die "the bar did not show within 60 s; see the screen above, then run: tui.sh stop $run"
  echo "ready: run $run, $label. Evidence: $EVID"
  ;;
send)
  [ $# -eq 1 ] || die "usage: tui.sh send <run> \"<text>\""
  t send-keys -l -- "$1"; sleep 0.3; t send-keys Enter ;;
keys)
  for k in "$@"; do t send-keys "$k"; sleep 0.3; done ;;
wait)
  wait_for "$1" "${2:-60}" ;;
screen)
  screen ;;
capture)
  [ $# -ge 1 ] || die "usage: tui.sh capture <run> <label> [--html]"
  lab=$1; mkdir -p "$EVID"
  t capture-pane -p -e > "$EVID/$lab.ansi"
  sed 's/\x1b\[[0-9;:]*m//g; s/[[:space:]]*$//' "$EVID/$lab.ansi" > "$EVID/$lab.txt"
  if [ "${2:-}" = --html ]; then
    python3 "$HERE/ansi2html.py" "$EVID/$lab.ansi" "$EVID/$lab.html" "$run · $lab"
  fi
  echo "$EVID/$lab.txt" ;;
stop)
  t kill-server 2>/dev/null || true
  root=$(sed -n 's/^root: //p' "$EVID/meta.txt" 2>/dev/null || true)
  # Delete only the folder this run made: named vctx-<run>.XXXXXX, holding our stamp.
  if [ -n "$root" ] && [[ $(basename "$root") == vctx-$run.* ]] && [ -f "$root/started" ]; then rm -rf "$root"; fi
  echo "stopped run $run. Evidence kept in $EVID" ;;
*) die "unknown subcommand $cmd" ;;
esac
