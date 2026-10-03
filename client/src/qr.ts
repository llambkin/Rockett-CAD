const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = EC_PER_BLOCK.length;

type Put = (x: number, y: number, dark: boolean) => void;

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

const EXP: number[] = [];
const LOG: number[] = [];
for (let i = 0, x = 1; i < 255; i++, x = (x << 1) ^ (x & 0x80 ? 0x11d : 0)) {
  EXP[i] = x;
  LOG[x] = i;
}

function multiply(a: number, b: number): number {
  return a && b ? EXP[(LOG[a]! + LOG[b]!) % 255]! : 0;
}

function errorCorrection(data: number[], degree: number): number[] {
  let generator = [1];
  for (let i = 0; i < degree; i++) {
    const next = [...generator, 0];
    generator.forEach((c, j) => (next[j + 1]! ^= multiply(c, EXP[i]!)));
    generator = next;
  }
  const remainder = Array.from({ length: degree }, () => 0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift()!;
    remainder.push(0);
    generator
      .slice(1)
      .forEach((c, i) => (remainder[i]! ^= multiply(c, factor)));
  }
  return remainder;
}

function alignmentCentres(version: number): number[] {
  if (version < 2) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const centres = [6];
  for (let at = 10 + 4 * version; centres.length < count; at -= step)
    centres.splice(1, 0, at);
  return centres;
}

function totalCodewords(version: number): number {
  const aligns = alignmentCentres(version).length;
  const functionModules =
    (aligns ? (25 * aligns - 10) * aligns - 55 : 0) + (version < 7 ? 0 : 36);
  return Math.floor(
    ((16 * version + 128) * version + 64 - functionModules) / 8,
  );
}

function dataCodewords(version: number): number {
  return (
    totalCodewords(version) - EC_PER_BLOCK[version - 1]! * BLOCKS[version - 1]!
  );
}

function countBits(version: number): number {
  return version < 10 ? 8 : 16;
}

function byteCapacity(version: number): number {
  return Math.floor((8 * dataCodewords(version) - 4 - countBits(version)) / 8);
}

function dataBits(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  const capacity = dataCodewords(version);
  put(0b0100, 4);
  put(bytes.length, countBits(version));
  bytes.forEach((byte) => put(byte, 8));
  put(0, Math.min(4, capacity * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity * 8; pad ^= 0xec ^ 0x11)
    put(pad, 8);
  return bits;
}

function interleave(lists: number[][], length: number): number[] {
  return Array.from({ length }, (_, i) =>
    lists.flatMap((list) => (i < list.length ? [list[i]!] : [])),
  ).flat();
}

function codewordBits(bytes: Uint8Array, version: number): boolean[] {
  const bits = dataBits(bytes, version);
  const data = Array.from({ length: bits.length / 8 }, (_, i) =>
    bits.slice(i * 8, i * 8 + 8).reduce((byte, bit) => (byte << 1) | bit, 0),
  );
  const blockCount = BLOCKS[version - 1]!;
  const degree = EC_PER_BLOCK[version - 1]!;
  const shortLength = Math.floor(totalCodewords(version) / blockCount) - degree;
  const longFrom = blockCount - (totalCodewords(version) % blockCount);
  const blocks: number[][] = [];
  for (let i = 0, at = 0; i < blockCount; i++) {
    const length = shortLength + (i >= longFrom ? 1 : 0);
    blocks.push(data.slice(at, (at += length)));
  }
  const codewords = [
    ...interleave(blocks, shortLength + 1),
    ...interleave(
      blocks.map((block) => errorCorrection(block, degree)),
      degree,
    ),
  ];
  return codewords.flatMap((byte) =>
    Array.from({ length: 8 }, (_, i) => ((byte >>> (7 - i)) & 1) === 1),
  );
}

function drawFunctionPatterns(put: Put, version: number, size: number): void {
  for (let i = 0; i < size; i++) {
    put(6, i, i % 2 === 0);
    put(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        const [x, y] = [cx + dx, cy + dy];
        if (x >= 0 && x < size && y >= 0 && y < size)
          put(x, y, ring !== 2 && ring !== 4);
      }
    }
  }
  const centres = alignmentCentres(version);
  const last = centres.length - 1;
  centres.forEach((cy, i) =>
    centres.forEach((cx, j) => {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === last) ||
        (i === last && j === 0)
      )
        return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++)
          put(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }),
  );
}

function bch(value: number, generator: number, degree: number): number {
  let remainder = value;
  for (let i = 0; i < degree; i++)
    remainder = (remainder << 1) ^ ((remainder >>> (degree - 1)) * generator);
  return (value << degree) | remainder;
}

function drawVersion(put: Put, version: number, size: number): void {
  const bits = bch(version, 0x1f25, 12);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const [a, b] = [size - 11 + (i % 3), Math.floor(i / 3)];
    put(a, b, dark);
    put(b, a, dark);
  }
}

function drawInformation(
  put: Put,
  version: number,
  mask: number,
  size: number,
): void {
  const bits = bch(mask, 0x537, 10) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) put(8, i, bit(i));
  put(8, 7, bit(6));
  put(8, 8, bit(7));
  put(7, 8, bit(8));
  for (let i = 9; i < 15; i++) put(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) put(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) put(8, size - 15 + i, bit(i));
  put(8, size - 8, true);
  if (version >= 7) drawVersion(put, version, size);
}

function drawData(
  dark: boolean[],
  fixed: boolean[],
  bits: boolean[],
  size: number,
): void {
  let next = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (!fixed[y * size + x]) dark[y * size + x] = bits[next++] ?? false;
      }
    }
  }
}

function runPenalty(line: boolean[]): number {
  let score = 0;
  let run = 0;
  line.forEach((dark, i) => {
    run = i > 0 && dark === line[i - 1] ? run + 1 : 1;
    if (run === 5) score += 3;
    else if (run > 5) score += 1;
  });
  const text = `0000${line.map((dark) => (dark ? "1" : "0")).join("")}0000`;
  for (
    let at = text.indexOf("1011101");
    at >= 0;
    at = text.indexOf("1011101", at + 1)
  ) {
    if (
      text.slice(at - 4, at) === "0000" ||
      text.slice(at + 7, at + 11) === "0000"
    )
      score += 40;
  }
  return score;
}

function penalty(dark: boolean[], size: number): number {
  const rows = Array.from({ length: size }, (_, y) =>
    dark.slice(y * size, y * size + size),
  );
  const columns = rows.map((_, x) => rows.map((row) => row[x]!));
  let score = [...rows, ...columns].reduce(
    (sum, line) => sum + runPenalty(line),
    0,
  );
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const at = y * size + x;
      const colour = dark[at];
      if (
        dark[at + 1] === colour &&
        dark[at + size] === colour &&
        dark[at + size + 1] === colour
      )
        score += 3;
    }
  }
  const darkCount = dark.filter(Boolean).length;
  return (
    score +
    10 * Math.floor(Math.abs((darkCount * 100) / (size * size) - 50) / 5)
  );
}

export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version =
    EC_PER_BLOCK.findIndex((_, i) => byteCapacity(i + 1) >= bytes.length) + 1;
  if (version === 0)
    throw new Error(
      `QR text is ${bytes.length} bytes; the limit is ${byteCapacity(MAX_VERSION)}`,
    );
  const size = 17 + 4 * version;
  const dark = Array.from({ length: size * size }, () => false);
  const fixed = Array.from({ length: size * size }, () => false);
  const reserve: Put = (x, y, on) => {
    dark[y * size + x] = on;
    fixed[y * size + x] = true;
  };
  drawFunctionPatterns(reserve, version, size);
  drawInformation((x, y) => reserve(x, y, false), version, 0, size);
  drawData(dark, fixed, codewordBits(bytes, version), size);
  const best = MASKS.map((mask, index) => {
    const masked = dark.map((on, at) =>
      fixed[at] ? on : on !== mask(at % size, Math.floor(at / size)),
    );
    return { index, masked, score: penalty(masked, size) };
  }).reduce((a, b) => (b.score < a.score ? b : a));
  drawInformation(
    (x, y, on) => (best.masked[y * size + x] = on),
    version,
    best.index,
    size,
  );
  return Array.from({ length: size }, (_, y) =>
    best.masked.slice(y * size, y * size + size),
  );
}
