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

function round(value: number, digits: number): string {
  const scale = 10 ** digits;
  return String(Math.round(value * scale) / scale + 0);
}

export function formatLength(mm: number, units: Units, digits: number): string {
  return `${round(fromMm(mm, units), digits)} ${units}`;
}

export function formatAngle(deg: number, digits: number): string {
  return `${round(deg, digits)}°`;
}
