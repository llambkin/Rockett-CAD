import type { OpenProject, ProjectView } from "@rockett/plugin-api";
import {
  CAM_EXTENSION,
  migrateCam,
  saveCam,
  type CamData,
  type CamRead,
} from "../shared/document.js";
import {
  stockBox,
  type Box,
  type Setup,
  type Stock,
  type StockSetup,
} from "../shared/setup.js";

type DocSetup = CamData["setups"][number];

export type DialogSetup = Pick<
  Setup,
  "id" | "name" | "safeHeight" | "clearance"
> &
  StockSetup &
  Pick<
    DocSetup,
    "material" | "machine" | "postId" | "post" | "tolerance" | "fixtures"
  >;

export const camRead = ({ document }: OpenProject): CamRead =>
  migrateCam(document?.extensions[CAM_EXTENSION]);

function camData(project: OpenProject): CamData {
  const read = camRead(project);
  if (read.status === "kept") throw new Error(read.reason);
  return read.data;
}

export const bodyBoxes = ({ bodies }: OpenProject): Record<string, Box> =>
  Object.fromEntries(bodies.map(({ id, bbox }) => [id, bbox]));

export const defaultBodies = ({ bodies }: OpenProject) =>
  bodies.filter(({ reference }) => !reference).map(({ id }) => id);

const MARGINS = { xMin: 2, xMax: 2, yMin: 2, yMax: 2, zMin: 2, zMax: 1 };

export function newSetup(
  project: OpenProject,
  defaults: Pick<DialogSetup, "safeHeight" | "clearance" | "tolerance">,
): DialogSetup {
  return {
    id: crypto.randomUUID(),
    name: `Setup ${camData(project).setups.length + 1}`,
    bodies: defaultBodies(project),
    stock: { kind: "boxAround", margins: MARGINS },
    wcs: {
      origin: { kind: "stockCorner", x: "min", y: "min", z: "max" },
      axes: { x: "+x", z: "+z" },
      offsetIndex: 1,
      machine: { kind: "unknown" },
    },
    ...defaults,
  };
}

export function withStockKind(
  setup: DialogSetup,
  kind: Stock["kind"],
  project: OpenProject,
): Stock {
  if (kind === "boxAround") return { kind, margins: MARGINS };
  const box = setup.bodies.length ? stockBox(setup, bodyBoxes(project)) : null;
  const size = (i: 0 | 1 | 2) => (box ? box.max[i] - box.min[i] : 0);
  const [x, y, z] = [size(0), size(1), size(2)];
  return kind === "box"
    ? { kind, size: [x, y, z] }
    : { kind, diameter: Math.max(x, y), height: z };
}

export const editCam = async (
  view: ProjectView,
  edit: (data: CamData) => CamData,
) => view.mutate(saveCam, edit(camData(view.get())));

type Operation = NonNullable<CamData["setups"][number]["operations"]>[number];

export const withOperations = (
  data: CamData,
  setupId: string,
  change: (operations: Operation[]) => Operation[],
): CamData => ({
  ...data,
  setups: data.setups.map((setup) =>
    setup.id === setupId
      ? { ...setup, operations: change(setup.operations ?? []) }
      : setup,
  ),
});

export const saveSetup = (view: ProjectView, setup: DialogSetup) =>
  editCam(view, (data) => ({ ...data, setups: [...data.setups, setup] }));
