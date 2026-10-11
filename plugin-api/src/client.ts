import type { ComponentType, ReactNode } from "react";
import type { Color, Group, Material, Object3D } from "three";
import type {
  CadDocument,
  MeasureRequest,
  MeasureResult,
  PathParams,
  Route,
  SettingDefinition,
} from "@rockett/shared";
import type {
  Dispose,
  FaceRef,
  ProjectBody,
  RouteBody,
  RouteResponse,
} from "./server.js";

export interface Anchored {
  id: string;
  after?: string;
  before?: string;
}

export interface CommandBase<Ctx> extends Anchored {
  label: string;
  when?(ctx: Ctx): boolean;
  enabled?(ctx: Ctx): true | string;
}

export type Keyed =
  | { keys?: never; keyContext?: never }
  | { keys: readonly string[]; keyContext: string };

export interface CommandControl {
  group: string;
  Control: ComponentType;
  run?: never;
  icon?: never;
}

export type CommandAction<Ctx> = {
  Control?: never;
  run(ctx: Ctx): unknown;
} & (
  { group?: never; icon?: never } | { group: string; icon: `${string}.svg` }
);

export type Command<Ctx = unknown> = CommandBase<Ctx> &
  Keyed &
  (CommandControl | CommandAction<Ctx>);

export const EVERY_WORKBENCH = "workbench";

export interface ToolbarGroup extends Anchored {
  label: string;
  context: string;
  end?: true;
}

export interface MenuItem extends Anchored {
  menu: string;
  command: string;
}

export interface Panel<State = unknown> {
  id: string;
  title: string;
  when(state: State, open: readonly string[]): boolean;
  component: ComponentType;
}

export interface Workbench {
  id: string;
  label: string;
  panels: readonly string[];
  selectionKinds: readonly string[];
  tree?: ComponentType;
  bar?: ComponentType;
}

export interface ViewportLayer {
  readonly group: Group;
  requestRender(): void;
  disposeObject(object: Object3D): void;
  disposeGroup(group: Object3D): void;
  clearGroup(group: Object3D): void;
}

export function themed<M extends Material & { color: Color }>(
  material: M,
  token: string,
): M {
  material.color.set(
    getComputedStyle(document.documentElement)
      .getPropertyValue(`--${token}`)
      .trim(),
  );
  material.userData.themeToken = token;
  return material;
}

export interface Layer {
  id: string;
  mount(layer: ViewportLayer): void | Dispose;
}

export interface SettingsPage {
  id: string;
  title: string;
  component: ComponentType;
}

export interface ClientRegister {
  command(command: Command): Dispose;
  toolbarGroup(group: ToolbarGroup): Dispose;
  menuItem(item: MenuItem): Dispose;
  panel(panel: Panel): Dispose;
  workbench(workbench: Workbench): Dispose;
  layer(layer: Layer): Dispose;
  setting(definition: SettingDefinition): Dispose;
  settingsPage(page: SettingsPage): Dispose;
}

export interface OpenProject {
  readonly projectId: string | null;
  readonly document: CadDocument | null;
  readonly bodies: readonly ProjectBody[];
}

export type ProjectRoute = Route<`/projects/:id/${string}`>;

export type PickRef = MeasureRequest["refs"][number];

export interface PickMode {
  command: string;
  kinds: readonly PickRef["kind"][];
  hint: string;
  onPick(ref: PickRef | null): void;
  onEnd?(): void;
}

export interface ProjectView {
  get(): OpenProject;
  selection(): readonly FaceRef[];
  picks(): readonly PickRef[];
  select(refs: readonly PickRef[]): void;
  pick(mode: PickMode): Dispose;
  subscribe(listener: () => void): Dispose;
  read<R extends ProjectRoute>(
    route: R,
    params: Omit<PathParams<R["path"]>, "id">,
  ): Promise<RouteResponse<R>>;
  mutate<R extends ProjectRoute>(route: R, body: RouteBody<R>): Promise<void>;
  measure(refs: readonly PickRef[]): Promise<MeasureResult>;
}

export type ContextMenuItem = {
  label: string;
  danger?: boolean;
} & (
  { action: () => void; disabled?: false } | { disabled: true; action?: never }
);

export interface NumberFieldProps {
  label?: string;
  value: number | undefined;
  onChange(value: number): void;
  onClear?(): void;
  min?: number;
  max?: number;
  above?: number;
  int?: boolean;
  step?: number;
  ariaLabel?: string;
  autoFocus?: boolean;
}

export interface ClientUi {
  DraggablePanel: ComponentType<{
    id?: string;
    title: string;
    className?: string;
    children: ReactNode;
  }>;
  DialogFooter: ComponentType<{
    onOk?: () => void;
    onCancel: () => void;
    pending?: boolean;
    okLabel?: string;
    cancelLabel?: string;
    okDisabled?: boolean;
  }>;
  NumField: ComponentType<NumberFieldProps>;
  LengthField: ComponentType<NumberFieldProps & { label: string }>;
  AngleField: ComponentType<NumberFieldProps & { label: string }>;
  useFormatLength(): (mm: number, power?: 2 | 3) => string;
  formatAngle(deg: number, digits: number): string;
  SelectField<T extends string>(props: {
    label: string;
    value: T;
    options: [T, string][];
    onChange: (value: NoInfer<T>) => void;
  }): ReactNode;
  CheckField: ComponentType<{
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
  }>;
  TextField: ComponentType<{
    label: string;
    value: string;
    onChange: (value: string) => void;
    error?: string | null;
    disabled?: boolean;
  }>;
  TextAreaField: ComponentType<{
    label: string;
    value: string;
    maxLength: number;
    onChange: (value: string) => void;
    rows?: number;
    disabled?: boolean;
  }>;
  ContextMenu: ComponentType<{
    x: number;
    y: number;
    up?: boolean;
    items: ContextMenuItem[];
    onClose: () => void;
  }>;
  openPanel(id: string): void;
  closePanel(id: string): void;
  openSettings(page: string): void;
  confirm(message: string): Promise<boolean>;
  showError(message: string): void;
  download(file: { fileName: string; data: BlobPart; type: string }): void;
  pickFile(request: {
    accept: string;
    maxBytes: number;
  }): Promise<{ name: string; text: string } | null>;
}

export interface ModuleSettings {
  get<T = unknown>(key: string): T;
  set(key: string, value: unknown): Promise<void>;
  subscribe(key: string, listener: (value: unknown) => void): Dispose;
}

export interface ClientContext {
  readonly register: ClientRegister;
  readonly project: ProjectView;
  readonly ui: ClientUi;
  readonly settings: ModuleSettings;
  request<T = unknown>(
    method: Route["method"],
    path: string,
    body?: unknown,
  ): Promise<T>;
}
