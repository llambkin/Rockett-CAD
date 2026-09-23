import { describe, expect, it } from "vitest";
import {
  migrate,
  MissingStepError,
  TooNewError,
  type Migrations,
} from "../src/store/migrations.js";

interface Part {
  version: 3;
  name: string;
  size: { w: number; h: number };
}

const parts: Migrations<Part> = {
  namespace: "part",
  current: 3,
  field: "version",
  steps: {
    1: ({ title, ...rest }) => ({ ...rest, name: title }),
    2: ({ w, h, ...rest }) => ({ ...rest, size: { w, h } }),
  },
};

describe("migrations", () => {
  it("renames and restructures a field over two steps", () => {
    const v1 = { version: 1, title: "Bracket", w: 4, h: 2 };
    expect(migrate(parts, v1)).toEqual({
      version: 3,
      name: "Bracket",
      size: { w: 4, h: 2 },
    });
    expect(v1).toEqual({ version: 1, title: "Bracket", w: 4, h: 2 });
    const v2 = { version: 2, name: "Plate", w: 1, h: 1 };
    expect(migrate(parts, v2).size).toEqual({ w: 1, h: 1 });
  });

  it("returns a current value unchanged", () => {
    const v3 = { version: 3, name: "Done", size: { w: 1, h: 2 } };
    expect(migrate(parts, v3)).toBe(v3);
  });

  it("fails on a missing step with a typed error", () => {
    const gap: Migrations<Part> = { ...parts, steps: { 1: parts.steps[1]! } };
    const error = catchError(() => migrate(gap, { version: 1, title: "x" }));
    expect(error).toBeInstanceOf(MissingStepError);
    expect(error).toMatchObject({ namespace: "part", from: 2, current: 3 });
    expect(() => migrate(parts, { title: "no version" })).toThrow(
      MissingStepError,
    );
  });

  it("fails on a newer version with a typed error", () => {
    const error = catchError(() => migrate(parts, { version: 4 }));
    expect(error).toBeInstanceOf(TooNewError);
    expect(error).toMatchObject({ namespace: "part", version: 4, current: 3 });
  });
});

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (err) {
    return err;
  }
  throw new Error("expected an error");
}
