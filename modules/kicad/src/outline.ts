import type {
  DxfSource,
  Route,
  RouteModule,
  ServerContext,
  User,
} from "@rockett/plugin-api";

export const sketchOutlineRoute: Route<
  "/projects/:id/m/rockett/kicad/outline/sketch/:sketchId",
  unknown,
  string
> = {
  method: "GET",
  path: "/projects/:id/m/rockett/kicad/outline/sketch/:sketchId",
};

export const faceOutlineRoute: Route<
  "/projects/:id/m/rockett/kicad/outline/face/:bodyId/:faceName",
  unknown,
  string
> = {
  method: "GET",
  path: "/projects/:id/m/rockett/kicad/outline/face/:bodyId/:faceName",
};

export const outlineModule = (dxf: ServerContext["dxf"]): RouteModule => ({
  id: "rockett.kicad.outline",
  mount(api) {
    const drawn = async (projectId: string, user: User, source: DxfSource) =>
      new TextDecoder().decode(
        await dxf(projectId, user, { ...source, layer: "Edge.Cuts" }),
      );
    api.projectRoute(sketchOutlineRoute, (_doc, { params }, { user }) =>
      drawn(params.id, user, { sketchId: params.sketchId }),
    );
    api.projectRoute(faceOutlineRoute, (_doc, { params }, { user }) => {
      const { id, bodyId, faceName } = params;
      return drawn(id, user, { face: { kind: "face", bodyId, faceName } });
    });
  },
});
