export interface Recovery {
  kind: "conflict" | "offline";
  message: string;
}

const MESSAGES: Record<Recovery["kind"], string> = {
  conflict:
    "This project changed in another tab or by another user, so your last change is not saved.",
  offline: "The server could not be reached, so your last change is not saved.",
};

export function recoveryFor(error: unknown): Recovery | null {
  const { status, revision } = (error ?? {}) as Record<string, unknown>;
  const kind =
    status === 409 && revision !== undefined
      ? "conflict"
      : status === 0
        ? "offline"
        : null;
  return kind && { kind, message: MESSAGES[kind] };
}

export function writeQueue(
  counted: (writing: number) => void,
): <T>(write: () => Promise<T>) => Promise<T> {
  let writes: Promise<unknown> = Promise.resolve();
  let writing = 0;
  return (write) => {
    counted(++writing);
    const turn = writes.then(write).finally(() => counted(--writing));
    writes = turn.catch(() => {});
    return turn;
  };
}
