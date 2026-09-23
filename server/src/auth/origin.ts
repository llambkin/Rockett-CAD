import type { RequestHandler } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function parseAllowedOrigins(value: string | undefined): string[] {
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error(
      "ROCKETT_ALLOWED_ORIGINS is not set; list the browser origins, such as https://cad.example.com",
    );
  }
  return entries.map((entry) => {
    const url = URL.parse(entry);
    if (!url || entry.includes("*") || url.href !== `${url.origin}/`) {
      throw new Error(
        `ROCKETT_ALLOWED_ORIGINS entry "${entry}" is not a bare origin such as https://cad.example.com`,
      );
    }
    return url.origin;
  });
}

export function requireAllowedOrigin(
  allowedOrigins: readonly string[],
): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin !== undefined && allowed.has(origin)) return next();
    res.status(403).json({ error: "Origin not allowed" });
  };
}
