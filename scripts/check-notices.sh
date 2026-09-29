#!/bin/sh
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
notices="$root/THIRD-PARTY-NOTICES.md"

fail() {
    printf 'notices check failed: %s\n' "$1" >&2
    exit 1
}

js='
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const [mode, root, notices, out] = process.argv.slice(1);
const lock = JSON.parse(fs.readFileSync(root + "/package-lock.json", "utf8")).packages;
const licence = (p) => p.license ?? (p.licenses ?? []).map((l) => l.type ?? l).join(" OR ");
const manifest = (dir) => {
  const file = dir + "/package.json";
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};
const read = (rel) => {
  const p = manifest(root + "/" + rel);
  return p && p.name + " " + p.version + " " + licence(p);
};
const texts = (dir) =>
  fs.readdirSync(dir).filter((f) => /^(licen[cs]e|copying)/i.test(f)).map((f) => dir + "/" + f);
const table = fs
  .readFileSync(notices, "utf8")
  .split("\n")
  .map((line) => line.split("|").slice(1, -1).map((c) => c.trim()))
  .filter((c) => c.length === 5 && c[0] !== "Package" && !/^-+$/.test(c[0]));
const shipped = table.filter((c) => /image|client bundle/.test(c[3])).map((c) => c[0] + "@" + c[1]);
const problems = [];

if (mode === "shipped") console.log(shipped.join("\n"));

if (mode === "check") {
  const rows = new Set(table.map((c) => c.slice(0, 3).join(" ")));
  const installed = new Set(Object.keys(lock).filter((k) => k && !lock[k].link).map(read).filter(Boolean));
  for (const dir of process.env.SHIPPED.split("\n")) {
    const rel = dir.slice(root.length + 1);
    if (!rel || lock[rel]?.link) continue;
    const entry = read(rel);
    if (!rows.has(entry)) problems.push("missing: " + entry);
  }
  for (const row of rows) if (!installed.has(row)) problems.push("stale: " + row);
  if (!problems.length) console.log("OK notices: " + rows.size + " packages");
}

if (mode === "collect") {
  const dirs = new Map();
  for (const rel of Object.keys(lock)) {
    const p = rel && !lock[rel].link && manifest(root + "/" + rel);
    if (p) dirs.set(p.name + "@" + p.version, root + "/" + rel);
  }
  for (const id of shipped) {
    const files = dirs.has(id) ? texts(dirs.get(id)) : [];
    if (!files.length) problems.push("no licence text for " + id);
    fs.mkdirSync(out + "/" + id, { recursive: true });
    for (const f of files) fs.copyFileSync(f, out + "/" + id + "/" + path.basename(f));
  }
  const lines = [];
  const nodeLicence = path.resolve(process.execPath, "../../LICENSE");
  lines.push(["node", "node", process.versions.node, fs.existsSync(nodeLicence) ? nodeLicence : "none"]);
  const global = execFileSync("npm", ["ls", "--global", "--all", "--parseable"], { encoding: "utf8" });
  const opt = fs.existsSync("/opt") ? fs.readdirSync("/opt").map((d) => "/opt/" + d) : [];
  for (const dir of [...global.split("\n").slice(1), ...opt]) {
    const p = dir && manifest(dir);
    if (p) lines.push(["node", p.name, p.version, texts(dir)[0] ?? "none"]);
  }
  const debian = execFileSync("dpkg-query", ["-W", "-f", "${Package} ${Version}\n"], { encoding: "utf8" });
  for (const pkg of debian.trim().split("\n")) {
    const [name, version] = pkg.split(" ");
    const copyright = "/usr/share/doc/" + name + "/copyright";
    lines.push(["debian", name, version, fs.existsSync(copyright) ? copyright : "none"]);
  }
  fs.writeFileSync(out + "/base-image.txt", lines.map((l) => l.join(" ")).join("\n") + "\n");
}

for (const p of problems) console.error("notices check failed: " + p);
if (problems.length) process.exit(1);
'

if [ "${1:-}" = --collect ]; then
    [ $# -eq 2 ] || fail "usage: check-notices.sh --collect DIR"
    node -e "$js" collect "$root" "$notices" "$2" ||
        fail "the image build could not collect every licence text"
    exit 0
fi

[ -f "$notices" ] || fail "THIRD-PARTY-NOTICES.md is missing"
find "$root/modules" -name node_modules -prune -o -name '*.wasm' -print |
    while IFS= read -r wasm; do
        grep -qx "## $(basename "$wasm")" "$notices" ||
            fail "no section '## $(basename "$wasm")' for ${wasm#"$root"/}"
    done
shipped=$(cd "$root" && npm ls --omit=dev --all --parseable 2>/dev/null) ||
    fail "npm ls --omit=dev failed; run npm ci --ignore-scripts"

SHIPPED="$shipped" node -e "$js" check "$root" "$notices" ||
    fail "update THIRD-PARTY-NOTICES.md to match the installed packages"

[ $# -eq 0 ] && exit 0
image=$1
engine=$(command -v podman || command -v docker) || fail "podman or docker is needed to check $image"
"$engine" image inspect "$image" >/dev/null 2>&1 || fail "no local image $image"
"$engine" run --rm --entrypoint cat "$image" /app/THIRD-PARTY-NOTICES.md 2>/dev/null |
    cmp -s - "$notices" || fail "$image lacks this THIRD-PARTY-NOTICES.md at /app"
ids=$(node -e "$js" shipped "$root" "$notices")
problems=$("$engine" run --rm -i --entrypoint sh "$image" -s -- $ids <<'EOF'
for id do
    [ -n "$(ls -A "/app/licences/$id" 2>/dev/null)" ] || echo "no licence text for $id in /app/licences"
done
inventory=/app/licences/base-image.txt
[ -s "$inventory" ] || { echo "no base image inventory at $inventory"; exit 0; }
awk '$4 != "none" { print $4 }' "$inventory" | while IFS= read -r file; do
    [ -f "$file" ] || echo "the inventory names a missing licence text: $file"
done
[ "$(dpkg-query -W -f '${Package} ${Version}\n' | sort)" = "$(awk '$1 == "debian" { print $2, $3 }' "$inventory" | sort)" ] ||
    echo "the inventory does not match the installed Debian packages"
grep -q "^node node $(node -p process.versions.node) " "$inventory" ||
    echo "the inventory does not name this Node.js"
EOF
) || fail "could not run $image"
if [ -n "$problems" ]; then
    printf '%s\n' "$problems" | sed 's/^/notices check failed: /' >&2
    exit 1
fi
printf 'OK image notices: %s\n' "$image"
