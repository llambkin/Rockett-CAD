import { describe, expect, it } from "vitest";
import { ProjectQueue } from "../src/store/projectQueue.js";

describe("project operation queue", () => {
  it("orders one project's operations without blocking another project", async () => {
    const queue = new ProjectQueue();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue.run("a", async () => {
      events.push("first started");
      await gate;
      events.push("first finished");
    });
    const second = queue.run("a", async () => {
      events.push("second");
    });
    await queue.run("b", async () => {
      events.push("other project");
    });
    expect(events).toEqual(["first started", "other project"]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "first started",
      "other project",
      "first finished",
      "second",
    ]);
  });

  it("allows an already queued operation to continue after failure", async () => {
    const queue = new ProjectQueue();
    const failed = queue.run("a", async () => {
      throw new Error("save failed");
    });
    const next = queue.run("a", async () => "saved");
    await expect(failed).rejects.toThrow("save failed");
    await expect(next).resolves.toBe("saved");
  });
});
