import { useContext } from "react";
import { ViewportContext } from "../viewportRef";
import { useStore } from "../store";
import { useWorkbench } from "../shell/workbench";
import "../commands/design";
import { tooltipOf, useKeymap } from "../commands/keymap";
import {
  runCommand,
  toolbarFor,
  toolbarGroups,
  type CommandContext,
  type ToolbarCommand,
  type ToolbarGroup,
} from "../commands/registry";
import { ToolButton } from "./ToolButton";
import { HorizontalScroll } from "./HorizontalScroll";

export function Toolbar() {
  const active = useStore((s) => s.active);
  const workbench = useWorkbench((s) => s.current);
  useStore((s) => s.busy);
  useStore((s) => s.selection);
  useKeymap();

  const viewport = useContext(ViewportContext);
  const context =
    active && toolbarGroups().some((g) => g.context === active.id)
      ? active.id
      : workbench;
  const ctx = { ...useStore.getState(), viewport };
  const rows = toolbarFor(context, ctx);
  const group = ({ group: g, commands }: (typeof rows)[number]) => (
    <DesignGroup key={g.id} group={g} commands={commands} ctx={ctx} />
  );
  return (
    <HorizontalScroll
      key={context}
      className={
        context === workbench
          ? "toolbar"
          : `toolbar ${context.split(".").at(-1)}`
      }
    >
      {rows.filter((r) => !r.group.end).map(group)}
      <div className="tb-spacer" />
      {rows.filter((r) => r.group.end).map(group)}
    </HorizontalScroll>
  );
}

function DesignGroup({
  group,
  commands,
  ctx,
}: {
  group: ToolbarGroup;
  commands: ToolbarCommand[];
  ctx: CommandContext;
}) {
  return (
    <ToolGroup title={group.label}>
      {commands.map((c) =>
        c.Control ? (
          <c.Control key={c.id} />
        ) : (
          <ToolButton
            key={c.id}
            icon={c.icon}
            label={c.label}
            {...(c.iconOnly && { iconOnly: true })}
            title={tooltipOf(c)}
            {...(c.primary && { className: "primary" })}
            {...(c.active && { className: c.active(ctx) ? "active" : "" })}
            disabled={!c.explainsRefusal && (c.enabled?.(ctx) ?? true) !== true}
            onClick={() => {
              const why =
                c.explainsRefusal &&
                c.enabled?.({ ...ctx, ...useStore.getState() });
              if (typeof why === "string")
                return useStore.getState().setError(why);
              void runCommand(c.id, ctx.viewport);
            }}
          />
        ),
      )}
    </ToolGroup>
  );
}

function ToolGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="tb-group">
      {title && <span className="tb-title">{title}</span>}
      <div className="tb-row">{children}</div>
    </div>
  );
}
