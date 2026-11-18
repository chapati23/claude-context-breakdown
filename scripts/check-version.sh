#!/usr/bin/env bash
# Checks the release rule in AGENTS.md: a change to a shipped file must come
# with a version that is higher than the version on the base.
#
# Usage: scripts/check-version.sh <base>
#   <base>  a commit or a ref to compare HEAD with, for example origin/main
#
# The check reads commits, not the working tree: commit your change first.
# Exit codes: 0 the rule holds, 1 the rule is broken, 2 the check could not run.
set -euo pipefail

MANIFEST=.claude-plugin/plugin.json
# The paths that an installed copy runs. Keep this list the same as the one in
# AGENTS.md, section "Releases".
SHIPPED=(hooks types .claude-plugin)

fail() {
  echo "check-version: $1" >&2
  exit "${2:-2}"
}

[ $# -eq 1 ] || fail "usage: scripts/check-version.sh <base>, for example origin/main"
base=$1

command -v jq > /dev/null || fail "jq is not installed"
top=$(git rev-parse --show-toplevel 2> /dev/null) || fail "not in a git repository"
cd "$top"
git rev-parse --verify --quiet "$base^{commit}" > /dev/null || fail "the base '$base' is not a commit; fetch it first"

# The version that a commit states, as three numbers. Fails if the manifest is
# missing, has no version, or has one that is not major.minor.patch. Each
# number has at most nine digits, so the comparison below cannot overflow.
NUMBER='(0|[1-9][0-9]{0,8})'
version_at() {
  local commit=$1 version
  version=$(git show "$commit:$MANIFEST" 2> /dev/null | jq -er '.version' 2> /dev/null) ||
    fail "cannot read a version from $MANIFEST at $commit"
  [[ $version =~ ^$NUMBER\.$NUMBER\.$NUMBER$ ]] ||
    fail "the version '$version' at $commit is not major.minor.patch" 1
  echo "$version"
}

# True if version $1 is higher than version $2.
is_higher() {
  local -a a b
  IFS=. read -r -a a <<< "$1"
  IFS=. read -r -a b <<< "$2"
  local i
  for i in 0 1 2; do
    if ((a[i] > b[i])); then return 0; fi
    if ((a[i] < b[i])); then return 1; fi
  done
  return 1
}

# What HEAD changed since it left the base, in the shipped paths only.
changed=$(git diff --name-only "$base...HEAD" -- "${SHIPPED[@]}") ||
  fail "cannot compare HEAD with '$base'"

head_version=$(version_at HEAD)

if [ -z "$changed" ]; then
  echo "check-version: no shipped file changed; the version stays at $head_version."
  exit 0
fi

base_version=$(version_at "$base")

if is_higher "$head_version" "$base_version"; then
  echo "check-version: shipped files changed, and the version rises from $base_version to $head_version."
  exit 0
fi

{
  echo "check-version: shipped files changed, but the version does not rise."
  echo "  version on the base ($base): $base_version"
  echo "  version on HEAD:             $head_version"
  echo "  changed shipped files:"
  while IFS= read -r path; do
    echo "    $path"
  done <<< "$changed"
  echo "An installed copy updates only when the version changes."
  echo "Set \"version\" in $MANIFEST above $base_version. See \"Releases\" in AGENTS.md."
} >&2
exit 1
