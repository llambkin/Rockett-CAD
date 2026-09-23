#!/bin/sh
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failures=0

queue() {
    printf '# Work order\n\n## Rulings\n\n%s\n\n## Proposed\n\n%s\n\n## Rows\n\n' "$1" "$2" >"$tmp/queue.md"
    printf '| ID | Outcome | Status | Depends | Scope | Check |\n| --- | --- | --- | --- | --- | --- |\n' >>"$tmp/queue.md"
    cat >>"$tmp/queue.md"
    printf '\nLater phases: see later.md.\n' >>"$tmp/queue.md"
    printf '| ID | Commit | Outcome |\n| --- | --- | --- |\n' >"$tmp/done.md"
    printf '# Later\n\n| ID | Outcome | Status | Depends | Scope | Check |\n| --- | --- | --- | --- | --- | --- |\n' >"$tmp/later.md"
}

archive() { cat >>"$tmp/done.md"; }
later() { cat >>"$tmp/later.md"; }
after() {
    printf '\n| ID | Outcome | Status | Depends | Scope | Check |\n| --- | --- | --- | --- | --- | --- |\n' >>"$tmp/queue.md"
    cat >>"$tmp/queue.md"
}

expect() {
    name=$1 want=$2 text=$3
    shift 3
    if output=$(ROCKETT_WORK_ORDER="$tmp/queue.md" ROCKETT_WORK_ORDER_DONE="$tmp/done.md" ROCKETT_WORK_ORDER_LATER="$tmp/later.md" sh "$root/scripts/check-work-order.sh" "$@" 2>&1); then got=pass; else got=fail; fi
    if [ "$got" = "$want" ] && printf '%s\n' "$output" | grep -qF -- "$text"; then
        printf 'ok   %s\n' "$name"
    else
        printf 'FAIL %s: wanted %s with "%s", got %s:\n%s\n' "$name" "$want" "$text" "$got" "$output"
        failures=$((failures + 1))
    fi
}

queue '- None.' 'None.' <<'EOF'
| A-001 | a | done | - | s | c |
| A-002 | b | todo | A-001 | s | c |
| A-CP | cp | todo | A-001, A-002 | s | c |
EOF
expect 'ready queue passes' pass 'next A-002'
expect 'next prints the first ready row' pass 'A-002' --next
expect 'complete rejects todo rows' fail 'unfinished rows: A-002 A-CP' --complete

queue '- None.' 'None.' <<'EOF'
| A-001 | a | done | - | s | c |
| A-002 | b | done | A-001 | s | c |
| A-CP | cp | done | A-001, A-002 | s | c |
EOF
expect 'completed queue passes complete' pass 'next none' --complete

queue '- None.' 'None.' <<'EOF'
| A-001 | a | todo | - | s | c |
| A-002 | b | done | A-001 | s | c |
EOF
expect 'done needs done dependencies' fail 'A-002 is done but depends on A-001, which is todo'

queue '- None.' 'None.' <<'EOF'
| A-001 | a | todo | - | s | c |
| A-002 | b | in-flight | A-001 | s | c |
EOF
expect 'in-flight needs done dependencies' fail 'A-002 is in-flight but depends on A-001, which is todo' --next

queue '- None.' 'None.' <<'EOF'
| A-001 | a | done | - | s | c |
| A-002 | b | in-flight | A-001 | s | c |
| A-003 | c | todo | - | s | c |
EOF
expect 'next prints the in-flight row' pass 'A-002' --next
expect 'complete rejects an in-flight row' fail 'unfinished rows: A-002 A-003' --complete

queue '- None.' 'None.' <<'EOF'
| A-001 | a | done | - | s | c |
| A-002 | b | operator | A-001 | s | c |
| A-003 | c | decision | - | s | c |
EOF
expect 'complete rejects unfinished operator and decision rows' fail 'unfinished rows: A-002 A-003' --complete

queue '- None.' 'None.' <<'EOF'
| A-001 | a | deferred | - | s | c |
EOF
expect 'deferral needs a ruling' fail 'A-001 is deferred without a Deferred ruling'

queue '- Deferred A-002: not needed yet.' 'None.' <<'EOF'
| A-001 | a | done | - | s | c |
| A-002 | b | todo | A-001 | s | c |
EOF
expect 'ruling must name a deferred row' fail 'Deferred ruling names A-002, which is todo'

queue '- Deferred A-001: not needed yet.' 'None.' <<'EOF'
| A-001 | a | deferred | - | s | c |
| A-002 | b | done | A-001 | s | c |
EOF
expect 'deferred never satisfies a dependency' fail 'A-002 is done but depends on A-001, which is deferred'

queue '- Deferred A-001: not needed yet.' 'None.' <<'EOF'
| A-001 | a | deferred | - | s | c |
| A-002 | b | todo | A-001 | s | c |
| A-003 | c | todo | - | s | c |
EOF
expect 'dependants of a deferred row wait' pass 'next A-003'

queue '- Deferred A-002: not needed yet.' 'None.' <<'EOF'
| A-001 | a | done | - | s | c |
| A-002 | b | deferred | A-001 | s | c |
EOF
expect 'ruled deferral passes complete' pass 'next none' --complete

queue '- None.' '- A-002, A-009: need a better check.' <<'EOF'
| A-001 | a | done | - | s | c |
| A-002 | b | todo | A-001 | s | c |
EOF
expect 'proposed entry must name real rows' fail 'Proposed names unknown row A-009'

queue '- None.' '- A-002: depend on A-004 instead.' <<'EOF'
| A-001 | a | done | - | s | c |
| A-002 | b | todo | A-001 | s | c |
| A-003 | c | todo | A-002 | s | c |
| A-004 | d | todo | - | s | c |
EOF
expect 'proposed entry parks its row and dependants, not rows it mentions' pass '2 waiting on decisions, operators, deferrals or proposals, next A-004'

queue '- None.' '- A-002: needs a better check.' <<'EOF'
| A-001 | a | done | - | s | c |
| A-002 | b | in-flight | A-001 | s | c |
EOF
expect 'proposed entry blocks an in-flight row' fail 'A-002 is in-flight but a Proposed entry names it'

queue '- None.' 'None.' <<'EOF'
| A-001 | a | done | - | s | c |
| A-002 | b | todo | - | s | c |
| A-CP | cp | todo | A-001 | s | c |
EOF
expect 'checkpoint must cover its phase' fail 'A-CP neither depends on nor excludes A-002'

queue '- None.' 'None.' <<'EOF'
| A-001 | a | done | - | s | c |
| A-002 | b | todo | - | s | c |
| A-CP | cp. Explicitly excluded: A-002. Later. | todo | A-001 | s | c |
EOF
expect 'checkpoint exclusion covers a row' pass 'next A-002'

queue '- None.' 'None.' <<'EOF'
| A-001 | a | done | - | s | c |
| B-001 | b | todo | - | s | c |
| A-CP | cp. Explicitly excluded: B-001. | todo | A-001 | s | c |
EOF
expect 'checkpoint excludes only its phase' fail 'A-CP excludes B-001, which is not a row of its phase'

queue '- None.' 'None.' <<'EOF'
| A-002 | b | todo | A-001 | s | c |
| A-CP | cp | todo | A-001, A-002 | s | c |
EOF
archive <<'EOF'
| A-001 | abc1234 | a |
EOF
expect 'archived done row satisfies a dependency' pass 'OK 3 rows, 2 open, 0 waiting on decisions, operators, deferrals or proposals, next A-002'
expect 'row prints an archived row' pass '| A-001 | abc1234 | a |' --row A-001
expect 'row rejects an unknown row' fail 'no row A-009' --row A-009

queue '- None.' 'None.' <<'EOF'
| A-001 | a | todo | - | s | c |
EOF
archive <<'EOF'
| A-001 | - | a |
EOF
expect 'duplicate across the archive fails' fail 'duplicate ID A-001'

queue '- None.' 'None.' <<'EOF'
| A-001 | a | done | - | s | c |
EOF
archive <<'EOF'
| A-002 | main | b |
EOF
expect 'archived commit is a hash or a dash' fail 'A-002 has invalid commit main'

queue '- None.' 'None.' <<'EOF'
| A-002 | b | todo | - | s | c |
EOF
archive <<'EOF'
| A-001 | - | a |
| A-CP | - | cp |
EOF
expect 'archived checkpoint needs no coverage' pass 'next A-002'

queue '- None.' 'None.' <<'EOF'
| A-001 | a | done | - | s | c |
EOF
later <<'EOF'
| B-001 | b | todo | A-001 | s | c |
EOF
after <<'EOF'
| C-001 | c | todo | B-001 | s | c |
EOF
expect 'later rows count and stay open in file order' pass 'OK 3 rows, 2 open, 0 waiting on decisions, operators, deferrals or proposals, next B-001'
expect 'row prints a later row' pass '| B-001 | b | todo |' --row B-001
expect 'complete lists later rows in file order' fail 'unfinished rows: B-001 C-001' --complete

queue '- None.' 'None.' <<'EOF'
| A-001 | a | todo | B-001 | s | c |
EOF
later <<'EOF'
| B-001 | b | todo | - | s | c |
EOF
expect 'a row above the pointer cannot depend on later rows' fail 'A-001 depends on B-001, which is missing or not earlier in the file'

queue '- None.' 'None.' <<'EOF'
| A-001 | a | todo | - | s | c |
EOF
later <<'EOF'
| A-001 | b | todo | - | s | c |
EOF
expect 'duplicate across the later file fails' fail 'duplicate ID A-001'

queue '- None.' 'None.' <<'EOF'
| A-001 | a | todo | - | s | c |
EOF
sed -i '/^Later phases: /d' "$tmp/queue.md"
expect 'the later pointer is required' fail 'needs one line starting with Later phases:'

[ "$failures" -eq 0 ] || { printf '%s work order test(s) failed\n' "$failures" >&2; exit 1; }
printf 'work order tests passed\n'
