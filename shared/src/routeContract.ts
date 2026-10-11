import type { Static, TSchema } from "typebox";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

declare const exchange: unique symbol;

export interface Route<
  P extends string = string,
  Req = unknown,
  Res = unknown,
> {
  readonly method: Method;
  readonly path: P;
  readonly body?: TSchema;
  readonly effect?: "document" | "viewer";
  readonly [exchange]?: { request: Req; response: Res };
}

type ParamNames<P extends string> =
  P extends `${string}:${infer Name}/${infer Rest}`
    ? Name | ParamNames<Rest>
    : P extends `${string}:${infer Name}`
      ? Name
      : never;

export type PathParams<P extends string> = Record<ParamNames<P>, string>;

export const DOCUMENT_EDITS = (target: Pick<Route, "effect">): boolean =>
  target.effect === "document";
export const VIEWER_WRITES = (target: Pick<Route, "effect">): boolean =>
  target.effect === "viewer";

export function route<Req, Res>() {
  function define<const P extends string, S extends TSchema>(
    method: Method,
    path: P,
    body: S & (Static<S> extends Req ? unknown : never),
    effect?: Route["effect"],
  ): Omit<Route<P, Req, Res>, "body"> & { readonly body: S };
  function define<const P extends string>(
    method: Method,
    path: P,
    body?: undefined,
    effect?: Route["effect"],
  ): Route<P, Req, Res>;
  function define<const P extends string>(
    method: Method,
    path: P,
    body?: TSchema,
    effect?: Route["effect"],
  ): Route<P, Req, Res> {
    return {
      method,
      path,
      ...(body && { body }),
      ...(effect && { effect }),
    };
  }
  return define;
}

export function pathFor<P extends string>(
  target: Route<P>,
  params: PathParams<P>,
): string {
  const values: Partial<Record<string, string>> = params;
  return target.path.replace(/:(\w+)/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`${target.path} needs :${key}`);
    if (value === "." || value === "..")
      throw new Error(`${target.path} :${key} cannot be ${value}`);
    return encodeURIComponent(value);
  });
}
