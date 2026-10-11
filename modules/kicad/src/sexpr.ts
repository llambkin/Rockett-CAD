export type Sexpr = string | SexprList;
export type SexprList = Sexpr[];

export const SEXPR_LIMITS = {
  bytes: 64 * 1024 * 1024,
  tokens: 2_000_000,
  depth: 1024,
} as const;

export class SexprError extends Error {
  override name = "SexprError";

  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
    readonly kind: "syntax" | "limit" = "syntax",
  ) {
    super(`${message} at ${line}:${column}`);
  }
}

const SPACE = /[ \t\r\n\0]/;
const SEPARATOR = /[ \t\r\n\0()|]/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

function quotedEnd(text: string, start: number, line: number, column: number) {
  let end = start + 1;
  while (end < text.length) {
    if (text[end] === '"') return end + 1;
    if (text[end] === "\\") end++;
    if (text[end] === "\r" || text[end] === "\n")
      throw new SexprError(
        "Unterminated quoted string",
        line,
        column + end - start,
      );
    end++;
  }
  throw new SexprError("Unterminated quoted string", line, column);
}

export function parseSexpr(text: string): SexprList {
  let bytes = 0;
  if (text.length > SEXPR_LIMITS.bytes)
    throw new SexprError("S-expression input is too large", 1, 1, "limit");
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes > SEXPR_LIMITS.bytes)
      throw new SexprError("S-expression input is too large", 1, 1, "limit");
  }

  let offset = 0;
  let line = 1;
  let column = 1;
  let tokens = 0;
  let lineHasToken = false;
  let root: SexprList | undefined;
  const stack: SexprList[] = [];
  const fail = (message: string, kind: "syntax" | "limit" = "syntax") => {
    throw new SexprError(message, line, column, kind);
  };
  const advance = () => {
    const char = text[offset++]!;
    if (char === "\n" || (char === "\r" && text[offset] !== "\n")) {
      line++;
      column = 1;
      lineHasToken = false;
    } else column++;
  };

  while (offset < text.length) {
    const char = text[offset]!;
    if (SPACE.test(char)) {
      advance();
      continue;
    }
    if (char === "#" && !lineHasToken) {
      while (offset < text.length && !/[\r\n]/.test(text[offset]!)) advance();
      continue;
    }
    if (++tokens > SEXPR_LIMITS.tokens)
      fail("S-expression has too many tokens", "limit");
    lineHasToken = true;
    if (char === ")") {
      if (!stack.length) fail("Unexpected closing parenthesis");
      stack.pop();
      advance();
      continue;
    }
    if (!stack.length && root) fail("Unexpected content after root list");
    if (char === "(") {
      if (stack.length >= SEXPR_LIMITS.depth)
        fail("S-expression nesting is too deep", "limit");
      const list: SexprList = [];
      if (stack.length) stack.at(-1)!.push(list);
      else root = list;
      stack.push(list);
      advance();
      continue;
    }
    if (!stack.length) fail("Expected a root list");
    const start = offset;
    if (char === '"') {
      offset = quotedEnd(text, start, line, column);
      column += offset - start;
    } else if (char === "|") advance();
    else {
      while (offset < text.length && !SEPARATOR.test(text[offset]!)) advance();
    }
    stack.at(-1)!.push(text.slice(start, offset));
  }
  if (stack.length) fail("Unclosed list");
  if (!root) fail("Expected a root list");
  return root!;
}

export function children(
  tree: SexprList | undefined,
  name: string,
): SexprList[] {
  return (
    tree?.filter(
      (entry): entry is SexprList => Array.isArray(entry) && entry[0] === name,
    ) ?? []
  );
}

export function child(
  tree: SexprList | undefined,
  name: string,
): SexprList | undefined {
  return tree?.find(
    (entry): entry is SexprList => Array.isArray(entry) && entry[0] === name,
  );
}

export function num(
  tree: SexprList | undefined,
  index = 1,
): number | undefined {
  const atom = tree?.[index];
  if (typeof atom !== "string" || !NUMBER.test(atom)) return undefined;
  const value = Number(atom);
  return Number.isFinite(value) ? value : undefined;
}

export function str(
  tree: SexprList | undefined,
  index = 1,
): string | undefined {
  const atom = tree?.[index];
  if (typeof atom !== "string") return undefined;
  if (!atom.startsWith('"')) return atom;
  return atom
    .slice(1, -1)
    .replace(
      /(?:\\(?:x[\da-fA-F]{1,2}|[0-7]{1,3}))+|\\(["\\abfnrtv]|x)/g,
      (source: string, escape: string | undefined) => {
        if (escape) return escape === "x" ? "x" : ESCAPES[escape]!;
        const bytes = Uint8Array.from(
          source.matchAll(/\\(x[\da-fA-F]{1,2}|[0-7]{1,3})/g),
          ([, digits = ""]) =>
            digits.startsWith("x")
              ? parseInt(digits.slice(1), 16)
              : parseInt(digits, 8),
        );
        return new TextDecoder().decode(bytes);
      },
    );
}
