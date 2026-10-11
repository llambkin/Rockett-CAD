import { defineKernelJobs, type KernelJobScope } from "@rockett/plugin-api";
import type { Xy } from "../shared/ir.js";
import type { Placement } from "../shared/setup.js";
import { read, shapes, toSetup } from "./regions.js";

export type Hole = {
  centre: Xy;
  diameter: number;
  top: number;
  bottom: number;
  blocked: boolean;
};

export type HolesInput = { brep: string; modelToSetup: Placement };

type Piece = { hole: Hole; turn: number };

const LENGTH = 1e-6;
const PARALLEL = 1 - 1e-9;
const FULL = 2 * Math.PI - 1e-6;
const VOLUME = 1e-6;

function piece(scope: KernelJobScope, face: any): Piece | undefined {
  const { oc, own } = scope;
  const surface = own(
    new oc.BRepAdaptor_Surface_2(own(oc.TopoDS.Face_1(face)), true),
  );
  if (surface.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) return;
  const cylinder = own(surface.Cylinder());
  const position = own(cylinder.Position());
  const z = own(own(cylinder.Axis()).Direction()).Z();
  const reversed =
    face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
  if (Math.abs(z) < PARALLEL || reversed !== position.Direct()) return;
  const origin = own(cylinder.Location());
  const ends = [surface.FirstVParameter(), surface.LastVParameter()].map(
    (v: number) => origin.Z() + v * z,
  );
  return {
    hole: {
      centre: [origin.X(), origin.Y()],
      diameter: 2 * cylinder.Radius(),
      top: Math.max(...ends),
      bottom: Math.min(...ends),
      blocked: false,
    },
    turn: surface.LastUParameter() - surface.FirstUParameter(),
  };
}

const near = (a: number, b: number) => Math.abs(a - b) <= LENGTH;

const coaxial = (a: Hole, b: Hole) =>
  near(a.diameter, b.diameter) &&
  Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1]) <= LENGTH;

function merged(pieces: Piece[]): Hole[] {
  const rings: Piece[] = [];
  for (const { hole, turn } of pieces) {
    const same = rings.find(
      (ring) =>
        coaxial(ring.hole, hole) &&
        near(ring.hole.top, hole.top) &&
        near(ring.hole.bottom, hole.bottom),
    );
    if (same) same.turn += turn;
    else rings.push({ hole: { ...hole }, turn });
  }
  const found: Hole[] = [];
  for (const { hole } of rings
    .filter(({ turn }) => turn >= FULL)
    .toSorted((a, b) => b.hole.top - a.hole.top)) {
    const above = found.find(
      (open) => coaxial(open, hole) && near(open.bottom, hole.top),
    );
    if (above) above.bottom = hole.bottom;
    else found.push(hole);
  }
  return found;
}

export function boundsOf({ oc, own }: KernelJobScope, shape: any) {
  const bounds = own(new oc.Bnd_Box_1());
  oc.BRepBndLib.AddOptimal(shape, bounds, false, false);
  return [own(bounds.CornerMin()), own(bounds.CornerMax())];
}

export function zRange(scope: KernelJobScope, shape: any) {
  const [min, max] = boundsOf(scope, shape);
  return [min.Z(), max.Z()] as const;
}

export function solidLeft({ oc, own }: KernelJobScope, made: any) {
  if (!made.IsDone() || made.HasErrors()) return true;
  const props = own(new oc.GProp_GProps_1());
  oc.BRepGProp.VolumeProperties_1(
    own(made.Shape()),
    props,
    false,
    false,
    false,
  );
  return Math.abs(props.Mass()) > VOLUME;
}

function blocked(scope: KernelJobScope, body: any, hole: Hole, top: number) {
  const { oc, own } = scope;
  const frame = own(
    new oc.gp_Ax2_4(
      own(new oc.gp_Pnt_3(...hole.centre, hole.bottom)),
      own(new oc.gp_Dir_5(0, 0, 1)),
    ),
  );
  const column = own(
    own(
      new oc.BRepPrimAPI_MakeCylinder_3(
        frame,
        hole.diameter / 2,
        top - hole.bottom + 1,
      ),
    ).Shape(),
  );
  return solidLeft(
    scope,
    own(
      new oc.BRepAlgoAPI_Common_3(
        body,
        column,
        own(new oc.Message_ProgressRange_1()),
      ),
    ),
  );
}

export function holesOf(scope: KernelJobScope, body: any): Hole[] {
  const [, top] = zRange(scope, body);
  const found = merged(
    [...shapes(scope, body, "TopAbs_FACE")].flatMap(
      (face) => piece(scope, face) ?? [],
    ),
  );
  for (const hole of found) hole.blocked = blocked(scope, body, hole, top);
  return found;
}

export default defineKernelJobs({
  "rockett.cam.holes": (input: HolesInput, scope): Hole[] =>
    holesOf(
      scope,
      toSetup(scope, read(scope, input.brep, "holes"), input.modelToSetup),
    ),
});
