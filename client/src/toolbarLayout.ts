import type { ToolbarLayout } from "@rockett/shared";

type Identified = { id: string };

const ownIds = (
  order: Readonly<Record<string, readonly string[]>> | undefined,
  group: string,
) => (order && Object.hasOwn(order, group) ? (order[group] ?? []) : []);

export function applyToolbarLayout<G extends Identified, C extends Identified>(
  groups: readonly { group: G; commands: readonly C[] }[],
  layout: ToolbarLayout[string] = {},
) {
  const byId = new Map(
    groups.flatMap(({ commands }) => commands.map((c) => [c.id, c] as const)),
  );
  const home = new Map<string, string>();
  for (const { group } of groups)
    for (const id of ownIds(layout.order, group.id))
      if (byId.has(id) && !home.has(id)) home.set(id, group.id);
  const hidden = new Set(layout.hidden);
  const pinned = (layout.pinned ?? []).flatMap((id) => {
    const command = byId.get(id);
    return command && !hidden.has(id) ? [command] : [];
  });
  const elsewhere = new Set([...hidden, ...pinned.map((c) => c.id)]);
  return {
    groups: groups.map(({ group, commands }) => {
      const placed = ownIds(layout.order, group.id).flatMap((id) => {
        const command = byId.get(id);
        return command && home.get(id) === group.id ? [command] : [];
      });
      let at = 0;
      for (const command of commands) {
        if (!home.has(command.id)) placed.splice(at++, 0, command);
        else if (home.get(command.id) === group.id)
          at = placed.indexOf(command) + 1;
      }
      return { group, commands: placed.filter((c) => !elsewhere.has(c.id)) };
    }),
    pinned,
  };
}
