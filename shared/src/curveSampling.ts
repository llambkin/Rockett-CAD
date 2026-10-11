export const ARC_SEGMENTS = 24;

const GOLDEN = (Math.sqrt(5) - 1) / 2;

export function least(f: (t: number) => number, lo: number, hi: number) {
  for (let i = 0; i < 60; i++) {
    const [m1, m2] = [hi - GOLDEN * (hi - lo), lo + GOLDEN * (hi - lo)];
    if (f(m1) < f(m2)) hi = m2;
    else lo = m1;
  }
  return (lo + hi) / 2;
}
