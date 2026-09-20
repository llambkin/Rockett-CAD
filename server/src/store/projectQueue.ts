/** In-process ordering for operations sharing a project, with failure recovery. */
export class ProjectQueue {
  private pending = new Map<string, Promise<void>>();

  run<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.pending.get(id) ?? Promise.resolve()).then(operation);
    const tail = result.then(() => {}, () => {});
    this.pending.set(id, tail);
    void tail.then(() => {
      if (this.pending.get(id) === tail) this.pending.delete(id);
    });
    return result;
  }
}
