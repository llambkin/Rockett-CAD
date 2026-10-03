import type { Request, Response } from "express";
import type { CadDocument, EvaluateResult } from "@rockett/shared";
import type { ProjectStore } from "../store/projectStore.js";
import type { MeshCache } from "../kernel/meshCache.js";

export function meshRoute(
  store: ProjectStore,
  cache: MeshCache,
  evaluate: (doc: CadDocument) => Promise<EvaluateResult>,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const missing = () => {
      res.status(404).json({ error: "mesh not found", code: "not_found" });
    };
    const hash = req.params.hash;
    const projectId = req.params.id;
    if (
      typeof hash !== "string" ||
      typeof projectId !== "string" ||
      !/^[0-9a-f]{64}$/.test(hash)
    )
      return missing();
    const doc = await store.load(projectId);
    if (cache.rejects(doc.id, doc.revision, hash)) return missing();
    let bytes = cache.get(doc.id, doc.revision, hash);
    if (!bytes) {
      const result = await evaluate(doc);
      cache.publish(doc.id, doc.revision, result.bodies);
      const body = result.bodies.find((item) => item.mesh?.hash === hash);
      if (body)
        bytes =
          cache.get(doc.id, doc.revision, hash) ?? cache.materialize(body);
    }
    if (!bytes) return missing();
    res.set("Cache-Control", "private, max-age=31536000, immutable");
    res.vary("Cookie");
    res.type("application/octet-stream").send(bytes);
  };
}
