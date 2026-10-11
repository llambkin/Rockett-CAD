export const TIMING_MS = {
  previewDebounce: 36,
  timelinePeekDwell: 72,
  dragThrottle: 72,
  viewTurn: 72,
  wheelGestureIdle: 72,
  sketchAlignDelay: 36,
  jobHintDelay: 500,
  jobTerminalWait: 5_000,
  viewSave: 1_000,
  panelSaveDelay: 500,
  snapshotHoverDelay: 400,
  snapshotInterval: 60_000,
  selectionSettle: 250,
} as const;

export const PREVIEW_APPEARANCE = {
  gizmoCutOpacity: 0.3,
  gizmoAddOpacity: 0.22,
} as const;

export const BODY_APPEARANCE = {
  metalness: 0.15,
  roughness: 0.55,
  vertexSizePx: 4,
} as const;

export const HIGHLIGHT_APPEARANCE = {
  faceOpacity: { select: 0.5, hover: 0.3 },
  edgeLinewidth: 2,
  vertexSizePx: 10,
  originPlaneOpacity: 0.25,
} as const;

export const PLANE_APPEARANCE = {
  originFillOpacity: 0.07,
  originBorderOpacity: 0.35,
  originAxisOpacity: 0.6,
  constructionFillOpacity: 0.09,
  constructionBorderOpacity: 0.55,
} as const;

export const SKETCH_APPEARANCE = {
  profileSelectOpacity: 0.55,
  profileHoverOpacity: 0.4,
  profileUsedOpacity: 0.06,
  profileOpacity: 0.18,
  activeLineOpacity: 1,
  dimmedLineOpacity: 0.5,
  inactiveLineOpacity: 0.8,
  constructionDashMm: 2,
  constructionGapMm: 1.5,
  pointSizePx: 6,
  pointHighlightSizePx: 9,
  previewLineOpacity: 0.9,
  dimLeaderOpacity: 0.4,
  dimLeaderDashPx: 5,
  dimLeaderGapPx: 4,
} as const;

export const GIZMO_APPEARANCE = {
  shaftOpacity: 0.95,
  ringOpacity: 0.9,
} as const;
