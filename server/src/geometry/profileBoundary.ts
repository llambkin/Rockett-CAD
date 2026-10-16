import type { OrientedCurve } from "@rockett/shared";

function retraces(a: OrientedCurve, b: OrientedCurve): boolean {
  return (
    a.entityId === b.entityId &&
    a.reversed !== b.reversed &&
    (a.trim === b.trim ||
      (a.trim !== undefined &&
        b.trim !== undefined &&
        a.trim.every((value, i) => value === b.trim![i])))
  );
}

export function profileBoundary(chain: OrientedCurve[]): OrientedCurve[] {
  const boundary: OrientedCurve[] = [];
  for (const curve of chain) {
    if (boundary.length > 0 && retraces(boundary.at(-1)!, curve))
      boundary.pop();
    else boundary.push(curve);
  }
  let start = 0;
  let end = boundary.length;
  while (end - start > 1 && retraces(boundary[start]!, boundary[end - 1]!)) {
    start++;
    end--;
  }
  return boundary.slice(start, end);
}
