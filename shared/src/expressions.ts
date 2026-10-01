import { ANGLE_TO_DEGREES, UNIT_TO_MM, type Units } from "./units.js";

export type ScalarDimension = "unitless" | "length" | "angle";
export interface Scalar {
  value: number;
  dimension: ScalarDimension;
}
export type ExpressionInputs = Readonly<Record<string, Readonly<Scalar>>>;
export type ExpressionErrorCode =
  "name" | "syntax" | "dimension" | "arithmetic" | "limit";

export class ExpressionError extends Error {
  constructor(
    public readonly code: ExpressionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExpressionError";
  }
}

const MAX_BYTES = 65536;
const MAX_TOKENS = 8192;
const MAX_DEPTH = 128;
const NUMBER = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const NAME = /[A-Za-z_][A-Za-z_0-9]*/y;
const PRECEDENCE: Readonly<Record<string, number>> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
  "%": 2,
  "^": 4,
};

function fail(code: ExpressionErrorCode, message: string): never {
  throw new ExpressionError(code, message);
}

function scalar(
  value: number,
  dimension: ScalarDimension = "unitless",
): Scalar {
  if (!Number.isFinite(value))
    fail("arithmetic", "Expression must have a finite result");
  return { value: value + 0, dimension };
}

function sameDimension(a: Scalar, b: Scalar): void {
  if (a.dimension !== b.dimension)
    fail("dimension", "Expression dimensions do not match");
}

function binary(operator: string, a: Scalar, b: Scalar): Scalar {
  if (operator === "+" || operator === "-" || operator === "%") {
    sameDimension(a, b);
    if (operator === "%" && b.value === 0)
      fail("arithmetic", "Division by zero");
    return scalar(
      operator === "+"
        ? a.value + b.value
        : operator === "-"
          ? a.value - b.value
          : a.value % b.value,
      a.dimension,
    );
  }
  if (operator === "*") {
    if (a.dimension !== "unitless" && b.dimension !== "unitless")
      fail("dimension", "Multiplication requires a unitless operand");
    return scalar(
      a.value * b.value,
      a.dimension === "unitless" ? b.dimension : a.dimension,
    );
  }
  if (operator === "/") {
    if (b.value === 0) fail("arithmetic", "Division by zero");
    if (b.dimension === "unitless")
      return scalar(a.value / b.value, a.dimension);
    sameDimension(a, b);
    return scalar(a.value / b.value);
  }
  if (
    b.dimension !== "unitless" ||
    (a.dimension !== "unitless" && b.value !== 0 && b.value !== 1)
  )
    fail(
      "dimension",
      "Power requires unitless values or a dimension-preserving exponent",
    );
  return scalar(a.value ** b.value, b.value === 0 ? "unitless" : a.dimension);
}

const unary: Readonly<Record<string, (x: number) => number>> = {
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};
const trig: Readonly<Record<string, (x: number) => number>> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
};
const inverse: Readonly<Record<string, (x: number) => number>> = {
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
};

function call(name: string, args: Scalar[]): Scalar {
  const known =
    Object.hasOwn(unary, name) ||
    Object.hasOwn(trig, name) ||
    Object.hasOwn(inverse, name) ||
    ["min", "max", "sqrt", "pow", "atan2"].includes(name);
  if (!known) fail("name", `Unknown function: ${name}`);
  const count = name === "pow" || name === "atan2" ? 2 : 1;
  if (
    args.length < count ||
    (name !== "min" && name !== "max" && args.length !== count)
  )
    fail("syntax", `Wrong number of arguments for ${name}`);
  const a = args[0]!;
  const b = args[1]!;
  if (name === "min" || name === "max") {
    let value = a.value;
    for (const argument of args) {
      sameDimension(a, argument);
      value =
        name === "min"
          ? Math.min(value, argument.value)
          : Math.max(value, argument.value);
    }
    return scalar(value, a.dimension);
  }
  if (Object.hasOwn(unary, name))
    return scalar(unary[name]!(a.value), a.dimension);
  if (Object.hasOwn(trig, name)) {
    if (a.dimension === "length")
      fail("dimension", `${name} requires an angle or unitless radians`);
    return scalar(
      trig[name]!(
        a.dimension === "angle" ? (a.value * Math.PI) / 180 : a.value,
      ),
    );
  }
  if (name === "pow") return binary("^", a, b);
  if (name === "atan2") {
    sameDimension(a, b);
    return scalar((Math.atan2(a.value, b.value) * 180) / Math.PI, "angle");
  }
  if (a.dimension !== "unitless")
    fail("dimension", `${name} requires a unitless value`);
  if (name === "sqrt") return scalar(Math.sqrt(a.value));
  return scalar((inverse[name]!(a.value) * 180) / Math.PI, "angle");
}

class Parser {
  private offset = 0;
  private tokens = 0;
  private token = "";
  private number = false;

  constructor(
    private readonly text: string,
    private readonly inputs: ExpressionInputs,
  ) {
    this.next();
  }

  parse(): Scalar {
    const result = this.expression(0, 0);
    if (this.token !== "") fail("syntax", "Unexpected text after expression");
    return result;
  }

  private next(): void {
    while (
      /\s/.test(this.text[this.offset] ?? "") &&
      this.offset < this.text.length
    )
      this.offset++;
    if (this.offset === this.text.length) {
      this.token = "";
      return;
    }
    if (++this.tokens > MAX_TOKENS)
      fail("limit", "Expression has too many tokens");
    NUMBER.lastIndex = NAME.lastIndex = this.offset;
    const numeric = NUMBER.exec(this.text);
    const match = numeric ?? NAME.exec(this.text);
    this.number = numeric !== null;
    this.token = match?.[0] ?? this.text[this.offset]!;
    this.offset += this.token.length;
    if (!match && !"+-*/%^(),°".includes(this.token))
      fail("syntax", "Invalid expression character");
  }

  private expression(minimum: number, depth: number): Scalar {
    if (depth > MAX_DEPTH) fail("limit", "Expression nesting is too deep");
    let result = this.primary(depth);
    while (
      Object.hasOwn(PRECEDENCE, this.token) &&
      PRECEDENCE[this.token]! >= minimum
    ) {
      const operator = this.token;
      const precedence = PRECEDENCE[operator]!;
      this.next();
      result = binary(
        operator,
        result,
        this.expression(precedence + (operator === "^" ? 0 : 1), depth + 1),
      );
    }
    return result;
  }

  private primary(depth: number): Scalar {
    const token = this.token;
    if (token === "+" || token === "-") {
      this.next();
      const result = this.expression(3, depth + 1);
      return scalar(
        token === "-" ? -result.value : result.value,
        result.dimension,
      );
    }
    if (token === "(") {
      this.next();
      const result = this.expression(0, depth + 1);
      this.consume(")");
      return result;
    }
    if (this.number) {
      const value = Number(token);
      this.next();
      const unit = this.token.toLowerCase();
      if (Object.hasOwn(UNIT_TO_MM, unit)) {
        this.next();
        return scalar(value * UNIT_TO_MM[unit as Units], "length");
      }
      if (Object.hasOwn(ANGLE_TO_DEGREES, unit)) {
        this.next();
        return scalar(
          value * ANGLE_TO_DEGREES[unit as keyof typeof ANGLE_TO_DEGREES],
          "angle",
        );
      }
      return scalar(value);
    }
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(token))
      fail("syntax", "Expected a number, name or bracket");
    this.next();
    if (this.token === "(") {
      this.next();
      const args: Scalar[] = [];
      if (!this.isToken(")")) {
        args.push(this.expression(0, depth + 1));
        while (this.isToken(",")) {
          this.next();
          args.push(this.expression(0, depth + 1));
        }
      }
      this.consume(")");
      return call(token, args);
    }
    if (Object.hasOwn(this.inputs, token)) {
      const input = this.inputs[token]!;
      if (!["unitless", "length", "angle"].includes(input.dimension))
        fail("dimension", "Unknown input dimension");
      return scalar(input.value, input.dimension);
    }
    if (token === "pi") return scalar(Math.PI);
    if (token === "e") return scalar(Math.E);
    return fail("name", `Unknown name: ${token}`);
  }

  private isToken(token: string): boolean {
    return this.token === token;
  }

  private consume(token: string): void {
    if (this.token !== token) fail("syntax", `Expected ${token}`);
    this.next();
  }
}

export function evaluateExpression(
  text: string,
  inputs: ExpressionInputs = {},
): Scalar {
  if (
    text.length > MAX_BYTES ||
    new TextEncoder().encode(text).length > MAX_BYTES
  )
    fail("limit", "Expression is too long");
  return new Parser(text, inputs).parse();
}
