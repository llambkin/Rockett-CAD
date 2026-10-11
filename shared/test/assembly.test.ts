import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type AssemblyDocument,
  type Instance,
  validateAssembly,
} from "../src/assembly.js";
import { Placement } from "../src/placement.js";
import { ValidationError } from "../src/schema/validation.js";

const assembly = (): AssemblyDocument => ({
  schemaVersion: 1,
  revision: 3,
  savedWith: null,
  id: "asm-1",
  components: [
    { documentId: "part-a", acknowledgedRevision: 2 },
    { documentId: "part-b", acknowledgedRevision: 0 },
  ],
  instances: [
    {
      id: "i1",
      name: "Base:1",
      documentId: "part-a",
      placement: Placement.identity(),
      grounded: true,
    },
    {
      id: "i2",
      name: "Arm:1",
      documentId: "part-b",
      placement: Placement.fromAxisAngle([0, 0, 1], Math.PI / 3, [5, 0, 0]),
      grounded: false,
    },
  ],
  joints: [],
  extensions: {},
});

const rejection = (value: unknown) => {
  try {
    validateAssembly(value);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error("assembly was accepted");
};

describe("validateAssembly", () => {
  it("accepts a valid two-instance assembly", () => {
    const doc = assembly();
    expect(validateAssembly(structuredClone(doc))).toEqual(doc);
  });

  it("stores instance placements as the KIT placement type", () => {
    expectTypeOf<Instance["placement"]>().toEqualTypeOf<Placement>();
  });

  it("rejects a duplicate instance id with its path", () => {
    const doc = assembly();
    doc.instances[1]!.id = "i1";
    const error = rejection(doc);
    expect(error.detail).toBe("/instances/1/id");
    expect(error.message).toBe(
      "assembly.instances.1.id repeats instance id i1",
    );
  });

  it("rejects a quaternion of norm 1.01 with its path", () => {
    const doc = assembly();
    doc.instances[1]!.placement.rotation = [0, 0, 0, 1.01];
    const error = rejection(doc);
    expect(error.detail).toBe("/instances/1/placement/rotation");
    expect(error.message).toContain("assembly.instances.1.placement.rotation");
  });

  it("rejects a component that references the assembly itself", () => {
    const doc = assembly();
    doc.components[1]!.documentId = "asm-1";
    doc.instances[1]!.documentId = "asm-1";
    const error = rejection(doc);
    expect(error.detail).toBe("/components/1/documentId");
    expect(error.message).toBe(
      "assembly.components.1.documentId references the assembly itself",
    );
  });

  it("rejects an instance without a documentId with its path", () => {
    const doc = assembly();
    const { documentId: _, ...instance } = doc.instances[1]!;
    const error = rejection({
      ...doc,
      instances: [doc.instances[0], instance],
    });
    expect(error.detail).toBe("/instances/1");
    expect(error.message).toContain("documentId");
  });

  it("rejects a component without a documentId with its path", () => {
    const doc = assembly();
    const error = rejection({
      ...doc,
      components: [doc.components[0], { acknowledgedRevision: 0 }],
    });
    expect(error.detail).toBe("/components/1");
    expect(error.message).toContain("documentId");
  });

  it("rejects a component listed twice with its path", () => {
    const doc = assembly();
    doc.components[1]!.documentId = "part-a";
    const error = rejection(doc);
    expect(error.detail).toBe("/components/1/documentId");
  });

  it("rejects an instance naming no listed component with its path", () => {
    const doc = assembly();
    doc.instances[1]!.documentId = "part-c";
    const error = rejection(doc);
    expect(error.detail).toBe("/instances/1/documentId");
  });
});
