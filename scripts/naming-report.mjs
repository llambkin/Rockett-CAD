import fs from "node:fs";
import path from "node:path";
import { register } from "tsx/esm/api";

const [dataDir] = process.argv.slice(2);
const projects = dataDir && path.join(dataDir, "projects");
if (
  !projects ||
  !fs.statSync(projects, { throwIfNoEntry: false })?.isDirectory()
) {
  console.error(
    "usage: node scripts/naming-report.mjs <dataDir>, a copy of a data directory holding projects/",
  );
  process.exit(1);
}

register();
const server = (file) => import(`../server/src/${file}`);
const [
  { initKernel },
  { dropEngine },
  { planNamingUpgrade },
  { ProjectStore },
  { validateDocument },
  { LocalStorage },
  { backupNamespace, BACKUP_RECORD },
] = await Promise.all(
  [
    "geometry/kernel.ts",
    "geometry/engine.ts",
    "geometry/upgradeNaming.ts",
    "store/projectStore.ts",
    "api/validate.ts",
    "store/storage.ts",
    "store/jsonStore.ts",
  ].map(server),
);

const refuse = (operation) => async (target) => {
  throw new Error(`naming-report never writes: ${operation} ${target}`);
};
const readOnly = {
  readFile: fs.promises.readFile,
  readdir: fs.promises.readdir,
  stat: fs.promises.stat,
  mkdir: refuse("mkdir"),
  open: refuse("open"),
  rename: refuse("rename"),
  rm: refuse("rm"),
};

const target = ({ bodyId, name }) => (name ? `${bodyId} ${name}` : bodyId);
const listed = (label, targets) =>
  targets.length ? ` ${label} ${targets.map(target).join(", ")}` : "";
const line = (m) =>
  `  ${m.featureId ?? "-"} ${m.path} ${m.status} ${target(m.from)}` +
  (m.to ? ` -> ${target(m.to)}` : "") +
  listed("candidates", m.candidates) +
  listed("suggestions", m.suggestions);

await initKernel();
const storage = new LocalStorage(path.resolve(dataDir), readOnly);
const store = new ProjectStore(storage, validateDocument);
let pending = 0;
for (const id of await store.documents.keys()) {
  try {
    if (await store.isTemporary(id)) continue;
    const names = await backupNamespace(
      storage,
      store.documents.dir(id),
    ).names();
    if (names.includes(BACKUP_RECORD)) {
      pending++;
      console.log(`${id} pending migration`);
      continue;
    }
    const doc = await store.load(id);
    console.log(`${id} namingVersion ${doc.namingVersion}`);
    if (doc.namingVersion === 2) continue;
    pending++;
    const { mappings, failures } = planNamingUpgrade(
      doc,
      await store.sources(doc),
    );
    for (const mapping of mappings) console.log(line(mapping));
    for (const f of failures)
      console.log(
        `  ${f.featureId} fails under version ${f.namingVersion}: ${f.error}`,
      );
  } catch (err) {
    pending++;
    console.log(`${id} error ${err.message}`);
  } finally {
    dropEngine(id);
  }
}
process.exit(pending ? 1 : 0);
