type Send = (url: string, init?: RequestInit) => Promise<Response>;

export function trackRevisions(send: Send): Send {
  const revisions = new Map<string, number>();
  return async (url, init = {}) => {
    const id = /\/projects\/([a-z0-9-]+)/.exec(url)?.[1];
    const known =
      id === undefined || (init.method ?? "GET") === "GET"
        ? undefined
        : revisions.get(id);
    const headers = new Headers(init.headers);
    if (known !== undefined && !headers.has("If-Match"))
      headers.set("If-Match", `"${known}"`);
    const res = await send(url, { ...init, headers });
    if (res.headers.get("content-type")?.includes("json")) {
      const body = await res
        .clone()
        .json()
        .catch(() => null);
      const doc = body?.document;
      if (typeof doc?.id === "string" && typeof doc.revision === "number")
        revisions.set(
          doc.id,
          Math.max(doc.revision, revisions.get(doc.id) ?? 0),
        );
    }
    return res;
  };
}
