import { createElement as h, Fragment } from "react";
import type { ClientUi } from "@rockett/plugin-api";
import type { Post } from "../post/schema.js";
import { rigidityTerms } from "../feeds/suggest.js";
import { POSTS } from "../server/posts.js";
import {
  machineKind,
  machineRigidity,
  machineSchema,
  RIGIDITY_OPTIONS,
  withFirmware,
  type MachineKind,
  type MachineProfile,
  type Rigidity,
} from "../shared/machine.js";
import { GrblPaste } from "./grblPaste.js";
import { banner, unqualified } from "./libraryParts.js";
import { schemaFields } from "./schemaForm.js";

type Edit = (machine: MachineProfile) => void;

const KINDS: [MachineKind, string][] = [
  ["mill", "Mill"],
  ["laser", "Laser"],
];

function postOptions(own: Post[], current: string): [string, string][] {
  const options: [string, string][] = [
    ...[...POSTS.values()].map(({ id, label }): [string, string] => [
      id,
      label,
    ]),
    ...own.map(({ id, label }): [string, string] => [id, unqualified(label)]),
  ];
  return options.some(([id]) => id === current)
    ? options
    : [...options, [current, current]];
}

export const machineFields = (
  ui: ClientUi,
  machine: MachineProfile,
  edit: Edit,
) =>
  schemaFields(ui, machineSchema, machine, (next) =>
    edit(
      next.firmware === machine.firmware
        ? next
        : withFirmware(next, next.firmware),
    ),
  );

function laserProps(
  key: "laserPowerMax" | "focusZ",
  label: string,
  machine: MachineProfile,
  edit: Edit,
) {
  const { [key]: value, ...cleared } = machine;
  return {
    key,
    label,
    value,
    onChange: (next: number) => edit({ ...machine, [key]: next }),
    onClear: () => edit(cleared),
  };
}

const rigidityFields = (ui: ClientUi, machine: MachineProfile, edit: Edit) =>
  machineKind(machine) === "mill"
    ? [
        h(ui.SelectField<Rigidity>, {
          key: "rigidity",
          label: "Rigidity",
          value: machineRigidity(machine),
          options: RIGIDITY_OPTIONS,
          onChange: (rigidity) => edit({ ...machine, rigidity }),
        }),
        h(
          "span",
          { key: "rigidityHint", className: "field-hint" },
          `Suggest ${rigidityTerms(machineRigidity(machine))}.`,
        ),
      ]
    : [];

const laserFields = (ui: ClientUi, machine: MachineProfile, edit: Edit) =>
  machineKind(machine) === "laser"
    ? [
        h(ui.NumField, {
          ...laserProps("laserPowerMax", "Max laser power (S)", machine, edit),
          above: 0,
        }),
        h(ui.LengthField, laserProps("focusZ", "Focus Z", machine, edit)),
      ]
    : [];

export const machineForm =
  (posts: Post[], postsError: string | null) =>
  (ui: ClientUi, machine: MachineProfile, edit: Edit) => [
    h(ui.TextField, {
      key: "name",
      label: "Name",
      value: machine.name,
      onChange: (name) => edit({ ...machine, name }),
    }),
    h(ui.SelectField<MachineKind>, {
      key: "kind",
      label: "Kind",
      value: machineKind(machine),
      options: KINDS,
      onChange: (kind) => edit({ ...machine, kind }),
    }),
    ...rigidityFields(ui, machine, edit),
    h(Fragment, { key: "postsError" }, banner(postsError)),
    h(ui.SelectField<string>, {
      key: "post",
      label: "Default post",
      value: machine.post,
      options: postOptions(posts, machine.post),
      onChange: (post) => edit({ ...machine, post }),
    }),
    ...laserFields(ui, machine, edit),
    h(GrblPaste, { key: "grblPaste", ui, machine, edit }),
    ...machineFields(ui, machine, edit),
  ];
