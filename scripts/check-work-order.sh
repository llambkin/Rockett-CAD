#!/bin/sh
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
file=${ROCKETT_WORK_ORDER:-"$root/WORK-ORDER.md"}
mode=${1:-check}

fail() {
    printf 'work order check failed: %s\n' "$1" >&2
    exit 1
}

case "$mode" in
check | --complete | --next) ;;
*) fail "usage: scripts/check-work-order.sh [--complete|--next]" ;;
esac

[ -f "$file" ] || fail "WORK-ORDER.md is missing"
[ -f "$root/AGENTS.md" ] || fail "AGENTS.md is missing"
[ -f "$root/LAST-RUN.md" ] || fail "LAST-RUN.md is missing"
head -n 1 "$root/LAST-RUN.md" | grep -qx '# Last run' || fail "LAST-RUN.md must start with # Last run"

result=$(awk -F '|' -v mode="$mode" '
function trim(value) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); return value }
function reject(message) { print "ERROR " message; bad = 1 }
/^\|/ {
    if (NF != 8) { if (in_table) reject("row has " NF - 2 " cells, expected 6: " substr($0, 1, 60)); next }
    c1 = trim($2); c2 = trim($3); c3 = trim($4); c4 = trim($5); c5 = trim($6); c6 = trim($7)
    if (c1 ~ /^:?-+:?$/) next
    if (c1 == "ID") {
        if (c2 != "Outcome" || c3 != "Status" || c4 != "Depends" || c5 != "Scope" || c6 != "Check") reject("bad table header")
        in_table = 1
        next
    }
    if (!in_table) next
    id = c1
    if (id !~ /^[A-Z]+-([0-9][0-9][0-9]|CP)$/) reject("invalid ID " id)
    if (id in state) reject("duplicate ID " id)
    if (c3 !~ /^(todo|in-flight|done|decision|operator)$/) reject(id " has invalid status " c3)
    if (c2 == "" || c5 == "" || c6 == "") reject(id " has an empty cell")
    if (c4 != "-") {
        n = split(c4, list, /,[[:space:]]*/)
        for (i = 1; i <= n; i++) if (!(list[i] in state)) reject(id " depends on " list[i] ", which is missing or not earlier in the file")
    }
    state[id] = c3; deps[id] = c4; order[++count] = id
    if (c3 == "in-flight") active = active ? active " " id : id
    next
}
{ in_table = 0 }
END {
    if (!count) reject("no rows")
    if (split(active, a, " ") > 1) reject("more than one in-flight row: " active)
    for (k = 1; k <= count; k++) {
        id = order[k]
        parked[id] = (state[id] == "decision" || state[id] == "operator")
        if (deps[id] == "-") continue
        n = split(deps[id], list, /,[[:space:]]*/)
        for (i = 1; i <= n; i++) if (parked[list[i]]) parked[id] = 1
    }
    for (k = 1; k <= count; k++) {
        id = order[k]
        if (state[id] != "todo") continue
        if (parked[id]) { waiting++; continue }
        open++
        ready = 1
        if (deps[id] != "-") {
            n = split(deps[id], list, /,[[:space:]]*/)
            for (i = 1; i <= n; i++) if (state[list[i]] != "done") ready = 0
        }
        if (ready && next_id == "") next_id = id
    }
    if (open && !active && next_id == "") reject("todo rows remain but none is dependency-ready")
    if (bad) exit 1
    if (mode == "--complete") {
        for (k = 1; k <= count; k++) if (state[order[k]] != "done" && state[order[k]] != "operator") left = left " " order[k]
        if (left != "") { print "ERROR unfinished rows:" left; exit 1 }
    }
    if (mode == "--next") { print (active != "" ? active : next_id); exit 0 }
    printf "OK %d rows, %d open, %d waiting on decisions or operators, next %s\n", count, open, waiting + 0, (active != "" ? active : (next_id != "" ? next_id : "none"))
}' "$file") || { printf '%s\n' "$result" | sed 's/^ERROR /work order check failed: /' >&2; exit 1; }

printf '%s\n' "$result"
