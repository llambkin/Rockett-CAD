import type { RefSignature } from "@rockett/shared";
import { vi } from "vitest";

export const REPAIR_SIG: RefSignature = {
  type: "line",
  point: [9, 8, 7],
  direction: [0, 0, 1],
};

export const repairApiMock = () => ({
  watchUnauthorized: vi.fn(),
  send: vi.fn(async () => ({ sig: REPAIR_SIG })),
  api: {
    sizeLimit: vi.fn(() => new Promise(() => {})),
    addFeature: vi.fn(),
    updateFeature: vi.fn(),
    commitPreview: vi.fn(),
    abortPreview: vi.fn(),
    undo: vi.fn(),
    evaluate: vi.fn(),
    stageNamingUpgrade: vi.fn(),
    commitNamingUpgrade: vi.fn(),
  },
});

export const pickApiMock = () => ({
  watchUnauthorized: vi.fn(),
  api: {
    evaluate: vi.fn(),
    addFeature: vi.fn(),
    updateFeature: vi.fn(),
    putView: vi.fn(async (_id: string, view: unknown) => view),
  },
});
