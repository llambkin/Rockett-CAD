#!/bin/sh
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
file=${ROCKETT_WORK_ORDER:-"$root/WORK-ORDER.md"}
done_file=${ROCKETT_WORK_ORDER_DONE:-"$root/docs/internals/work-order-done.md"}
later=${ROCKETT_WORK_ORDER_LATER:-"$root/docs/internals/work-order-later.md"}
mode=${1:-check}

fail() {
    printf 'work order check failed: %s\n' "$1" >&2
    exit 1
}

case "$mode" in
check | --complete | --next) ;;
--row) printf '%s\n' "${2:-}" | grep -Eqx '[A-Z]+-([0-9]{3}|CP)' || fail "usage: scripts/check-work-order.sh --row ID" ;;
*) fail "usage: scripts/check-work-order.sh [--complete|--next|--row ID]" ;;
esac

[ -f "$file" ] || fail "WORK-ORDER.md is missing"
[ -f "$done_file" ] || fail "work-order-done.md is missing"
[ -f "$later" ] || fail "work-order-later.md is missing"
[ -f "$root/AGENTS.md" ] || fail "AGENTS.md is missing"
[ -f "$root/LAST-RUN.md" ] || fail "LAST-RUN.md is missing"
head -n 1 "$root/LAST-RUN.md" | grep -qx '# Last run' || fail "LAST-RUN.md must start with # Last run"
[ "$(grep -c '^Later phases: ' "$file")" = 1 ] || fail "WORK-ORDER.md needs one line starting with Later phases:"

if [ "$mode" = --row ]; then
    grep -h "^| $2 |" "$done_file" "$file" "$later" || fail "no row $2"
    exit 0
fi

result=$(awk -v later="$later" '{ print } /^Later phases: / { while ((getline line < later) > 0) print line }' "$file" | awk -F '|' -v mode="$mode" -v done_file="$done_file" '
function trim(value) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); return value }
function reject(message) { print "ERROR " message; bad = 1 }
FILENAME == done_file {
    if (!/^\|/) next
    if (NF != 5) { reject("done row has " NF - 2 " cells, expected 3: " substr($0, 1, 60)); next }
    id = trim($2); commit = trim($3)
    if (id ~ /^:?-+:?$/) next
    if (id == "ID") { if (commit != "Commit" || trim($4) != "Outcome") reject("bad done table header"); next }
    if (id !~ /^[A-Z]+-([0-9][0-9][0-9]|CP)$/) reject("invalid ID " id)
    if (id in state) reject("duplicate ID " id)
    if (commit != "-" && (commit !~ /^[0-9a-f]+$/ || length(commit) < 7)) reject(id " has invalid commit " commit)
    if (trim($4) == "") reject(id " has an empty cell")
    state[id] = "done"; deps[id] = "-"; archived[id] = 1; order[++count] = id
    next
}
/^## / { section = substr($0, 4) }
section == "Rulings" && /^- Deferred / {
    line = substr($0, 12)
    colon = index(line, ":")
    if (!colon || trim(substr(line, colon + 1)) == "") { reject("Deferred ruling needs IDs, a colon and a reason: " substr($0, 1, 60)); next }
    n = split(substr(line, 1, colon - 1), list, /,[[:space:]]*/)
    for (i = 1; i <= n; i++) ruled[trim(list[i])] = 1
    next
}
section == "Proposed" && /^(- |[0-9]+\. )/ {
    line = $0
    sub(/^(- |[0-9]+\. )/, "", line)
    colon = index(line, ":")
    if (!colon) next
    head = substr(line, 1, colon - 1)
    if (head !~ /^[A-Z]+-([0-9][0-9][0-9]|CP)(,[[:space:]]*[A-Z]+-([0-9][0-9][0-9]|CP))*$/) next
    n = split(head, list, /,[[:space:]]*/)
    for (i = 1; i <= n; i++) proposed[list[i]] = 1
    next
}
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
    if (c3 !~ /^(todo|in-flight|done|decision|operator|deferred)$/) reject(id " has invalid status " c3)
    if (c2 == "" || c5 == "" || c6 == "") reject(id " has an empty cell")
    if (c4 != "-") {
        n = split(c4, list, /,[[:space:]]*/)
        for (i = 1; i <= n; i++) if (!(list[i] in state)) reject(id " depends on " list[i] ", which is missing or not earlier in the file")
    }
    if (id ~ /-CP$/ && (e = index(c2, "Explicitly excluded:"))) {
        rest = substr(c2, e + 20)
        if (dot = index(rest, ".")) rest = substr(rest, 1, dot - 1)
        excluded[id] = trim(rest)
    }
    state[id] = c3; deps[id] = c4; order[++count] = id
    if (c3 == "in-flight") active = active ? active " " id : id
    next
}
{ in_table = 0 }
END {
    if (!count) reject("no rows")
    if (split(active, a, " ") > 1) reject("more than one in-flight row: " active)
    for (id in proposed) if (!(id in state)) reject("Proposed names unknown row " id)
    for (id in ruled) {
        if (!(id in state)) reject("Deferred ruling names unknown row " id)
        else if (state[id] != "deferred") reject("Deferred ruling names " id ", which is " state[id])
    }
    for (k = 1; k <= count; k++) {
        id = order[k]
        if (state[id] == "deferred" && !(id in ruled)) reject(id " is deferred without a Deferred ruling under Rulings")
        if (state[id] == "in-flight" && id in proposed) reject(id " is in-flight but a Proposed entry names it")
        parked[id] = (state[id] == "decision" || state[id] == "operator" || state[id] == "deferred" || (id in proposed && state[id] != "done"))
        if (deps[id] == "-") continue
        n = split(deps[id], list, /,[[:space:]]*/)
        for (i = 1; i <= n; i++) {
            d = list[i]
            if ((state[id] == "done" || state[id] == "in-flight") && state[d] != "done") reject(id " is " state[id] " but depends on " d ", which is " state[d])
            if (parked[d]) parked[id] = 1
            if (id ~ /-CP$/) covered[id, d] = 1
        }
    }
    for (k = 1; k <= count; k++) {
        cp = order[k]
        if (cp !~ /-CP$/ || cp in archived) continue
        prefix = substr(cp, 1, length(cp) - 2)
        n = excluded[cp] == "" ? 0 : split(excluded[cp], list, /,[[:space:]]*/)
        for (i = 1; i <= n; i++) {
            x = list[i]
            if (!(x in state) || index(x, prefix) != 1) reject(cp " excludes " x ", which is not a row of its phase")
            else if ((cp, x) in covered) reject(cp " both depends on and excludes " x)
            else covered[cp, x] = 1
        }
        for (j = 1; j <= count; j++) {
            r = order[j]
            if (r != cp && index(r, prefix) == 1 && !((cp, r) in covered)) reject(cp " neither depends on nor excludes " r)
        }
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
        for (k = 1; k <= count; k++) if (state[order[k]] != "done" && state[order[k]] != "deferred") left = left " " order[k]
        if (left != "") { print "ERROR unfinished rows:" left; exit 1 }
    }
    if (mode == "--next") { print (active != "" ? active : next_id); exit 0 }
    printf "OK %d rows, %d open, %d waiting on decisions, operators, deferrals or proposals, next %s\n", count, open, waiting + 0, (active != "" ? active : (next_id != "" ? next_id : "none"))
}' "$done_file" -) || { printf '%s\n' "$result" | sed 's/^ERROR /work order check failed: /' >&2; exit 1; }

printf '%s\n' "$result"
