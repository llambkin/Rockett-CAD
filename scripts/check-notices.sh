#!/bin/sh
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
notices="$root/THIRD-PARTY-NOTICES.md"

fail() {
    printf 'notices check failed: %s\n' "$1" >&2
    exit 1
}

[ -f "$notices" ] || fail "THIRD-PARTY-NOTICES.md is missing"
shipped=$(cd "$root" && npm ls --omit=dev --all --parseable 2>/dev/null) ||
    fail "npm ls --omit=dev failed; run npm ci --ignore-scripts"

SHIPPED="$shipped" node -e '
const fs = require("node:fs");
const [root, notices] = process.argv.slice(1);
const lock = JSON.parse(fs.readFileSync(root + "/package-lock.json", "utf8")).packages;
const licence = (p) => p.license ?? (p.licenses ?? []).map((l) => l.type ?? l).join(" OR ");
const read = (rel) => {
  const file = root + "/" + rel + "/package.json";
  if (!fs.existsSync(file)) return null;
  const p = JSON.parse(fs.readFileSync(file, "utf8"));
  return p.name + " " + p.version + " " + licence(p);
};
const rows = new Set();
for (const line of fs.readFileSync(notices, "utf8").split("\n")) {
  const cells = line.split("|").slice(1, -1).map((c) => c.trim());
  if (cells.length !== 5 || cells[0] === "Package" || /^-+$/.test(cells[0])) continue;
  rows.add(cells.slice(0, 3).join(" "));
}
const installed = new Set(Object.keys(lock).filter((k) => k && !lock[k].link).map(read).filter(Boolean));
const problems = [];
for (const path of process.env.SHIPPED.split("\n")) {
  const rel = path.slice(root.length + 1);
  if (!rel || lock[rel]?.link) continue;
  const entry = read(rel);
  if (!rows.has(entry)) problems.push("missing: " + entry);
}
for (const row of rows) if (!installed.has(row)) problems.push("stale: " + row);
for (const p of problems) console.error("notices check failed: " + p);
if (problems.length) process.exit(1);
console.log("OK notices: " + rows.size + " packages");
' "$root" "$notices" ||
    fail "update THIRD-PARTY-NOTICES.md to match the installed packages"
