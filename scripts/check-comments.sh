#!/bin/sh
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
baseline="$root/scripts/comment-baseline.txt"
linter="$HOME/masterrulez/scripts/lint-comments"
mode=${1:-check}

fail() {
    printf 'comment check failed: %s\n' "$1" >&2
    exit 1
}

case "$mode" in
check | --update) ;;
*) fail "usage: scripts/check-comments.sh [--update]" ;;
esac

[ -f "$linter" ] || fail "masterrulez lint-comments is missing; clone masterrulez to ~/masterrulez"
[ -f "$baseline" ] || fail "scripts/comment-baseline.txt is missing"

report=$(cd "$root" && node "$linter") || true
printf '%s\n' "$report" | grep -q '^lint-comments: ' || fail "lint-comments did not finish: $report"
current=$(printf '%s\n' "$report" | sed -n 's/^\([^ ]*\): \([0-9]*\) comment lines* at .*/\1 \2/p' | LC_ALL=C sort)

status=0
changes=$(printf '%s\n' "$current" | awk '
FILENAME != "-" && NF == 2 { base[$1] = $2; next }
FILENAME == "-" && NF == 2 {
    if (!($1 in base)) { print "rise: " $1 ": comment lines " $2 ", baseline none"; rose = 1 }
    else if ($2 > base[$1]) { print "rise: " $1 ": comment lines " $2 ", baseline " base[$1]; rose = 1 }
}
END { exit rose ? 2 : 0 }' "$baseline" -) || status=$?

if [ "$status" -eq 2 ]; then
    printf '%s\n' "$changes" | grep '^rise: ' | sed 's/^rise: /comment check failed: /' >&2
    fail "code carries no comments; delete the new ones and move the reason to the commit body"
fi
[ "$status" -eq 0 ] || fail "baseline comparison failed"

if [ "$mode" = --update ]; then
    printf '%s\n' "$current" | sed '/^$/d' >"$baseline"
fi
total=$(printf '%s\n' "$current" | awk 'NF { n++; s += $2 } END { printf "%d files, %d lines", n, s }')
printf 'OK comment baseline: %s\n' "$total"
