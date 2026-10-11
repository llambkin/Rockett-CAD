import {
  ROUTES,
  StoreError,
  TX_HEADER,
  ValidationError,
  type AssemblyDocument,
} from "@rockett/shared";
import type { ApiRoutes } from "../api/projectMutations.js";
import {
  checkRevision,
  reply as sendRevision,
  transactionId,
} from "../api/revision.js";
import type { HistoryStore } from "../store/historyStore.js";
import { newId } from "../store/jsonStore.js";

type Edit = (doc: AssemblyDocument, req: any) => Promise<string>;

async function reply(
  res: any,
  doc: AssemblyDocument,
  history: HistoryStore<AssemblyDocument>,
) {
  sendRevision(res, { document: doc, history: await history.status(doc.id) });
}

function instanceOf(doc: AssemblyDocument, id: string) {
  const found = doc.instances.find((instance) => instance.id === id);
  if (!found) throw new StoreError(`instance ${id} not found`, "not_found");
  return found;
}

function addInstance(store: ApiRoutes["store"]): Edit {
  return async (doc, req) => {
    const { name, documentId, placement, grounded } = req.body.instance;
    const { documents } = await store.manifests.read(req.params.id);
    const listed = documents.find((d) => d.id === documentId);
    if (listed?.type !== "part")
      throw new ValidationError(
        `instance.documentId ${documentId} ${listed ? "is not a part" : "names no document in this project"}`,
        "/instance/documentId",
      );
    const { revision } = await store.loadDocument(req.params.id, documentId);
    if (!doc.components.some((c) => c.documentId === documentId))
      doc.components.push({ documentId, acknowledgedRevision: revision });
    doc.instances.push({ id: newId(), name, documentId, placement, grounded });
    return `Add ${name}`;
  };
}

const updateInstance: Edit = async (doc, req) => {
  const instance = instanceOf(doc, req.params.instance);
  Object.assign(instance, req.body.instance);
  return `Edit ${instance.name}`;
};

const removeInstance: Edit = async (doc, req) => {
  const removed = instanceOf(doc, req.params.instance);
  doc.instances = doc.instances.filter((i) => i !== removed);
  doc.components = doc.components.filter((c) =>
    doc.instances.some((i) => i.documentId === c.documentId),
  );
  return `Remove ${removed.name}`;
};

export function assemblyRoutes(context: ApiRoutes) {
  const { on, wrap, store, assemblies } = context;

  const editable = async (req: any, res: any) => {
    const doc = await assemblies.load(req.params.id, req.params.doc);
    return checkRevision(doc, res.locals.revision);
  };

  const mutate = (edit: Edit) =>
    wrap(async (req, res, ctx) => {
      const tx = transactionId(req.get(TX_HEADER));
      const doc = await editable(req, res);
      const label = await edit(doc, req);
      const history = assemblies.history(req.params.id);
      await history.save(doc, label, tx, ctx.user.id);
      await reply(res, doc, history);
    });

  const step = (way: -1 | 1) =>
    wrap(async (req, res, ctx) => {
      const history = assemblies.history(req.params.id);
      const { document, cursor } = await history.peek(
        await editable(req, res),
        way,
      );
      await history.move(document, cursor, ctx.user.id);
      await reply(res, document, history);
    });

  on(
    ROUTES.createAssembly,
    wrap(async (req, res) => {
      const { id } = req.params;
      await reply(res, await assemblies.create(id), assemblies.history(id));
    }),
  );
  on(
    ROUTES.getAssembly,
    wrap(async (req, res) => {
      const { id, doc } = req.params;
      await reply(res, await assemblies.load(id, doc), assemblies.history(id));
    }),
  );
  on(ROUTES.addInstance, mutate(addInstance(store)));
  on(ROUTES.updateInstance, mutate(updateInstance));
  on(ROUTES.removeInstance, mutate(removeInstance));
  on(ROUTES.undoAssembly, step(-1));
  on(ROUTES.redoAssembly, step(1));
}
