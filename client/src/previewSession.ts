import type { StoreApi } from "zustand";
import type { CadDocument, Feature, ParameterBinding } from "@rockett/shared";
import { api, type MutationResponse } from "./api";
import type { Active } from "./commands/active";
import * as previewBase from "./previewBase";
import { selectionBeforeCommand } from "./selection/kinds";
import type { State } from "./store";

export interface PreviewActions {
  updateFeaturePreview: (
    fid: string,
    patch: Partial<Feature>,
    links?: ParameterBinding[],
  ) => Promise<void>;
  previewNewFeature: (feature: Feature) => Promise<void>;
  cancelPreview: () => Promise<void>;
  cancelDialog: () => Promise<void>;
}

type Write = (tx: string) => Promise<MutationResponse>;

interface Session {
  tx: string;
  fid: string;
  fresh: boolean;
  staged: number;
  keys: Set<string>;
  links?: ParameterBinding[];
}

const preview: {
  seq: number;
  pending: { fid: string; patch: Partial<Feature> } | null;
  inFlight: Promise<void> | null;
  session: Session | null;
  error: string | null;
  abandoned: string[];
} = {
  seq: 0,
  pending: null,
  inFlight: null,
  session: null,
  error: null,
  abandoned: [],
};

export function featurePatch(feature: Feature): Partial<Feature> {
  const { id: _id, suppressed: _suppressed, ...patch } = feature as any;
  if (!patch.name) delete patch.name;
  return patch;
}

export function dialogFeatureId(active: Active | null): string | undefined {
  if (active?.id === "design.feature")
    return (
      active.state.editFeatureId ??
      (preview.session?.fresh ? preview.session.fid : undefined)
    );
}

export function previewedFeature(s: {
  active: Active | null;
  document: CadDocument | null;
}): Feature | undefined {
  const id = dialogFeatureId(s.active);
  return s.document?.features.find((f) => f.id === id);
}

function opened(fresh: boolean, fid?: string): Session | null {
  const session = preview.session;
  if (!session || session.fresh !== fresh || (fid && session.fid !== fid))
    return null;
  return session;
}

const covers = (
  session: Session,
  patch: Partial<Feature>,
  links: ParameterBinding[] | undefined,
) =>
  [...session.keys].every((key) => key in patch) && (!session.links || !!links);

function committing(
  id: string,
  session: Session,
  patch: Partial<Feature>,
  plain: Write,
  links: ParameterBinding[] | undefined,
): () => Promise<MutationResponse> {
  let step: "stage" | "commit" | "plain" = "stage";
  return async () => {
    if (session.staged === 0) step = "plain";
    try {
      if (step === "stage") {
        const seq = session.staged + 1;
        await api.updateFeature(
          id,
          session.fid,
          patch,
          undefined,
          session.tx,
          seq,
          links,
        );
        session.staged = seq;
        step = "commit";
      }
      if (step === "commit") return await api.commitPreview(id, session.tx);
    } catch (e: any) {
      if (e?.status !== 404 && e?.status !== 409) throw e;
      step = "plain";
      if (e.status === 409) throw e;
    }
    return plain(session.tx);
  };
}

interface Deps {
  get: () => State;
  set: (patch: Partial<State> | ((s: State) => Partial<State>)) => void;
  inTurn: <T>(write: () => Promise<T>) => Promise<T>;
  lost: (e: unknown) => unknown;
  landed: (m: MutationResponse) => Partial<State>;
}

function end(): Promise<void> | null {
  preview.seq++;
  preview.pending = null;
  return preview.inFlight;
}

async function sendPreviews({ get, set, inTurn, lost }: Deps): Promise<void> {
  while (preview.pending) {
    const { fid, patch } = preview.pending;
    preview.pending = null;
    const seq = preview.seq;
    const { document, recovery } = get();
    const session = preview.session;
    if (!document || recovery || !session) break;
    const sent = session.fresh ? featurePatch(patch as Feature) : patch;
    for (const key of Object.keys(sent)) session.keys.add(key);
    try {
      const m = await inTurn(() =>
        session.fresh && session.staged === 0
          ? api.addFeature(
              document.id,
              { ...patch, id: fid } as Feature,
              session.tx,
              1,
            )
          : api.updateFeature(
              document.id,
              fid,
              sent,
              undefined,
              session.tx,
              session.staged + 1,
              session.links,
            ),
      );
      session.staged++;
      if (seq !== preview.seq) continue;
      const after = await previewBase.bodiesAfter(m.document, fid);
      if (seq !== preview.seq) continue;
      previewBase.landAfter(fid, after);
      set((s) => ({
        document: previewBase.previewCopy(m.document, s.document),
        evaluation: m.evaluation,
        history: m.history ?? s.history,
        error: s.error === preview.error ? null : s.error,
      }));
    } catch (e: any) {
      if (lost(e)) break;
      if (seq === preview.seq) {
        preview.error = e.message;
        set({ error: e.message });
      }
    }
  }
  preview.inFlight = null;
}

function previewActions(deps: Deps): PreviewActions {
  const { get, set, inTurn, lost, landed } = deps;
  return {
    async updateFeaturePreview(fid, patch, links) {
      const { document, evaluation, recovery } = get();
      if (!document || recovery) return;
      previewBase.holdBase(fid, evaluation);
      preview.session ??= opening(fid, false);
      if (links) preview.session.links = links;
      preview.seq++;
      const { targets: _replaced, ...queued }: Record<string, unknown> =
        preview.pending?.fid === fid ? preview.pending.patch : {};
      preview.pending = { fid, patch: { ...queued, ...patch } };
      preview.inFlight ??= sendPreviews(deps);
      return preview.inFlight;
    },

    async previewNewFeature(feature) {
      const document = get().document;
      if (!document) return;
      preview.session ??= opening(feature.id, true);
      return get().updateFeaturePreview(preview.session.fid, feature);
    },

    async cancelPreview() {
      const { document, recovery } = get();
      const settling = end();
      const session = preview.session;
      preview.session = null;
      previewBase.dropBase();
      if (!document || !session || recovery) return;
      const current = () => get().projectId === document.id;
      set({ busy: true });
      try {
        await settling;
        const m =
          session.staged > 0
            ? await inTurn(() => api.abortPreview(document.id, session.tx))
            : null;
        if (current()) set({ ...(m && landed(m)), busy: false });
      } catch (e: any) {
        if (current()) set({ error: lost(e) ? null : e.message, busy: false });
      }
    },

    cancelDialog() {
      const before = selectionBeforeCommand(get());
      const cancelled = get().cancelPreview();
      get().clearActive();
      set({ selection: before });
      return cancelled;
    },
  };
}

function opening(fid: string, fresh: boolean): Session {
  return { tx: crypto.randomUUID(), fid, fresh, staged: 0, keys: new Set() };
}

async function save(
  get: () => State,
  id: string,
  fresh: boolean,
  fid: string | undefined,
  patch: Partial<Feature>,
  plain: Write,
  links?: ParameterBinding[],
): Promise<void> {
  const open = opened(fresh, fid);
  if (open && !covers(open, patch, links)) await get().cancelPreview();
  const session = opened(fresh, fid);
  if (session) preview.session = null;
  try {
    await get().mutate(
      session ? committing(id, session, patch, plain, links) : plain,
    );
  } catch (e) {
    if (!get().recovery) preview.session ??= session;
    else if (session?.staged) preview.abandoned.push(session.tx);
    throw e;
  }
}

function recovering(id: string): () => Promise<void> {
  end();
  preview.session = null;
  return async () => {
    for (const tx of preview.abandoned.splice(0))
      await api.abortPreview(id, tx).catch(() => null);
  };
}

function forget(): void {
  preview.abandoned = [];
}

export function previewSession(
  store: () => StoreApi<State>,
  effects: Pick<Deps, "inTurn" | "lost" | "landed">,
) {
  const get = () => store().getState();
  const deps: Deps = {
    ...effects,
    get,
    set: (patch) => store().setState(patch),
  };
  return {
    actions: previewActions(deps),
    end,
    recovering,
    forget,
    saveNew: (id: string, patch: Partial<Feature>, plain: Write) =>
      save(get, id, true, undefined, patch, plain),
    saveEdit: (
      id: string,
      fid: string,
      patch: Partial<Feature>,
      plain: Write,
      links?: ParameterBinding[],
    ) => save(get, id, false, fid, patch, plain, links),
  };
}
