import {
  ANGULAR_TOL_DEG,
  LINEAR_TOL,
  UNIT_DOT_TOL,
  type RevolveFeature,
  type Vec3,
} from "@rockett/shared";
import type { EvalState, ToolResult } from "./featureState.js";
import {
  acquire,
  dir,
  getKernel,
  kernelCall,
  planarFacePlane,
  pnt,
  progress,
  scoped,
  type Shape,
} from "./kernel.js";
import { sweptNames } from "./naming.js";
import { sideEdgeNames } from "./sketchGeom.js";
import { V } from "./frames.js";
import { resolveAxis } from "./featureState.js";
import {
  resolveProfiles,
  faceProfile,
  applyProfileTools,
} from "./profileTools.js";

function revolveSources(state: EvalState, f: RevolveFeature) {
  const faceRefs = f.faces ?? [];
  const profiles =
    f.profiles.length > 0 || faceRefs.length === 0
      ? resolveProfiles(state, f.profiles).faces
      : [];
  return [
    ...profiles.map((pf) => ({ pf, copy: false })),
    ...faceRefs.map((ref) => ({ pf: faceProfile(state, ref).pf, copy: true })),
  ];
}

const REVOLVE_CROSSES_AXIS =
  "revolve profile crosses the axis of revolution: keep the profile on one side of the axis; the previous state has been kept";

function crossesAxis(
  face: Shape,
  axis: { origin: Vec3; direction: Vec3 },
): boolean {
  const plane = planarFacePlane(face);
  if (!plane) return false;
  const d = axis.direction;
  const across = V.cross(d, plane.normal);
  if (V.norm(across) < UNIT_DOT_TOL) return false;
  const u = V.normalize(across);
  const w = V.cross(u, d);
  const o = axis.origin;
  const k = getKernel();
  return scoped((own) => {
    const trsf = own(new k.gp_Trsf_1());
    trsf.SetValues(...u, -V.dot(u, o), ...d, -V.dot(d, o), ...w, -V.dot(w, o));
    const box = own(new k.Bnd_Box_1());
    const moved = own(face.Moved(own(new k.TopLoc_Location_4(trsf)), false));
    k.BRepBndLib.AddOptimal(moved, box, false, false);
    const tolerance = Math.max(
      LINEAR_TOL,
      k.BRep_Tool.MaxTolerance(face, k.TopAbs_ShapeEnum.TopAbs_VERTEX),
    );
    return (
      own(box.CornerMin()).X() < -tolerance &&
      own(box.CornerMax()).X() > tolerance
    );
  });
}

export function evalRevolve(state: EvalState, f: RevolveFeature) {
  const sources = revolveSources(state, f);
  const profileFaces = sources.map((s) => s.pf);
  const axis = resolveAxis(state, f.axis);
  if (profileFaces.some((pf) => crossesAxis(pf.face, axis))) {
    throw new Error(REVOLVE_CROSSES_AXIS);
  }
  const k = getKernel();
  const angleRad = (Math.min(Math.abs(f.angle), 360) * Math.PI) / 180;
  const full = Math.abs(f.angle) >= 360 - ANGULAR_TOL_DEG;
  const sign = f.angle >= 0 ? 1 : -1;

  const tools: ToolResult[] = [];
  for (const { pf, copy } of sources) {
    const tool = kernelCall("revolve", () => {
      const ax1 = acquire(
        new k.gp_Ax1_2(
          pnt(...axis.origin),
          dir(
            sign * axis.direction[0],
            sign * axis.direction[1],
            sign * axis.direction[2],
          ),
        ),
      );
      const revol = full
        ? acquire(new k.BRepPrimAPI_MakeRevol_2(pf.face, ax1, copy))
        : acquire(new k.BRepPrimAPI_MakeRevol_1(pf.face, ax1, angleRad, copy));
      revol.Build(progress());
      if (!revol.IsDone()) {
        throw new Error("the kernel could not revolve the profile");
      }
      const shape = acquire(revol.Shape());
      const names = sweptNames(
        shape,
        f.id,
        sideEdgeNames(f.id, pf),
        (e) => revol.Generated(e),
        full
          ? []
          : [acquire(revol.FirstShape_1()), acquire(revol.LastShape_1())],
      );
      return { shape, names };
    });
    tools.push(tool);
  }

  return applyProfileTools(
    state,
    f.id,
    tools,
    profileFaces,
    f.operation,
    f.targets,
  );
}
