import { shapeHash, type Shape } from "./kernel.js";

let tracked: ShapeMap<unknown>[] | undefined;

export function trackShapeMaps<T>(made: ShapeMap<unknown>[], run: () => T): T {
  const outer = tracked;
  tracked = made;
  try {
    return run();
  } finally {
    tracked = outer;
  }
}

export class ShapeMap<V> {
  private readonly buckets = new Map<number, [Shape, V][]>();
  private readonly order: [Shape, V][] = [];

  constructor() {
    tracked?.push(this);
  }

  get size(): number {
    return this.order.length;
  }

  get(shape: Shape): V | undefined {
    return this.entry(shape)?.[1];
  }

  set(shape: Shape, value: V): this {
    const found = this.entry(shape);
    if (found) {
      found[1] = value;
      return this;
    }
    const hash = shapeHash(shape);
    const added: [Shape, V] = [shape.Oriented(shape.Orientation_1()), value];
    const bucket = this.buckets.get(hash);
    if (bucket) bucket.push(added);
    else this.buckets.set(hash, [added]);
    this.order.push(added);
    return this;
  }

  entries(): IterableIterator<[Shape, V]> {
    return this.order.values();
  }

  values(): IterableIterator<V> {
    return Array.from(this.order.values(), ([, value]) => value).values();
  }

  release(): void {
    for (const [key] of this.order) key.delete();
    this.order.length = 0;
    this.buckets.clear();
  }

  private entry(shape: Shape): [Shape, V] | undefined {
    return this.buckets
      .get(shapeHash(shape))
      ?.find(([key]) => key.IsSame(shape));
  }
}
