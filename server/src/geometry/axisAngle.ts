import type { Vec3 } from "@rockett/shared";
import { V } from "./frames.js";
import type { Own } from "./kernel.js";

const vec = (d: any): Vec3 => [d.X(), d.Y(), d.Z()];

export function axisAngle(position: any, range: [number, number], own: Own) {
  const centre = vec(own(position.Location())),
    x = vec(own(position.XDirection())),
    y = vec(own(position.YDirection())),
    middle = (range[0] + range[1]) / 2;
  return (point: Vec3) => {
    const d = V.sub(point, centre),
      angle = Math.atan2(V.dot(d, y), V.dot(d, x));
    return angle + 2 * Math.PI * Math.round((middle - angle) / (2 * Math.PI));
  };
}
