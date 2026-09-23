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
