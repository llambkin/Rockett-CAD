import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
const [outDir] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function real(path) {
  const missing = [];
  let at = resolve(path);
  while (!existsSync(at)) {
    missing.unshift(basename(at));
    at = dirname(at);
  }
  return join(realpathSync(at), ...missing);
}

if (!outDir)
  fail(
    "usage: node scripts/cam-qualify-pack.mjs <outDir>, an empty or new directory outside the repository",
  );
const out = real(outDir);
const fromRoot = relative(root, out);
if (
  fromRoot !== ".." &&
  !fromRoot.startsWith(`..${sep}`) &&
  !isAbsolute(fromRoot)
)
  fail(
    `refused: ${outDir} is inside the repository; pick a directory outside it`,
  );
if (existsSync(out) && !statSync(out).isDirectory())
  fail(`refused: ${outDir} is not a directory`);
if (existsSync(out) && readdirSync(out).length)
  fail(`refused: ${outDir} is not empty; pick a new or empty directory`);

register();
const { fixtures, fixture, format, loadPost } =
  await import("../modules/cam/test/goldens.ts");
const post = loadPost("grbl");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cam = JSON.parse(
  readFileSync(join(root, "modules/cam/manifest.json"), "utf8"),
);

const files = fixtures.flatMap((name) => {
  const texts = format(post, fixture(name));
  return texts.map((text, i) => ({
    name: `${texts.length > 1 ? `${name}-${i + 1}` : name}.${post.extension}`,
    text,
  }));
});

mkdirSync(out, { recursive: true });
for (const { name, text } of files)
  writeFileSync(join(out, name), text, { flag: "wx" });
const manifest = {
  cam: cam.version,
  post: {
    id: post.id,
    sha256: sha256(
      readFileSync(join(root, `modules/cam/posts/${post.id}.json`)),
    ),
  },
  files: files.map(({ name, text }) => ({ name, sha256: sha256(text) })),
};
writeFileSync(
  join(out, "pack.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: "wx" },
);
console.log(`wrote ${files.length} files and pack.json to ${out}`);
