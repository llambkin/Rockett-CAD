import { vi } from "vitest";

export const repairApiMock = () => ({
  watchUnauthorized: vi.fn(),
  api: {
    sizeLimit: vi.fn(() => new Promise(() => {})),
    addFeature: vi.fn(),
    updateFeature: vi.fn(),
    commitPreview: vi.fn(),
    abortPreview: vi.fn(),
    undo: vi.fn(),
    evaluate: vi.fn(),
    forgetMeshes: vi.fn(),
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
    forgetMeshes: vi.fn(),
    putView: vi.fn(async (_id: string, view: unknown) => view),
  },
});
