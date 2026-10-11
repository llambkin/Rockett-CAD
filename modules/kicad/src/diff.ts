type Footprint = {
  uuid?: string | undefined;
  side?: string | undefined;
  x: number;
  y: number;
  angle: number;
  models: unknown;
};
type Board = {
  thickness: number;
  outline: unknown;
  cutouts: unknown;
  footprints: readonly Footprint[];
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

const keyed = (footprints: readonly Footprint[]) =>
  new Map(
    footprints.flatMap((footprint) =>
      footprint.uuid === undefined ? [] : [[footprint.uuid, footprint]],
    ),
  );

export function diffBoards(old: Board, next: Board) {
  const before = keyed(old.footprints);
  const after = keyed(next.footprints);
  const kept = [...after].flatMap(([uuid, footprint]) => {
    const was = before.get(uuid);
    return was ? [{ uuid, was, footprint }] : [];
  });
  return {
    added: [...after.keys()].filter((uuid) => !before.has(uuid)),
    removed: [...before.keys()].filter((uuid) => !after.has(uuid)),
    moved: kept
      .filter(
        ({ was, footprint }) =>
          !same(
            [was.x, was.y, was.angle, was.side],
            [footprint.x, footprint.y, footprint.angle, footprint.side],
          ),
      )
      .map(({ uuid }) => uuid),
    modelChanged: kept
      .filter(({ was, footprint }) => !same(was.models, footprint.models))
      .map(({ uuid }) => uuid),
    outlineChanged: !same(
      [old.outline, old.cutouts],
      [next.outline, next.cutouts],
    ),
    thicknessChanged: old.thickness !== next.thickness,
  };
}
