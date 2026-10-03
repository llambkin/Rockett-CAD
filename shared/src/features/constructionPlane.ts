import { refAt, refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec(
  "constructionPlane",
  "Plane",
  ({ method }) => {
    switch (method.kind) {
      case "offset":
        return [refAt("plane", "/method/base", method.base)];
      case "midplane":
        return [
          refAt("plane", "/method/a", method.a),
          refAt("plane", "/method/b", method.b),
        ];
      case "angle":
        return [
          refAt("axis", "/method/axis", method.axis),
          refAt("plane", "/method/base", method.base),
        ];
      case "threePoints":
        return refsAt("point", "/method/points", method.points);
      case "twoEdges":
        return [
          refAt("axis", "/method/a", method.a),
          refAt("axis", "/method/b", method.b),
        ];
    }
  },
  { producesGeometry: false },
);
