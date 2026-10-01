import { createEmptyDocument, type ShellFeature } from "@rockett/shared";

export const face = (bodyId: string, faceName: string) => ({
  kind: "face" as const,
  bodyId,
  faceName,
});

export const firstShell: ShellFeature = {
  id: "sh1",
  type: "shell",
  name: "Shell1",
  suppressed: false,
  openFaces: [face("b1", "f1")],
  thickness: 1.5,
};

export const edge = (edgeName: string) => ({
  kind: "edge" as const,
  bodyId: "b1",
  edgeName,
});

export const prof = { sketchId: "sk1", profileId: "pr1" };

export const prof2 = { sketchId: "sk1", profileId: "pr2" };

export const base = { name: "", suppressed: false };

export const xy = { kind: "origin" as const, plane: "XY" as const };

export const lineDocument = () => {
  const doc = createEmptyDocument("d1", "Doc");
  doc.features = [
    {
      ...base,
      id: "sk1",
      type: "sketch",
      plane: xy,
      entities: [
        { id: "a", kind: "point", x: 0, y: 0 },
        { id: "b", kind: "point", x: 1, y: 0 },
        { id: "ln1", kind: "line", p1: "a", p2: "b" },
      ],
      constraints: [],
    },
  ];
  return doc;
};
