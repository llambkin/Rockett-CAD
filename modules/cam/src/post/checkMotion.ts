import { endOf, type Xyz } from "../shared/ir.js";
import { checkTravel, type Box, type Travel } from "../shared/setup.js";
import type { Tool } from "../shared/tools.js";
import type { CheckInput, Report } from "./check.js";
import {
  exempt,
  fixturesMet,
  hits,
  keepOut,
  reachOf,
  spans,
  type Span,
} from "./checkSweep.js";

export type Context = CheckInput & {
  safe: number;
  report: Report;
};

type Axis = "x" | "y" | "z";

const XYZ = ["x", "y", "z"] as const;

function entryProblems(span: Span, tool: Tool | undefined, ctx: Context) {
  const { s, m, move, first } = span;
  if (first && (move.kind !== "rapid" || move.to[2] < ctx.safe))
    ctx.report(
      "entry",
      `a tool must start with a rapid at or above Z ${ctx.safe}`,
      s,
      m,
    );
  const top = ctx.stock.max[2];
  const plunges = span.segments.some(
    ({ from, to, rapid }) => !rapid && to[2] < from[2] && to[2] < top,
  );
  if (tool && !tool.centreCutting && plunges)
    ctx.report(
      "entry",
      `tool ${tool.id} is not centre cutting and plunges`,
      s,
      m,
    );
}

function stockProblems({ s, m, segments }: Span, reach: number, ctx: Context) {
  const region = keepOut(ctx.stock, ctx.setup.clearance, reach);
  const deepest = new Map<string, number>();
  const through = segments.some((segment) => {
    const { to, rapid, from } = segment;
    if (!rapid && from[0] === to[0] && from[1] === to[1]) {
      const key = `${to[0]},${to[1]}`;
      deepest.set(key, Math.min(deepest.get(key) ?? Infinity, to[2]));
    }
    return rapid && !exempt(segment, deepest) && hits(segment, region);
  });
  if (through)
    ctx.report(
      "stock",
      "a rapid passes through the stock or its clearance",
      s,
      m,
    );
}

function fixtureProblems(
  { s, m, segments }: Span,
  reach: number,
  ctx: Context,
) {
  const g = ctx.setup.clearance;
  for (const fixture of fixturesMet(segments, ctx.setup.fixtures, g, reach))
    ctx.report(
      "fixture",
      `the tool comes within ${g} mm of ${fixture.name}`,
      s,
      m,
    );
}

function safeProblems({ setup, safe, report }: Context) {
  for (const { name, max } of setup.fixtures)
    if (safe < max[2] + setup.clearance)
      report(
        "fixture",
        `safe Z ${safe} is below the ${name} top plus ${setup.clearance} mm, so the first rapid after a tool change can hit it`,
      );
}

function travelAxes(span: Span, ctx: Context): Axis[] {
  const { machine: k } = ctx;
  const limits: Box = {
    min: [k.xMin, k.yMin, k.zMin],
    max: [k.xMax, k.yMax, k.zMax],
  };
  const axes = new Set<Axis>();
  for (const { from, to, grow } of span.segments) {
    const min = [0, 1, 2].map((i) => Math.min(from[i]!, to[i]!) - grow) as Xyz;
    const max = [0, 1, 2].map((i) => Math.max(from[i]!, to[i]!) + grow) as Xyz;
    const travel = checkTravel(ctx.setup.wcs, { min, max }, limits);
    if (travel.status === "outside") travel.axes.forEach((a) => axes.add(a));
  }
  return XYZ.filter((a) => axes.has(a));
}

function retractProblems({ program, safe, report }: Context) {
  let end: { s: number; m: number; at: Xyz } | undefined;
  const changeTool = () => {
    if (end && end.at[2] < safe)
      report(
        "retract",
        `the section ends at Z ${end.at[2]}, below safe Z ${safe}`,
        end.s,
        end.m,
      );
    end = undefined;
  };
  for (const [s, section] of program.sections.entries()) {
    if (program.sections[s - 1]?.toolId !== section.toolId) changeTool();
    let at = end?.at;
    for (const [m, move] of section.moves.entries()) {
      const next = endOf(move, at);
      if (next && next !== at) end = { s, m, at: next };
      at = next;
    }
  }
  changeTool();
}

export function motionProblems(ctx: Context, travelKnown: boolean): Travel {
  const { program } = ctx;
  const tools = new Map(program.tools.map((tool) => [tool.id, tool]));
  const outside = new Set<Axis>();
  for (const span of spans(program)) {
    const tool = tools.get(program.sections[span.s]!.toolId);
    entryProblems(span, tool, ctx);
    const reach = reachOf(tool);
    stockProblems(span, reach, ctx);
    fixtureProblems(span, reach, ctx);
    const axes = travelKnown ? travelAxes(span, ctx) : [];
    axes.forEach((a) => outside.add(a));
    if (axes.length)
      ctx.report(
        "travel",
        `the move leaves machine travel in ${axes.join(" ")}`,
        span.s,
        span.m,
      );
  }
  retractProblems(ctx);
  safeProblems(ctx);
  if (!travelKnown) return { status: "unverified" };
  const axes = XYZ.filter((a) => outside.has(a));
  return axes.length ? { status: "outside", axes } : { status: "within" };
}
