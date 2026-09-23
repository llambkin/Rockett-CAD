import { spawnSync } from "node:child_process";
import {
  globSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "scripts/cost-baseline.txt");
const FILE_LIMIT = 500;
const SHOW_LIMIT = 40;
const FUNCTION_LIMIT = 80;
const mode = process.argv[2] ?? "table";

function fail(message) {
  console.error(`cost check failed: ${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (result.error || !result.stdout)
    fail(`${command} did not run: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

function lintSizes() {
  const dir = mkdtempSync(join(tmpdir(), "rockett-cost-"));
  const config = join(dir, "oxlintrc.json");
  const size = { max: 0, skipBlankLines: false, skipComments: false };
  writeFileSync(
    config,
    JSON.stringify({
      categories: { correctness: "off", suspicious: "off", perf: "off" },
      rules: {
        "max-lines": ["warn", size],
        "max-lines-per-function": ["warn", { ...size, IIFEs: true }],
      },
    }),
  );
  try {
    return JSON.parse(
      run(join(root, "node_modules/.bin/oxlint"), ["-c", config, "-f", "json"]),
    ).diagnostics;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function deriveName(text, column) {
  const before = text
    .slice(0, column - 1)
    .replace(/\basync\s*$/, "")
    .trimEnd();
  const call = before.match(
    /([\w$.]+)(?:<[^()]*>)?\((["'`][^"'`]*["'`])?(?:\s*,)?$/,
  );
  if (call) {
    if (call[2]) return `${call[1]}(${call[2]})`;
    const assigned = before
      .slice(0, call.index)
      .match(/([\w$]+)\s*[:=]\s*(?:await\s+)?$/);
    return assigned ? assigned[1] : `${call[1]}()`;
  }
  return before.match(/([\w$]+)\s*[:=]$/)?.[1] ?? "anonymous";
}

function measure() {
  const tracked = new Set(run("git", ["ls-files", "-z"]).split("\0"));
  const isTest =
    /(^|\/)(test|tests|__tests__)\/|\.(test|spec|bench)\.[cm]?[jt]sx?$/;
  const files = new Map();
  for (const d of lintSizes()) {
    if (!tracked.has(d.filename) || isTest.test(d.filename)) continue;
    const file = files.get(d.filename) ?? {
      path: d.filename,
      lines: 0,
      functions: [],
    };
    files.set(d.filename, file);
    const lines = Number(d.message.match(/\((\d+)\)/)?.[1]);
    const { line, column } = d.labels[0].span;
    if (d.code === "eslint(max-lines)") file.lines = lines;
    if (d.code === "eslint(max-lines-per-function)") {
      file.functions.push({
        line,
        column,
        lines,
        name: d.message.match(/`([^`]+)`/)?.[1],
      });
    }
  }
  for (const file of files.values()) {
    const text = readFileSync(join(root, file.path), "utf8").split("\n");
    for (const f of file.functions)
      f.name ??= deriveName(text[f.line - 1] ?? "", f.column);
    file.functions.sort((a, b) => b.lines - a.lines || a.line - b.line);
  }
  return [...files.values()];
}

function marked(files) {
  const entries = new Map();
  for (const file of files) {
    if (file.lines > FILE_LIMIT) entries.set(file.path, file.lines);
    const seen = new Map();
    for (const f of file.functions.toSorted((a, b) => a.line - b.line)) {
      if (f.lines <= FUNCTION_LIMIT) continue;
      const n = (seen.get(f.name) ?? 0) + 1;
      seen.set(f.name, n);
      entries.set(`${file.path} ${f.name}${n > 1 ? `#${n}` : ""}`, f.lines);
    }
  }
  return new Map(
    [...entries].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

function ratchet(files) {
  let text = "";
  try {
    text = readFileSync(baselinePath, "utf8");
  } catch {
    if (mode !== "--update")
      fail(
        "scripts/cost-baseline.txt is missing; write it with npm run cost -- --update",
      );
  }
  const base = new Map(
    text
      .split("\n")
      .filter(Boolean)
      .map((l) => [
        l.slice(0, l.lastIndexOf(" ")),
        Number(l.slice(l.lastIndexOf(" ") + 1)),
      ]),
  );
  const current = marked(files);
  const rises = [...current]
    .filter(([key, n]) => !base.has(key) || n > base.get(key))
    .map(
      ([key, n]) => `${key}: lines ${n}, baseline ${base.get(key) ?? "none"}`,
    );
  const falls = [...base]
    .filter(([key, n]) => (current.get(key) ?? 0) < n)
    .map(
      ([key, n]) =>
        `${key}: lines ${current.get(key) ?? "under the limit"}, baseline ${n}`,
    );
  if (mode === "--update") {
    for (const change of [...rises, ...falls]) console.log(`updated ${change}`);
    writeFileSync(
      baselinePath,
      [...current].map(([key, n]) => `${key} ${n}\n`).join(""),
    );
  } else if (rises.length) {
    for (const rise of rises) console.error(`cost check failed: ${rise}`);
    fail(
      "a marked file or function grew or a new one crossed a limit; tidy it, or run npm run cost -- --update and say why in the commit body",
    );
  } else if (falls.length) {
    for (const fall of falls) console.error(`cost check failed: ${fall}`);
    fail(
      "marked code shrank; shrink the baseline in this commit with npm run cost -- --update",
    );
  }
  const functions = [...current.keys()].filter((key) =>
    key.includes(" "),
  ).length;
  console.log(
    `OK cost baseline: ${current.size - functions} files, ${functions} functions`,
  );
}

function benchMedians() {
  const medians = new Map();
  for (const path of globSync("{*,modules/*}/dist/bench.json", {
    cwd: root,
  }).toSorted()) {
    let report;
    try {
      report = JSON.parse(readFileSync(join(root, path), "utf8"));
    } catch {
      fail(`${path} is not a vitest bench JSON report`);
    }
    for (const suite of report.testResults ?? [])
      for (const test of suite.assertionResults ?? [])
        for (const group of test.benchmarks ?? [])
          for (const task of group.tasks ?? []) {
            if (typeof task.latency?.p50 !== "number") continue;
            const key = `${dirname(dirname(path))} ${task.name.split(/\s+/)[0]}`;
            medians.set(key, [
              ...(medians.get(key) ?? []),
              `${task.latency.p50.toPrecision(3)} ms ${task.name}`,
            ]);
          }
  }
  return medians;
}

function table(files) {
  const medians = benchMedians();
  const used = new Set();
  const units = new Map();
  for (const file of files) {
    const module = file.path.match(/^modules\/[^/]+(?=\/)/)?.[0];
    const benchOf = (f) => `${module ?? file.path.split("/")[0]} ${f.name}`;
    const shown = file.functions.filter(
      (f) => f.lines > SHOW_LIMIT || medians.has(benchOf(f)),
    );
    const bigFunction = file.functions.some((f) => f.lines > FUNCTION_LIMIT);
    if (
      !module &&
      file.lines <= FILE_LIMIT &&
      !bigFunction &&
      !shown.some((f) => medians.has(benchOf(f)))
    )
      continue;
    const key = module ?? file.path;
    const unit = units.get(key) ?? {
      label: module ? `${module} (package)` : file.path,
      lines: 0,
      rows: [],
    };
    units.set(key, unit);
    unit.lines += file.lines;
    if (module && file.lines > FILE_LIMIT)
      unit.rows.push({
        label: `  ${file.path.slice(key.length + 1)}`,
        lines: file.lines,
      });
    for (const f of shown) {
      const where = module
        ? `${file.path.slice(key.length + 1)}:${f.line}`
        : `line ${f.line}`;
      if (medians.has(benchOf(f))) used.add(benchOf(f));
      unit.rows.push({
        label: `  ${f.name} (${where})`,
        lines: f.lines,
        fn: true,
        median: medians.get(benchOf(f))?.join("; ") ?? "no bench",
      });
    }
  }
  const rows = [];
  for (const unit of [...units.values()].toSorted(
    (a, b) => b.lines - a.lines,
  )) {
    rows.push({
      label: unit.label,
      lines: unit.lines,
      tidy: !unit.label.endsWith("(package)") && unit.lines > FILE_LIMIT,
    });
    for (const row of unit.rows.toSorted((a, b) => b.lines - a.lines)) {
      rows.push({
        ...row,
        tidy: row.lines > (row.fn ? FUNCTION_LIMIT : FILE_LIMIT),
      });
    }
  }
  const width = Math.max(...rows.map((r) => r.label.length), 16);
  const line = (label, lines, mark, median) =>
    `${label.padEnd(width)}  ${String(lines).padStart(5)}  ${mark.padEnd(4)}  ${median}`.trimEnd();
  console.log(line("file or function", "lines", "mark", "median"));
  for (const r of rows)
    console.log(line(r.label, r.lines, r.tidy ? "tidy" : "", r.median ?? ""));
  for (const [key, tasks] of medians) {
    if (!used.has(key))
      console.log(
        `bench without a function in ${key.split(" ")[0]}: ${tasks.join("; ")}`,
      );
  }
}

if (mode === "table") table(measure());
else if (mode === "--check" || mode === "--update") ratchet(measure());
else fail("usage: node scripts/cost.mjs [--check | --update]");
