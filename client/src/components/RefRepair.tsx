import { featureParams, setFeatureParams } from "../commands/featureCommand";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { create } from "zustand";
import type {
  BodyPayload,
  CadDocument,
  EdgeRef,
  EvaluateResult,
  FaceRef,
  NamingCandidate,
  NamingDecision,
  NamingMapping,
  NamingTarget,
  NamingUpgradeProposal,
  RefCandidate,
  UnresolvedRef,
} from "@rockett/shared";
import { api } from "../api";
import { upgradingNaming } from "../browserSession";
import {
  previewBodies,
  selectionKey,
  useStore,
  type Selection,
} from "../store";
import { accept, pickOf } from "../featureReferences";
import type { MenuItem } from "./ContextMenu";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";
import { pickLabel, useHoverPick } from "./form/fields";
import { mappingKey, useNamingCandidates } from "./namingCandidates";

type Ref = FaceRef | EdgeRef;

type Found<C> = {
  status: NamingMapping["status"];
  candidates: C[];
  suggestions: C[];
};

const lone = <C,>({ status, candidates }: Found<C>) =>
  status === "candidate" ? candidates[0] : undefined;

function proposed(problem: UnresolvedRef): Ref | null {
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

function PickToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const busy = useStore((s) => s.busy);
  return (
    <button
      className="btn"
      disabled={busy}
      aria-pressed={on}
      onClick={onToggle}
    >
      {on ? "Stop" : "Pick"}
    </button>
  );
}

function PickButton({ refFor }: { refFor: Ref }) {
  const picking: Ref | undefined = useStore((s) => featureParams(s).repick);
  const on = JSON.stringify(picking) === JSON.stringify(refFor);
  return (
    <PickToggle
      on={on}
      onToggle={() => setFeatureParams({ repick: on ? undefined : refFor })}
    />
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
  const active = useStore((s) => s.active);
  const document = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const picking: Ref | undefined = useStore((s) => featureParams(s).repick);
  const hover = useHoverPick();
  const problems = evaluation?.featureStatuses.find(
    (st) => st.featureId === fid,
  )?.refs;
  if (!problems?.length) return null;
  const bodies = previewBodies({ active, evaluation });
  const label = (pick: Selection) =>
    pickLabel(pick, document, evaluation, bodies);
  const acceptButton = (ref: Ref, to: Ref) => (
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
    await s.mutate(() =>
      upgradingNaming(id, () => api.commitNamingUpgrade(id, chosen)),
    );
  } catch {
    return;
  }
  s.clearActive();
}

function MappingRows({
  mappings,
  stage,
  picking,
  setPicking,
}: {
  mappings: NamingMapping[];
  stage: (accept: NamingDecision[]) => void;
  picking: string | null;
  setPicking: (key: string | null) => void;
}) {
  const features = useStore((s) => s.document?.features);
  const hover = useHoverPick();
  const where = (fid: string | null) =>
    fid === null
      ? "Final body"
      : (features?.find((f) => f.id === fid)?.name ?? fid);
  const choose = (m: NamingMapping, to: NamingTarget) =>
    stage([
      ...decisions(mappings.filter((other) => other !== m)),
      { featureId: m.featureId, path: m.path, to: plain(to) },
    ]);
  const acceptButton = (m: NamingMapping, to: NamingTarget) => (
    <AcceptButton label={target(to)} onAccept={() => choose(m, to)} />
  );
  const { here, shown } = useNamingCandidates(mappings, picking, (m, to) => {
    setPicking(null);
    choose(m, to);
  });
  if (!mappings.length) return <RepairRow text="No references to map" />;
  return mappings.map((m) => {
    const only = m.to ? undefined : lone(m);
    const key = mappingKey(m);
    const pickable = here === null && m.featureId === null && unchosen(m);
    return (
      <Fragment key={key}>
        <RepairRow
          text={mappingNote(m, where(m.featureId))}
          pick={only ? shown(m, only) : null}
          hover={hover}
        >
          {only && acceptButton(m, only)}
          {pickable && (
            <PickToggle
              on={picking === key}
              onToggle={() => {
                if (picking !== key) useStore.getState().setSelection([]);
                setPicking(picking === key ? null : key);
              }}
            />
          )}
        </RepairRow>
        {choices(m, (c) => c).map(({ pick, from }) => (
          <RepairRow
            key={target(pick)}
            text={`${target(pick)}, ${from}`}
            pick={shown(m, pick)}
            hover={hover}
          >
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
  const [picking, setPicking] = useState<string | null>(null);
  const stage = async (chosen: NamingDecision[]) => {
    setPicking(null);
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
  const picked = ready ? picking : null;
  return (
    <>
      <div className="sel-info">
        <span>Naming</span>
        <b>
          {picked
            ? "Pick a candidate in the viewport"
            : ready
              ? counts(ready.mappings)
              : "version 1"}
        </b>
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
              picking={picked}
              setPicking={setPicking}
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

type PanelAt = { id: string; x: number; y: number } | null;

const upgradeAt = create<{ at: PanelAt }>(() => ({ at: null }));

const setAt = (at: PanelAt) => upgradeAt.setState({ at });

export function RefRepair() {
  const fid = useStore((s) =>
    s.active?.id === "design.feature"
      ? s.active.state.editFeatureId
      : undefined,
  );
  const document = useStore((s) => s.document);
  const inPanel = upgradeAt((s) => s.at?.id === document?.id);
  if (!fid || !document) return null;
  return (
    <>
      <RefProblems fid={fid} />
      {document.namingVersion === 1 && !inPanel && (
        <NamingUpgrade id={document.id} revision={document.revision} />
      )}
    </>
  );
}

export function useNamingUpgradePanel() {
  const document = useStore((s) => s.document);
  const at = upgradeAt((s) => s.at);
  const version1 = document?.namingVersion === 1 ? document : null;
  const shown = at && at.id === version1?.id ? at : null;
  useEffect(() => {
    if (at && !shown) setAt(null);
  });
  useEffect(() => () => setAt(null), []);
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
      <DraggablePanel
        id="dialog.namingUpgrade"
        title="Upgrade naming"
        at={shown}
      >
        <div className="dialog-body">
          <NamingUpgrade id={version1.id} revision={version1.revision} />
        </div>
        <DialogFooter onCancel={() => setAt(null)} />
      </DraggablePanel>
    ),
  };
}
