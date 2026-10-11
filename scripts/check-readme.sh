#!/bin/sh
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
readme=${1:-$root/README.md}

[ -f "$readme" ] || {
    printf 'readme check failed: %s is missing\n' "$readme" >&2
    exit 1
}

awk -v max=20 -v file="${1:-README.md}" '
function check(    rest, n) {
    if (item == "") return
    if (match(item, /^- \*\*[^*]+\*\*:?/) == 0) {
        printf "%s:%d: feature item has no bold name: %s\n", file, start, first
        bad = 1
    } else {
        rest = substr(item, RLENGTH + 1)
        n = 0
        while (match(rest, /[^ \t]+/)) {
            n++
            rest = substr(rest, RSTART + RLENGTH)
        }
        if (n > max) {
            printf "%s:%d: %d words after the bold name, limit %d: %s\n", file, start, n, max, first
            bad = 1
        }
    }
    item = ""
}
/^## / { check(); inside = ($0 == "## Features"); if (inside) seen = 1; next }
!inside { next }
/^- / { check(); item = $0; first = $0; start = NR; next }
/^[ \t]+[^ \t]/ && item != "" { item = item " " $0; next }
{ check() }
END {
    check()
    if (!seen) { printf "%s: no ## Features section\n", file; bad = 1 }
    exit bad
}
' "$readme" >&2

cd "$root"
top=$(git ls-files | cut -d/ -f1 | sort -u | tr '\n' ' ')
dead=$(awk -v top="$top" '
BEGIN { n = split(top, t, " "); for (i = 1; i <= n; i++) tops[t[i]] = 1 }
FNR == 1 { fence = 0; dir = FILENAME; sub(/[^\/]*$/, "", dir) }
/^[ \t]*(```|~~~)/ { fence = !fence; next }
fence { next }
{
    line = $0
    while (match(line, /`[^` ]+`|\]\([^) ]+\)/)) {
        tok = substr(line, RSTART, RLENGTH)
        line = substr(line, RSTART + RLENGTH)
        p = substr(tok, 2, length(tok) - 2)
        if (tok ~ /^\]/) {
            p = substr(p, 2)
            sub(/#.*/, "", p)
            if (p != "" && p !~ /^[a-z]+:/) print FILENAME ":" FNR, dir p
            continue
        }
        if (p ~ /[{}<>*:$@~]|^[.\/]/) continue
        seg = p
        sub(/\/.*/, "", seg)
        if (seg in tops || p ~ /\.md$|\.test\.[a-z]+$/) print FILENAME ":" FNR, p
    }
}
' $(git ls-files '*.md') | while read -r where path; do
    git --literal-pathspecs ls-files --error-unmatch -- "$path" >/dev/null 2>&1 ||
        printf '%s: %s is not tracked\n' "$where" "$path"
done)
[ -z "$dead" ] || {
    printf '%s\n' "$dead" >&2
    exit 1
}
