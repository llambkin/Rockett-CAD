import type { Feature, NamingVersion } from "./model.js";
import type { ParameterUnit } from "./parameters.js";

export const SCHEMA_VERSION = 47;

export interface UserParameter {
  name: string;
  unit: ParameterUnit;
  expression: string;
  comment: string;
}

export interface ParameterBinding {
  featureId: string;
  path: string;
  expression: string;
}

export interface BodyMeta {
  name: string;
  color?: string;
}

export interface BodyEdit {
  name?: string;
  color?: string | null;
}

export function bodyName(
  doc: Pick<CadDocument, "bodyMeta">,
  bodyId: string,
): string {
  return doc.bodyMeta[bodyId]?.name ?? bodyId;
}

export interface TreeGroup {
  id: string;
  name: string;
  kind: "body" | "sketch";
  members: string[];
}

export interface ExtensionData {
  version: number;
  data: unknown;
}

export interface ModuleAssets {
  namespaces: Record<string, string[]>;
  legacy?: unknown;
}

export interface CadDocument {
  schemaVersion: number;
  namingVersion: NamingVersion;
  revision: number;
  savedWith: { version: string; commit: string | null } | null;
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  modifiedBy: string | null;
  features: Feature[];
  parameters: UserParameter[];
  parameterBindings: ParameterBinding[];
  timelinePosition: number;
  bodyMeta: Record<string, BodyMeta>;
  counters: Record<string, number>;
  groups: TreeGroup[];
  extensions: Record<string, ExtensionData>;
  moduleAssets?: ModuleAssets;
}

export type ParameterEdit = Pick<
  CadDocument,
  "parameters" | "parameterBindings"
>;

export function createEmptyDocument(id: string, name: string): CadDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    namingVersion: 2,
    revision: 0,
    savedWith: null,
    id,
    name,
    createdAt: now,
    modifiedAt: now,
    modifiedBy: null,
    features: [],
    parameters: [],
    parameterBindings: [],
    timelinePosition: 0,
    bodyMeta: {},
    counters: {},
    groups: [],
    extensions: {},
  };
}

export const MANIFEST_VERSION = 3;
export const DOCUMENT_TYPES = ["part", "assembly"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type ProjectMember = { userId: string; role: "view" | "edit" };

export interface ProjectManifest {
  version: typeof MANIFEST_VERSION;
  documents: Array<{ id: string; type: DocumentType }>;
  owner: string | null;
  members: ProjectMember[];
}

export function createManifest(
  partId: string,
  owner: string | null = null,
): ProjectManifest {
  return {
    version: MANIFEST_VERSION,
    documents: [{ id: partId, type: "part" }],
    owner,
    members: [],
  };
}
