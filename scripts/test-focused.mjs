import { resolve } from "node:path";
import { createVitest } from "vitest/node";

const files = [...new Set(process.argv.slice(2).map((file) => resolve(file)))];
if (
  !files.length ||
  process.argv.slice(2).some((file) => file.startsWith("-"))
) {
  console.error("usage: npm run test:focused -- <test-file> [test-file ...]");
  process.exit(1);
}

process.env.TEST = "true";
process.env.VITEST = "true";
process.env.NODE_ENV ??= "test";
const vitest = await createVitest({
  run: true,
  watch: false,
  allowOnly: false,
  passWithNoTests: false,
});
try {
  const specifications = (await vitest.globTestSpecifications(files)).filter(
    ({ moduleId }) => files.includes(resolve(moduleId)),
  );
  const selected = new Set(
    specifications.map(({ moduleId }) => resolve(moduleId)),
  );
  const missing = files.filter((file) => !selected.has(file));
  if (missing.length) {
    console.error(`Undiscovered test files:\n${missing.join("\n")}`);
    process.exitCode = 1;
  } else {
    await vitest.standalone();
    await vitest.runTestSpecifications(specifications);
  }
} finally {
  await vitest.close();
}
