import { beforeAll, expect, it } from "vitest";
import { acquire, explore, initKernel, scoped, type Shape } from "./kernel.js";

let oc: Awaited<ReturnType<typeof initKernel>>;
beforeAll(async () => {
  oc = await initKernel();
});

it("one scope owns duplicate constructor and method acquisitions once", () => {
  let point: Shape;
  let shape: Shape;
  expect(() =>
    scoped((own) => {
      point = own(new oc.gp_Pnt_3(1, 2, 3));
      own(point);
      const builder = own(new oc.BRepPrimAPI_MakeBox_2(2, 3, 4));
      shape = own(builder.Shape());
      own(shape);
      expect(point.X()).toBe(1);
      expect(shape.IsNull()).toBe(false);
    }),
  ).not.toThrow();
  expect(point.isDeleted()).toBe(true);
  expect(shape.isDeleted()).toBe(true);
});

it("a nested kept result transfers to its explicit caller", () => {
  let shape: Shape;
  scoped((own) => {
    shape = own(
      scoped((inner) => {
        const builder = inner(new oc.BRepPrimAPI_MakeBox_2(2, 3, 4));
        return inner.keep(inner(builder.Shape()));
      }),
    );
    expect(shape.IsNull()).toBe(false);
  });
  expect(shape.isDeleted()).toBe(true);
});

it("a failed scope releases kept allocations without replacing the original error", () => {
  let point: Shape;
  const error = new Error("feature failed");
  const cleanup: string[] = [];
  expect(() =>
    scoped((own) => {
      own({
        delete: () => {
          cleanup.push("first");
        },
      });
      own({
        delete: () => {
          cleanup.push("broken");
          throw new Error("cleanup failed");
        },
      });
      point = acquire(new oc.gp_Pnt_3(1, 2, 3));
      own.keep(point);
      throw error;
    }),
  ).toThrow(error);
  expect(point.isDeleted()).toBe(true);
  expect(cleanup).toEqual(["broken", "first"]);
});

it.each(["return", "throw"] as const)(
  "yielded handles survive an early generator %s",
  (end) => {
    let face: Shape;
    scoped((own) => {
      const builder = own(new oc.BRepPrimAPI_MakeBox_2(2, 3, 4));
      const shape = own(builder.Shape());
      const iterator = explore(shape, "face");
      face = iterator.next().value;
      if (end === "return") iterator.return(undefined);
      else expect(() => iterator.throw(new Error("stop"))).toThrow("stop");
      expect(face.IsNull()).toBe(false);
      expect(iterator.next().done).toBe(true);
    });
    expect(face.isDeleted()).toBe(true);
  },
);

it("a cleanup failure releases retained allocations before refusing the result", () => {
  let point: Shape;
  const cleanupError = new Error("cleanup failed");
  expect(() =>
    scoped((own) => {
      point = own(new oc.gp_Pnt_3(1, 2, 3));
      own({
        delete: () => {
          throw cleanupError;
        },
      });
      return own.keep(point);
    }),
  ).toThrow(cleanupError);
  expect(point.isDeleted()).toBe(true);
});

it("a scope releases an acquired free-function curve handle", () => {
  let curve: Shape;
  scoped((own) => {
    const start = own(new oc.gp_Pnt_3(1, 0, 0));
    const middle = own(new oc.gp_Pnt_3(0, 1, 0));
    const end = own(new oc.gp_Pnt_3(-1, 0, 0));
    const arc = own(new oc.GC_MakeArcOfCircle_4(start, middle, end));
    curve = acquire(oc.upcastCurve(own(arc.Value())));
    const raw = curve.get();
    const at = own(raw.Value((raw.FirstParameter() + raw.LastParameter()) / 2));
    expect(at.X()).toBeCloseTo(0, 10);
    expect(at.Y()).toBeCloseTo(1, 10);
    expect(at.Z()).toBe(0);
    expect(curve.isDeleted()).toBe(false);
  });
  expect(curve.isDeleted()).toBe(true);
});
