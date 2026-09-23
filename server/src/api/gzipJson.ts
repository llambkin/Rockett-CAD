import type { RequestHandler } from "express";
import { gzip } from "node:zlib";

const GZIP_FROM_BYTES = 64 * 1024;

export const gzipJson: RequestHandler = (req, res, next) => {
  res.vary("Accept-Encoding");
  if (req.acceptsEncodings("gzip", "identity") !== "gzip") return next();
  res.json = (body: unknown) => {
    const text = JSON.stringify(body);
    res.type("json");
    if (text.length < GZIP_FROM_BYTES) return res.send(text);
    gzip(text, { level: 1 }, (err, data) => {
      if (err) return res.send(text);
      res.set("Content-Encoding", "gzip").send(data);
    });
    return res;
  };
  next();
};
