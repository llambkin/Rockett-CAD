import { LINEAR_TOL } from "./tolerance.js";

export type Units = "mm" | "cm" | "m" | "in";

export const UNIT_TO_MM: Record<Units, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

export function toMm(value: number, units: Units): number {
  return value * UNIT_TO_MM[units];
}

export function fromMm(mm: number, units: Units): number {
  return mm / UNIT_TO_MM[units];
}

export function parseLength(text: string, units: Units): number | null {
  if (text.length > 64) return null;
  const match = text
    .trim()
    .match(
      /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(mm|cm|m|in)?$/i,
    );
  if (!match) return null;
  const value = Number(match[1]);
  const suffix = (match[2]?.toLowerCase() ?? units) as Units;
  const mm = toMm(value, suffix);
  return Number.isFinite(mm) ? mm : null;
}

export function roundedLength(mm: number, units: Units): number {
  const digits = Math.ceil(Math.log10(UNIT_TO_MM[units] / LINEAR_TOL));
  return Math.round(fromMm(mm, units) * 10 ** digits) / 10 ** digits + 0;
}

function round(value: number, digits: number): string {
  const scale = 10 ** digits;
  return String(Math.round(value * scale) / scale + 0);
}

export function formatLength(
  mm: number,
  units: Units,
  digits?: number,
): string {
  return `${digits === undefined ? roundedLength(mm, units) : round(fromMm(mm, units), digits)} ${units}`;
}

export function formatAngle(deg: number, digits: number): string {
  return `${round(deg, digits)}°`;
}

export const MB = 1024 * 1024;
export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
