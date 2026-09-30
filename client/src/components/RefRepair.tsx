import { Fragment, useState, type ReactNode } from "react";
import type {
  BodyPayload,
  CadDocument,
  EdgeRef,
  EvaluateResult,
  FaceRef,
  Feature,
  NamingCandidate,
  NamingDecision,
  NamingMapping,
  NamingTarget,
  NamingUpgradeProposal,
  RefCandidate,
  UnresolvedRef,
} from "@rockett/shared";
import { api } from "../api";
import {
  previewBodies,
  selectionKey,
  useStore,
  type Selection,
} from "../store";
import { dialogTargets } from "../toolTargets";
import { loadPreviewBase } from "../previewBase";
import type { MenuItem } from "./ContextMenu";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";
import { pickLabel, useHoverPick } from "./form/fields";

type Ref = FaceRef | EdgeRef;

const pickOf = (
  kind: Ref["kind"],
  { bodyId, name }: Pick<RefCandidate, "bodyId" | "name">,
): Selection =>
  kind === "face"
    ? { kind, bodyId, faceName: name }
    : { kind, bodyId, edgeName: name };

type Found<C> = {
  status: NamingMapping["status"];
  candidates: C[];
  suggestions: C[];
};

const lone = <C,>({ status, candidates }: Found<C>) =>
  status === "candidate" ? candidates[0] : undefined;

function proposed(problem: UnresolvedRef): Selection | null {
  const to = lone(problem);
  return to ? pickOf(problem.ref.kind, to) : null;
}

function choices<C extends RefCandidate | NamingCandidate, T>(
  { status, candidates, suggestions }: Found<C>,
  as: (c: C) => T,
) {
  if (status === "candidate" || status === "proven") return [];
  return [
    ...candidates.map((c) => ({ pick: as(c), from: `found by ${c.basis}` })),
    ...suggestions.map((c) => ({ pick: as(c), from: "on another body" })),
  ];
}

function describe<C extends RefCandidate | NamingCandidate>(
  head: string,
  found: Found<C>,
  label: (c: C) => string,
): string {
  const to = lone(found);
  if (to) return `${head}: candidate ${label(to)}, found by ${to.basis}`;
  if (found.status === "ambiguous")
    return `${head}: ambiguous, ${found.candidates.length} candidates`;
  return `${head}: ${found.status}`;
}

const note = (problem: UnresolvedRef, label: (pick: Selection) => string) =>
  describe(label(problem.ref), problem, (c) =>
    label(pickOf(problem.ref.kind, c)),
  );

export function refNotes(
  problems: UnresolvedRef[],
  document: CadDocument | null,
  evaluation: EvaluateResult | null,
  bodies: BodyPayload[],
): string[] {
  return problems.map((p) =>
    note(p, (pick) => pickLabel(pick, document, evaluation, bodies)),
  );
}

const sameRef = (item: Record<string, unknown>, ref: Ref) =>
  item.kind === ref.kind &&
  item.bodyId === ref.bodyId &&
  (ref.kind === "face"
    ? item.faceName === ref.faceName
    : item.edgeName === ref.edgeName);

function swapRef(value: unknown, ref: Ref, to: Selection): unknown {
  if (Array.isArray(value)) return value.map((v) => swapRef(v, ref, to));
  if (typeof value !== "object" || value === null) return value;
  const item = value as Record<string, unknown>;
  if (sameRef(item, ref)) return to;
  return Object.fromEntries(
    Object.entries(item).map(([k, v]) => [k, swapRef(v, ref, to)]),
  );
}

async function accept(fid: string, ref: Ref, to: Selection): Promise<void> {
  const s = useStore.getState();
  const feature = s.document?.features.find((f) => f.id === fid);
  if (!feature) return;
  const patch = Object.fromEntries(
    Object.entries(feature).flatMap(([key, value]) => {
      const next = swapRef(value, ref, to);
      return JSON.stringify(next) === JSON.stringify(value)
        ? []
        : [[key, next]];
    }),
  );
  try {
    await s.updateFeature(fid, {
      ...patch,
      ...dialogTargets(),
    } as Partial<Feature>);
  } catch {
    return;
  }
  const current = useStore.getState();
  if (current.mode.name !== "dialog" || current.mode.editFeatureId !== fid)
    return;
  useStore.setState({
    selection: current.selection.map(
      (pick) => swapRef(pick, ref, to) as Selection,
    ),
    dialogParams: swapRef(
      current.dialogParams,
      ref,
      to,
    ) as typeof current.dialogParams,
    hover: null,
  });
  await loadPreviewBase(fid, useStore.getState);
}

export function repick(pick: Selection | null): boolean {
  const s = useStore.getState();
  const ref: Ref | undefined = s.dialogParams.repick;
  const fid = s.mode.name === "dialog" ? s.mode.editFeatureId : undefined;
  if (!ref || !fid) return false;
  if (pick?.kind !== ref.kind) return true;
  s.setDialogParams({ repick: undefined });
  const name = pick.kind === "face" ? pick.faceName : pick.edgeName;
  void accept(fid, ref, pickOf(ref.kind, { bodyId: pick.bodyId, name }));
  return true;
}

function PickButton({ refFor }: { refFor: Ref }) {
  const busy = useStore((s) => s.busy);
  const picking: Ref | undefined = useStore((s) => s.dialogParams.repick);
  const setParams = useStore((s) => s.setDialogParams);
  const on = JSON.stringify(picking) === JSON.stringify(refFor);
  return (
    <button
      className="btn"
      disabled={busy}
      aria-pressed={on}
      onClick={() => setParams({ repick: on ? undefined : refFor })}
    >
      {on ? "Stop" : "Pick"}
    </button>
  );
}

function AcceptButton({
  label,
  onAccept,
}: {
  label: string;
  onAccept: () => void;
}) {
  const busy = useStore((s) => s.busy);
  return (
    <button
      className="btn"
      disabled={busy}
      aria-label={`Accept ${label}`}
      onClick={onAccept}
    >
      Accept
    </button>
  );
}

function RepairRow({
  text,
  pick = null,
  hover,
  children,
}: {
  text: string;
  pick?: Selection | null;
  hover?: (pick: Selection | null) => void;
  children?: ReactNode;
}) {
  return (
    <div
      role="listitem"
      className="measure-row"
      onMouseEnter={hover && (() => hover(pick))}
      onMouseLeave={hover && (() => hover(null))}
    >
      <span>{text}</span>
      {children}
    </div>
  );
}

function RefProblems({ fid }: { fid: string }) {
  const mode = useStore((s) => s.mode);
  const document = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const picking: Ref | undefined = useStore((s) => s.dialogParams.repick);
  const hover = useHoverPick();
  const problems = evaluation?.featureStatuses.find(
    (st) => st.featureId === fid,
  )?.refs;
  if (!problems?.length) return null;
  const bodies = previewBodies({ mode, evaluation });
  const label = (pick: Selection) =>
    pickLabel(pick, document, evaluation, bodies);
  const acceptButton = (ref: Ref, to: Selection) => (
    <AcceptButton
      label={label(to)}
      onAccept={() => void accept(fid, ref, to)}
    />
  );
  return (
    <>
      <div className="sel-info">
        <span>References</span>
        <b>
          {picking
            ? `Pick ${picking.kind === "face" ? "a face" : "an edge"} in the viewport`
            : `${problems.length} to repair`}
        </b>
      </div>
      <div role="list" aria-label="References">
        {problems.map((problem) => {
          const to = proposed(problem);
          const key = JSON.stringify(problem.ref);
          return (
            <Fragment key={key}>
              <RepairRow text={note(problem, label)} pick={to} hover={hover}>
                {to ? (
                  acceptButton(problem.ref, to)
                ) : (
                  <PickButton refFor={problem.ref} />
                )}
              </RepairRow>
              {choices(problem, (c) => pickOf(problem.ref.kind, c)).map(
                ({ pick, from }) => (
                  <RepairRow
                    key={selectionKey(pick)}
                    text={`${label(pick)}, ${from}`}
                    pick={pick}
                    hover={hover}
                  >
                    {acceptButton(problem.ref, pick)}
                  </RepairRow>
                ),
              )}
            </Fragment>
          );
        })}
      </div>
    </>
  );
}

type Report =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; proposal: NamingUpgradeProposal };

const STATUSES = ["proven", "candidate", "ambiguous", "missing"] as const;

const target = ({ bodyId, name }: NamingTarget) =>
  name === undefined ? bodyId : `${name} on ${bodyId}`;

const plain = ({ bodyId, name }: NamingTarget): NamingTarget =>
  name === undefined ? { bodyId } : { bodyId, name };

const counts = (mappings: NamingMapping[]) =>
  STATUSES.map(
    (st) => `${mappings.filter((m) => m.status === st).length} ${st}`,
  ).join(", ");

const unchosen = (m: NamingMapping) =>
  !m.to && (m.status === "candidate" || m.status === "ambiguous");

const decisions = (mappings: NamingMapping[]): NamingDecision[] =>
  mappings.flatMap(({ featureId, path, status, to }) =>
    to && status !== "proven" ? [{ featureId, path, to }] : [],
  );

function mappingNote(m: NamingMapping, where: string): string {
  const head = `${where} ${m.path}, ${target(m.from)}`;
  if (!m.to) return describe(head, m, target);
  if (m.status === "proven") return `${head}: proven ${target(m.to)}`;
  return `${head}: ${m.status}, accepted ${target(m.to)}`;
}

async function applyUpgrade(id: string, chosen: NamingDecision[]) {
  const s = useStore.getState();
  try {
    await s.mutate(() => api.commitNamingUpgrade(id, chosen));
  } catch {
    return;
  }
  s.setMode({ name: "idle" });
}

function MappingRows({
  mappings,
  stage,
}: {
  mappings: NamingMapping[];
  stage: (accept: NamingDecision[]) => void;
}) {
  const features = useStore((s) => s.document?.features);
  const where = (fid: string | null) =>
    fid === null
      ? "Final body"
      : (features?.find((f) => f.id === fid)?.name ?? fid);
  const acceptButton = (m: NamingMapping, to: NamingTarget) => (
    <AcceptButton
      label={target(to)}
      onAccept={() =>
        stage([
          ...decisions(mappings.filter((other) => other !== m)),
          { featureId: m.featureId, path: m.path, to: plain(to) },
        ])
      }
    />
  );
  if (!mappings.length) return <RepairRow text="No references to map" />;
  return mappings.map((m) => {
    const only = m.to ? undefined : lone(m);
    return (
      <Fragment key={`${m.featureId}\n${m.path}`}>
        <RepairRow text={mappingNote(m, where(m.featureId))}>
          {only && acceptButton(m, only)}
        </RepairRow>
        {choices(m, (c) => c).map(({ pick, from }) => (
          <RepairRow key={target(pick)} text={`${target(pick)}, ${from}`}>
            {acceptButton(m, pick)}
          </RepairRow>
        ))}
      </Fragment>
    );
  });
}

function ApplyRows({
  id,
  proposal: { backup, mappings },
}: {
  id: string;
  proposal: NamingUpgradeProposal;
}) {
  const busy = useStore((s) => s.busy);
  const open = mappings.filter(unchosen).length;
  return (
    <>
      <div className="measure-row">
        <span>Backup</span>
        <b>{backup}</b>
      </div>
      <div className="measure-row">
        <span>{open ? `${open} to accept` : "Ready"}</span>
        <button
          className="btn"
          disabled={busy || open > 0}
          onClick={() => void applyUpgrade(id, decisions(mappings))}
        >
          Apply upgrade
        </button>
      </div>
    </>
  );
}

function NamingUpgrade({ id, revision }: { id: string; revision: number }) {
  const busy = useStore((s) => s.busy);
  const [report, setReport] = useState<Report | null>(null);
  const stage = async (chosen: NamingDecision[]) => {
    setReport({ state: "loading" });
    try {
      const proposal = await api.stageNamingUpgrade(id, chosen);
      setReport({ state: "ready", proposal });
    } catch (e) {
      setReport({ state: "failed", message: (e as Error).message });
    }
  };
  const ready =
    report?.state === "ready" && report.proposal.revision === revision
      ? report.proposal
      : null;
  return (
    <>
      <div className="sel-info">
        <span>Naming</span>
        <b>{ready ? counts(ready.mappings) : "version 1"}</b>
      </div>
      {report?.state === "failed" && (
        <div className="error-banner" role="alert">
          Naming report did not load: {report.message}
        </div>
      )}
      {(ready || report?.state === "loading") && (
        <div role="list" aria-label="Naming upgrade">
          {ready ? (
            <MappingRows
              mappings={ready.mappings}
              stage={(a) => void stage(a)}
            />
          ) : (
            <RepairRow text="Checking references" />
          )}
        </div>
      )}
      {ready ? (
        <ApplyRows id={id} proposal={ready} />
      ) : (
        <div className="measure-row">
          <span>Map references to version 2</span>
          <button
            className="btn"
            disabled={busy || report?.state === "loading"}
            onClick={() => void stage([])}
          >
            Upgrade naming
          </button>
        </div>
      )}
    </>
  );
}

export function RefRepair() {
  const fid = useStore((s) =>
    s.mode.name === "dialog" ? s.mode.editFeatureId : undefined,
  );
  const document = useStore((s) => s.document);
  if (!fid || !document) return null;
  return (
    <>
      <RefProblems fid={fid} />
      {document.namingVersion === 1 && (
        <NamingUpgrade id={document.id} revision={document.revision} />
      )}
    </>
  );
}

export function useNamingUpgradePanel() {
  const document = useStore((s) => s.document);
  const [at, setAt] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const version1 = document?.namingVersion === 1 ? document : null;
  const shown = at && at.id === version1?.id ? at : null;
  if (at && !shown) setAt(null);
  return {
    items: (x: number, y: number): MenuItem[] =>
      version1
        ? [
            {
              label: "Upgrade naming…",
              action: () => setAt({ id: version1.id, x, y }),
            },
          ]
        : [],
    panel: shown && version1 && (
      <DraggablePanel title="Upgrade naming" at={shown}>
        <div className="dialog-body">
          <NamingUpgrade id={version1.id} revision={version1.revision} />
        </div>
        <DialogFooter onCancel={() => setAt(null)} />
      </DraggablePanel>
    ),
  };
}
