import { beforeAll, expect, it } from "vitest";
import { V } from "./frames.js";
import {
  dir,
  faces,
  getKernel,
  initKernel,
  planarFacePlane,
  pnt,
  scoped,
  vec,
} from "./kernel.js";

beforeAll(initKernel, 120_000);

it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
  "plane normals match native derivatives, reflected %s reversed %s",
  (reflected, reversed) => {
    scoped((own) => {
      const k = getKernel();
      const box = own(own(new k.BRepPrimAPI_MakeBox_2(10, 20, 30)).Shape());
      const transform = own(new k.gp_Trsf_1());
      transform.SetMirror_3(
        own(
          new k.gp_Ax2_2(
            own(pnt(0, 0, 0)),
            own(dir(1, 0, 0)),
            own(dir(0, 1, 0)),
          ),
        ),
      );
      const shape = reflected
        ? own(
            own(
              new k.BRepBuilderAPI_Transform_2(box, transform, true, false),
            ).Shape(),
          )
        : box;
      const all = faces(shape).map(own);
      expect(all).toHaveLength(6);
      for (const original of all) {
        const face = own(
          k.TopoDS.Face_1(
            own(
              original.Oriented(
                reversed
                  ? k.TopAbs_Orientation.TopAbs_REVERSED
                  : k.TopAbs_Orientation.TopAbs_FORWARD,
              ),
            ),
          ),
        );
        const surface = own(new k.BRepAdaptor_Surface_2(face, false));
        const du = own(vec(0, 0, 0));
        const dv = own(vec(0, 0, 0));
        surface.D1(0, 0, own(pnt(0, 0, 0)), du, dv);
        const expected = V.scale(
          V.normalize(
            V.cross([du.X(), du.Y(), du.Z()], [dv.X(), dv.Y(), dv.Z()]),
          ),
          reversed ? -1 : 1,
        );
        const position = own(own(surface.Plane()).Position());
        expect(position.Direct()).toBe(!reflected);
        expect(V.dot(planarFacePlane(face)!.normal, expected)).toBeCloseTo(
          1,
          12,
        );
      }
    });
  },
);
