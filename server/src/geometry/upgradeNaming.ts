import {
  compareNames,
  featureRefs,
  LINEAR_TOL,
  refName,
  topoRefPaths,
  ValidationError,
  type CadDocument,
  type EdgeRef,
  type FaceRef,
  type Feature,
  type NamingCandidate,
  type NamingDecision,
  type NamingFailure,
  type NamingMapping,
  type NamingTarget,
  type Vec3,
} from "@rockett/shared";
import { dropEngine, engineFor, type DocumentEngine } from "./engine.js";
import type { Sources } from "./importers.js";
import { faces, getKernel, scoped, type Shape } from "./kernel.js";
import { computeEdgeNames, instanceName, type NamedBody } from "./naming.js";
import { pinRefs } from "./pinRefs.js";
import { signatureCandidates } from "./resolve.js";
import { signRefs } from "./signature.js";

type Kind = "body" | "face" | "edge";
type Named = Exclude<Kind, "body">;
type Ref = FaceRef | EdgeRef;
type Found = Omit<NamingMapping, "featureId" | "path" | "from">;
type Decide = (
  featureId: string | null,
  path: string,
  kind: Kind,
  from: NamingTarget,
  found: Found,
) => NamingTarget | undefined;

const SUFFIX = /~\??\d+/g;
const FALLBACK = /:x\d+$/;
const EDGE = /^e\[(.*)\]$/;
const COPY = /^((?:p\d+|m):[^:]+):(.+)$/;
const KEY = /^[0-9a-f]{16}$/;

function split(kind: Kind, name: string): string[] {
  const plain = name.replace(SUFFIX, "");
  if (kind !== "edge") return [plain];
  return EDGE.exec(plain)?.[1]?.split("|") ?? [plain];
}

function copyKey(name: string): string {
  const copy = COPY.exec(name);
  if (!copy || KEY.test(copy[2]!)) return name;
  return instanceName(copy[1]!, copyKey(copy[2]!), 2);
}

function parts(kind: Kind, name: string): string[] {
  const keys = split(kind, name).map(copyKey);
  keys.sort();
  return keys;
}

const keyOf = (kind: Kind, name: string) => parts(kind, name).join("|");

const proof = (kind: Kind, name: string) =>
  split(kind, name).every((part) => part !== "?" && !FALLBACK.test(part));

const pointer = (id: string) => id.replace(/~/g, "~0").replace(/\//g, "~1");

function status(candidates: NamingCandidate[]): Found["status"] {
  if (candidates.length === 0) return "missing";
  return candidates.length === 1 ? "candidate" : "ambiguous";
}

function volumeAndCentre(shape: Shape): { volume: number; centre: Vec3 } {
  const k = getKernel();
  return scoped((own) => {
    const props = own(new k.GProp_GProps_1());
    k.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
    const c = own(props.CentreOfMass());
    return { volume: props.Mass(), centre: [c.X(), c.Y(), c.Z()] };
  });
}

function namesOf(body: NamedBody, kind: Named): string[] {
  return scoped(() => {
    if (kind === "edge") {
      const { byName } = computeEdgeNames(body);
      return [...byName.keys()];
    }
    const shapes = faces(body.shape);

    return shapes.flatMap((face) => body.names.get(face) ?? []);
  });
}

class Cache {
  private readonly names = new Map<
    NamedBody,
    Partial<Record<Named, string[]>>
  >();
  private readonly sizes = new Map<
    NamedBody,
    ReturnType<typeof volumeAndCentre>
  >();

  of(body: NamedBody, kind: Named): string[] {
    const known = this.names.get(body) ?? {};
    known[kind] ??= namesOf(body, kind);
    this.names.set(body, known);
    return known[kind];
  }

  size(body: NamedBody) {
    const known = this.sizes.get(body) ?? volumeAndCentre(body.shape);
    this.sizes.set(body, known);
    return known;
  }
}

class Side {
  private bearers?: Map<string, string[]>;

  constructor(
    readonly bodies: ReadonlyMap<string, NamedBody>,
    readonly cache: Cache,
  ) {}

  names(bodyId: string, kind: Named): string[] {
    const body = this.bodies.get(bodyId);
    return body ? this.cache.of(body, kind) : [];
  }

  keys(bodyId: string): Set<string> {
    return new Set(
      this.names(bodyId, "face")
        .filter((name) => proof("face", name))
        .map((name) => keyOf("face", name)),
    );
  }

  holders(keys: string[]): string[] {
    if (!this.bearers) {
      this.bearers = new Map();
      for (const id of this.bodies.keys())
        for (const key of this.keys(id)) {
          const ids = this.bearers.get(key) ?? [];
          ids.push(id);
          this.bearers.set(key, ids);
        }
    }
    return [...new Set(keys.flatMap((key) => this.bearers!.get(key) ?? []))];
  }

  own(bodyId: string): string[] {
    return [...this.keys(bodyId)].filter(
      (key) => this.holders([key]).length === 1,
    );
  }

  family(bodyId: string): string[] {
    const root = bodyId.replace(/(:\d+)+$/, "");
    return [...this.bodies.keys()].filter(
      (id) => id === root || id.startsWith(`${root}:`),
    );
  }
}

const only = (ids: string[], id: string) => ids.length === 1 && ids[0] === id;

function ranked(before: Side, after: Side, bodyId: string, ids: string[]) {
  const sorted = [...new Set(ids)];
  sorted.sort(compareNames);
  const from = before.bodies.get(bodyId);
  if (!from) return sorted;
  const { volume, centre } = before.cache.size(from);
  const score = new Map(
    sorted.map((id) => {
      const other = after.cache.size(after.bodies.get(id)!);
      return [
        id,
        [
          Math.abs(other.volume - volume) / Math.max(volume, LINEAR_TOL),
          Math.hypot(...other.centre.map((x, i) => x - centre[i]!)),
        ],
      ];
    }),
  );
  sorted.sort((a, b) => {
    const [x, y] = [score.get(a)!, score.get(b)!];
    return x[0]! - y[0]! || x[1]! - y[1]!;
  });
  return sorted;
}

function mapBody(before: Side, after: Side, bodyId: string): Found {
  const hits = after.holders(before.own(bodyId));
  const [hit] = hits;
  if (hit && hits.length === 1 && only(before.holders(after.own(hit)), bodyId))
    return {
      status: "proven",
      to: { bodyId: hit },
      candidates: [],
      suggestions: [],
    };
  if (
    hits.length === 0 &&
    only(before.family(bodyId), bodyId) &&
    only(after.family(bodyId), bodyId)
  )
    return {
      status: "proven",
      to: { bodyId },
      candidates: [],
      suggestions: [],
    };
  const candidates = ranked(before, after, bodyId, [
    ...hits,
    ...after.family(bodyId),
  ]).map((id): NamingCandidate => ({ bodyId: id, basis: "lineage" }));
  return { status: status(candidates), candidates, suggestions: [] };
}

function matching(after: Side, ids: string[], kind: Named, name: string) {
  const key = keyOf(kind, name);
  return ids.flatMap((bodyId) =>
    after
      .names(bodyId, kind)
      .filter((other) => keyOf(kind, other) === key)
      .map((other): NamingCandidate => ({
        bodyId,
        name: other,
        basis: "lineage",
      })),
  );
}

function suggestions(after: Side, kind: Named, name: string, within: string[]) {
  if (!proof(kind, name)) return [];
  const sides = parts(kind, name).filter((part) => part !== "seam");
  const others = after
    .holders(sides)
    .filter((id) => !within.includes(id))
    .filter((id) => sides.every((side) => after.keys(id).has(side)));
  others.sort(compareNames);
  return matching(after, others, kind, name);
}

function mapRef(before: Side, after: Side, ref: Ref): Found {
  const { kind } = ref;
  const name = refName(ref);
  const body = mapBody(before, after, ref.bodyId);
  const within = body.to
    ? [body.to.bodyId]
    : body.candidates.map((c) => c.bodyId);
  const lineal = proof(kind, name) ? matching(after, within, kind, name) : [];
  const [hit] = lineal;
  const onBefore = matching(before, [ref.bodyId], kind, name);
  if (
    body.to &&
    hit &&
    lineal.length === 1 &&
    onBefore.length === 1 &&
    onBefore[0]!.name === name
  )
    return {
      status: "proven",
      to: { bodyId: hit.bodyId, name: hit.name! },
      candidates: [],
      suggestions: [],
    };
  const same = after.names(ref.bodyId, kind).includes(name)
    ? [{ bodyId: ref.bodyId, name, basis: "lineage" as const }]
    : [];
  const candidates = lineal.length
    ? lineal
    : same.length
      ? same
      : signatureCandidates(after.bodies, within, ref);
  return {
    status: status(candidates),
    candidates,
    suggestions: candidates.length
      ? []
      : suggestions(after, kind, name, within),
  };
}

function translate(
  feature: Feature,
  before: Side,
  after: Side,
  decide: Decide,
) {
  for (const ref of featureRefs(feature)) {
    if (ref.kind !== "body") continue;
    const to = decide(
      feature.id,
      ref.path,
      "body",
      { bodyId: ref.body },
      mapBody(before, after, ref.body),
    );
    if (!to) continue;
    const keys = ref.path.slice(1).split("/");
    let target = feature as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1))
      target = target[key] as Record<string, unknown>;
    target[keys.at(-1)!] = to.bodyId;
  }
  const moved: Ref[] = [];
  for (const [path, ref] of topoRefPaths(feature)) {
    const from = { bodyId: ref.bodyId, name: refName(ref) };
    const to = decide(
      feature.id,
      path,
      ref.kind,
      from,
      mapRef(before, after, ref),
    );
    if (!to?.name) continue;
    ref.bodyId = to.bodyId;
    if (ref.kind === "face") ref.faceName = to.name;
    else ref.edgeName = to.name;
    delete ref.sig;
    moved.push(ref);
  }
  signRefs(after.bodies, moved);
}

function moveBodies(
  doc: CadDocument,
  before: Side,
  after: Side,
  decide: Decide,
) {
  const moved = new Map<string, string>();
  for (const bodyId of before.bodies.keys()) {
    const path = `/bodyMeta/${pointer(bodyId)}`;
    const to = decide(
      null,
      path,
      "body",
      { bodyId },
      mapBody(before, after, bodyId),
    );
    if (to) moved.set(bodyId, to.bodyId);
  }
  const meta = Object.entries(doc.bodyMeta).filter(
    ([id]) => !moved.has(id) && !after.bodies.has(id),
  );
  for (const [from, to] of moved) {
    const kept = doc.bodyMeta[from];
    if (kept) meta.push([to, kept]);
  }
  doc.bodyMeta = Object.fromEntries(meta);
  for (const group of doc.groups)
    if (group.kind === "body")
      group.members = [
        ...new Set(group.members.map((id) => moved.get(id) ?? id)),
      ];
}

function decider(accept: NamingDecision[], mappings: NamingMapping[]) {
  const decisions = new Map(
    accept.map((d, index) => [`${d.featureId}\n${d.path}`, { ...d, index }]),
  );
  const decide =
    (after: Side): Decide =>
    (featureId, path, kind, from, found) => {
      const key = `${featureId}\n${path}`;
      const decision = decisions.get(key);
      decisions.delete(key);
      if (decision) check(after, kind, decision);
      const to = decision?.to ?? found.to;
      mappings.push({ featureId, path, from, ...found, ...(to && { to }) });
      return to;
    };
  const unused = () => {
    const [left] = decisions.values();
    if (left)
      throw new ValidationError(
        `accepted mapping for ${left.path} matches no reference`,
        `/accept/${left.index}`,
      );
  };
  return { decide, unused };
}

function check(
  after: Side,
  kind: Kind,
  { to, index }: NamingDecision & { index: number },
) {
  const found =
    after.bodies.has(to.bodyId) &&
    (kind === "body"
      ? to.name === undefined
      : to.name !== undefined &&
        after.names(to.bodyId, kind).includes(to.name));
  if (!found)
    throw new ValidationError(
      `accepted ${kind} ${to.name ?? to.bodyId} is not in the upgraded model`,
      `/accept/${index}`,
    );
}

function failures(
  engine: DocumentEngine,
  doc: CadDocument,
  sources: Sources,
): NamingFailure[] {
  const { namingVersion } = doc;
  return engine
    .evaluate(doc, doc.features.length, sources)
    .featureStatuses.flatMap(({ featureId, status: state, error, refs }) =>
      state === "error" && error !== undefined
        ? [{ featureId, namingVersion, error, ...(refs && { refs }) }]
        : [],
    );
}

export function planNamingUpgrade(
  doc: CadDocument,
  sources: Sources,
  accept: NamingDecision[] = [],
): {
  document: CadDocument;
  mappings: NamingMapping[];
  failures: NamingFailure[];
} {
  getKernel();
  const scratch = `${doc.id}~naming`;
  const old = engineFor(doc.id);
  const fresh = engineFor(scratch);
  const cache = new Cache();
  const mappings: NamingMapping[] = [];
  const { decide, unused } = decider(accept, mappings);
  try {
    const document = pinRefs(doc, old, sources);
    document.namingVersion = 2;
    const sides = (position?: number) =>
      [
        new Side(old.stateAt(doc, position, sources).bodies, cache),
        new Side(fresh.stateAt(document, position, sources).bodies, cache),
      ] as const;
    document.features.forEach((feature, index) => {
      const [before, after] = sides(index);
      translate(feature, before, after, decide(after));
    });
    const [before, after] = sides();
    moveBodies(document, before, after, decide(after));
    unused();
    return {
      document,
      mappings,
      failures: [
        ...failures(old, doc, sources),
        ...failures(fresh, document, sources),
      ],
    };
  } finally {
    dropEngine(scratch);
  }
}
