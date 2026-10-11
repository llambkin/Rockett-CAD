import {
  ROUTES,
  ValidationError,
  type CadDocument,
  type User,
} from "@rockett/shared";
import { validateFeature } from "./validate.js";
import { discarding, receiveImport, type Upload } from "./uploads.js";
import { importers, withinImportBudget } from "./importers.js";
import type { ApiRoutes } from "./projectMutations.js";
function importHandlers(context: ApiRoutes) {
  const { store, kernel, uploadBytes, importBytes, evaluate } = context;
  const receive = receiveImport(store.uploads, uploadBytes, importers.list());
  type Received = Awaited<ReturnType<typeof received>>;
  async function received(req: any) {
    const file: Upload | undefined = req.file;
    if (file) withinImportBudget(file, importBytes);
    const imported = await kernel.importStep(
      file && {
        name: file.originalname,
        bytes: () => store.uploads.read(file),
      },
    );
    imported.features.forEach(validateFeature);
    return { ...imported, file: file! };
  }
  async function insert(doc: CadDocument, upload: Received) {
    const { file, label, features, sources } = upload;
    try {
      const at = Math.min(doc.timelinePosition, doc.features.length);
      doc.features.splice(at, 0, ...features);
      doc.timelinePosition = at + features.length;
      const evaluation = await evaluate(doc, undefined, sources);
      for (const feature of features) {
        const status = evaluation.featureStatuses.find(
          (s) => s.featureId === feature.id,
        );
        if (status?.status !== "ok" && status?.status !== "warning")
          throw new ValidationError(status?.error ?? `${label} import failed`);
      }
      for (const [hash, bytes] of sources)
        await (hash === file.hash
          ? store.blobs(doc.id).adopt(file)
          : store.blobs(doc.id).put(bytes));
      return { label: `Import ${upload.filename}` };
    } catch (error) {
      kernel.drop(doc.id);
      throw error;
    }
  }
  return { receive, received, insert };
}

export function importRoutes(context: ApiRoutes) {
  const {
    on,
    wrap,
    store,
    kernel,
    evaluateAndSync,
    send,
    jobs,
    mutateProject,
  } = context;
  const { receive, received, insert } = importHandlers(context);
  on(
    ROUTES.importProject,
    receive,
    wrap(
      discarding<{ user: User }>(store.uploads, async (req, res, ctx) => {
        const upload = await received(req);
        const doc = await store.create(
          upload.filename.replace(/\.[^.]*$/, ""),
          ctx.user.id,
        );
        jobs.bindProject(doc.id);
        try {
          await insert(doc, upload);
          const evaluation = await evaluateAndSync(doc);
          await store.save(doc, ctx.user.id);
          await send(res, doc, evaluation);
        } catch (error) {
          kernel.drop(doc.id);
          await store.remove(doc.id);
          jobs.bindProject(null);
          throw error;
        }
      }),
    ),
  );
  on(
    ROUTES.importInto,
    receive,
    mutateProject(async (doc, req) => insert(doc, await received(req))),
  );
}
