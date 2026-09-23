import { expect, it } from "vitest";
import { versionLabel } from "../src/versionLabel";

const commit = "2267c0d5a1b2c3d4e5f60718293a4b5c6d7e8f90";
const base = { version: "0.1.0", schemaVersion: 4 };

it("shows the git describe output when the build recorded one", () => {
  const label = versionLabel({
    ...base,
    commit,
    describe: "v0.1.0-12-g2267c0d",
  });
  expect(label.text).toBe("v0.1.0-12-g2267c0d");
  expect(label.title).toBe(`Commit ${commit}\nVersion 0.1.0\nSchema 4`);
});

it("falls back to the version and short commit", () => {
  const label = versionLabel({ ...base, commit, describe: null });
  expect(label.text).toBe("v0.1.0 2267c0d");
  expect(label.title).toBe(`Commit ${commit}\nVersion 0.1.0\nSchema 4`);
});

it("marks a build without a commit as dev", () => {
  const label = versionLabel({ ...base, commit: null, describe: null });
  expect(label.text).toBe("v0.1.0 dev");
  expect(label.title).toBe("Commit not recorded\nVersion 0.1.0\nSchema 4");
});
