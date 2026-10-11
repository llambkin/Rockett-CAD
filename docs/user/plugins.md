# Writing a plugin

A plugin adds commands, panels, exporters, routes and more to Rockett CAD.
It uses the same API as the modules Rockett ships. This guide describes what
the host does today.

## Trust

Read this first. Rockett runs plugin code with no sandbox. The ruling that
sets this, DEC-501:

> Third-party modules are trusted code, installed only by folder drop,
> disabled until an admin enables them, which records the folder hash; a
> hash change disables them. No signing, sandbox or marketplace yet.

What that means in practice:

- `server.mjs` runs inside the server process, with the server's file and
  network access. It can read every project and user on that server.
- `client.mjs` runs in the browser of every signed-in user, with their
  session.
- No route accepts plugin uploads. Only someone who can write to the plugin
  folder can install one.

An admin should install only code they have read, or code from an author
they trust.

## Layout

A plugin is one folder. Its name is the plugin `id`.

```
acme/
  manifest.json   required
  server.mjs      required, default export with activate
  client.mjs      optional, default export with activate
  LICENSE         optional, shown on the Modules page
  ...             any other files server.mjs imports
```

- Ship built ES modules, not TypeScript. Bundle your own dependencies.
- `server.mjs` may import Node builtins and files inside the folder.
- `client.mjs` is served alone, so it is one file. It may import only
  `react`, `react/jsx-runtime`, `react-dom/client` and `three`, which resolve
  to the host's own copies. Keep them external and use the automatic JSX
  runtime. A second bundled React or three breaks hooks and `instanceof`.
- Any other import outside the folder, and any symlink, refuses the plugin.
  The host checks literal `import`, `from` and `require` specifiers only.
- Limits per server, from `PLUGIN_LIMITS`: 64 plugin folders, and per plugin
  4096 files and folders and 256 MB.

## Manifest

```json
{
  "manifestVersion": 1,
  "id": "acme",
  "name": "Acme tools",
  "version": "1.2.0",
  "apiRange": "^0.23",
  "licence": "MIT OR Apache-2.0",
  "author": "Acme Ltd",
  "dataVersion": 2,
  "contributes": {
    "commands": ["acme.hello"],
    "panels": ["acme.notes"],
    "routes": ["acme.api"],
    "exporters": ["acme.text"]
  }
}
```

`parseManifest` in `shared/src/moduleManifest.ts` checks every field:

| Field             | Rule                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `manifestVersion` | `1`.                                                                                                          |
| `id`              | Lowercase letters and digits in dot-separated parts, each starting with a letter. Must equal the folder name. |
| `name`, `author`  | 1 to 200 characters.                                                                                          |
| `version`         | `MAJOR.MINOR.PATCH`.                                                                                          |
| `apiRange`        | `^MAJOR.MINOR` of the plugin API. See below.                                                                  |
| `licence`         | An SPDX id, or ids joined by `AND`, `OR` or `WITH`.                                                           |
| `dataVersion`     | Optional integer from 1. The version of your document data.                                                   |
| `contributes`     | Lists of ids per contribution point. Each id starts with `<id>.`; a setting key starts with `plugin.<id>.`.   |

The ids `design`, `sketch`, `inspect` and `asm`, and ids under them, belong
to the core and are refused, as is `b`, which starts core body ids. The
shipped modules use `rockett`.

## API version policy

The host's version is `PLUGIN_API_VERSION` in `plugin-api/src/index.ts`. The
examples here target 0.23.

- `apiRange` is `^MAJOR.MINOR`.
- While the API is 0.x, each minor is its own line. A host loads only
  plugins that name its own minor: `^0.23` loads on 0.23.x and nowhere else.
  Expect to release for each new minor.
- From 1.0, `^1.2` loads on any 1.x from 1.2 up. Changes within a major only
  add. A removal is deprecated for one major and lands in a later one.
- A host outside the range lists the plugin `incompatible`, names both
  versions in the reason, and never imports its code.

The `@rockett/plugin-api` package is not published. Its types in
`plugin-api/src/` are the reference: `server.ts` for the server context,
`client.ts` for the client context, both exported from `index.ts`.
`defineServerModule` and `defineClientModule` return their argument, so a
plain object with `activate` works.

## Entry points

```js
export default {
  activate(context) {},
};
```

`server.mjs` and `client.mjs` each export that shape. `server.mjs` may also
export `migrations`; see below. `context.register` holds the
calls below; each returns a function that undoes it. A throw in `activate`
undoes what your plugin registered and affects no other module. On the
server it also lists your plugin `failed`; in the browser it logs to the
console.

## Contribution points

| Point            | Entry  | Call                                                             | Example id             |
| ---------------- | ------ | ---------------------------------------------------------------- | ---------------------- |
| `features`       | server | `register.timelineFeature(feature, entry)`                       | `acme.gear`            |
| `kernelJobs`     | server | `register.kernelJob(id, entry)`, run with `startKernelJob`       | `acme.count`           |
| `routes`         | server | `register.routeModule({ id, mount })`                            | `acme.api`             |
| `exporters`      | server | `register.exporter({ format, label, ext, mime, source, write })` | `acme.text`            |
| `importers`      | server | `register.importer({ format, label, extensions, read })`         | `acme.csv`             |
| `settings`       | both   | `register.setting(definition)`                                   | `plugin.acme.greeting` |
| `commands`       | client | `register.command({ id, label, run })`                           | `acme.hello`           |
| `toolbarGroups`  | client | `register.toolbarGroup({ id, label, context })`                  | `acme.tools`           |
| `panels`         | client | `register.panel({ id, title, when, component })`                 | `acme.notes`           |
| `workbenches`    | client | `register.workbench({ id, label, panels, selectionKinds })`      | `acme.bench`           |
| `sceneLayers`    | client | `register.layer({ id, mount })`                                  | `acme.grid`            |
| `selectionKinds` | client | `register.selectionKind(kind)`                                   | `acme.pin`             |
| `pickProviders`  | client | `register.pickProvider(provider)`                                | `acme.pins`            |
| `menuItems`      | client | `register.menuItem({ id, menu, command, after })`                | `acme.copy`            |
| `postProcessors` | none   | No call yet. CAM posts ship inside the CAM module.               | `acme.grbl`            |

Menu items: `menu` names a core context menu, such as `design.viewport.face`
or `design.tree.sketch`; an unknown menu fails activation. `after` or
`before` names an item of that menu, `<menu>.<name>`, such as
`design.viewport.face.exportDxf`. The item has no icon, takes its command's
label and shows only while that command is registered and its `when` holds.

`register.exporter`, `register.importer`, `register.selectionKind` and
`register.pickProvider` exist on the host contexts but are not typed in
`@rockett/plugin-api` yet. `register.settingsPage({ id, title, component })`
adds a page under your plugin's settings section and needs no manifest
entry.

Timeline features: `evaluate` may return
`bodies: [{ key, name, shape, faces, reference?, approximate? }]` beside
`shape`. Each entry becomes body `<id>:<featureId>:<key>`, so its id survives
edits and reopening and it belongs to the feature that made it.
`moduleBodyId(id, featureId, key)` builds that id, so a client can match a
picked body without writing the format. Your `name` wins on every
evaluation, and users cannot rename a module body.
`readStep(bytes)` in the `evaluate` scope reads STEP bytes, such as one of
your `inputs.assets`, through the core importer and returns one shape per
STEP part, owned by the scope. Bytes over the server's import budget are
refused before reading, with the message a core import gives.

Placements: `placementSchema` validates a stored `{ rotation, translation }`
and `Placement.applyToPoint` or `Placement.applyToDirection` moves geometry
by one, so a plugin does not carry its own quaternion maths.

Layer colours: `themed(material, token)` sets a three.js material's colour
from a theme token such as `selection` or `warn` and records the token, so a
theme switch recolours it.

DXF: `context.dxf(projectId, user, { sketchId })` or
`{ face: { kind: "face", bodyId, faceName } }` returns the DXF bytes the
export menu writes for that sketch or planar face. Add `layer: "Edge.Cuts"`
to put the outline on a named layer. A curved face is refused.

Routes: a route is a plain `{ method, path }` object; a project mutation
adds `effect: "document"`. A user route lives under `/m/<id>/`, a project
route under `/projects/:id/m/<id>/`, both behind `/api`, with the dots of a
dotted id as slashes. On the client, `context.request("GET", "greeting")`
calls `/m/<id>/greeting`.
Project routes and mutations get `unzstd(bytes, maxBytes)`, which decodes
Zstandard bytes. It refuses input over the server's import budget, input
that is not Zstandard, and output over `maxBytes`, which it stops at the cap
instead of allocating. A truncated frame returns short output without an
error, so check the size you expect.

Known limits today:

- A built server refuses `register.kernelJob` and `register.timelineFeature`
  for a plugin, because only shipped modules have kernel bundles.
- A plugin cannot ship toolbar icons. A command with `icon` fails
  activation; use `Control` with a `group`, or no group.

## Data

Each store is keyed by your `id`, so plugins never share data:

- Document data: `extensions[<id>]` in the project, `{ version, data }`,
  written by your project mutations.
- Timeline features: type `<id>.<name>`.
- Per-user data: `context.userData(name, version)`, up to 8 MB per entry,
  with etag checks.
- Server files, such as a cache: `context.files`, rooted at your plugin's own
  folder in the data folder.

When your plugin is missing, disabled, incompatible or failed, projects
still open. Its
data and features are kept unchanged; its features show
`Requires module <id>`.

## Migrations

Raise `dataVersion` when the shape of `extensions[<id>].data` changes, and
export one step per old version from `server.mjs`:

```js
export default {
  activate(context) {},
  migrations: {
    1: (data) => ({ ...data, units: "mm" }),
  },
};
```

- Keys run from 1 to `dataVersion - 1`. Each step upgrades from its key to
  the next version.
- The host runs them when a project loads, with the core migrations. The
  first save backs the project up first.
- A key outside that range, a step that is not a function, or `migrations`
  without `dataVersion` fails activation.
- A gap in the steps makes the project unreadable. Ship every step.
- Data or a feature newer than your plugin is kept as stored, never
  downgraded. Its features show an error naming both versions.

## Settings

The host owns two settings per plugin:

- `plugin.<id>.enabled`: app scope, set by an admin.
- `plugin.<id>.hidden`: per user. It hides your commands, workbenches,
  panels and toolbar groups for that user. Settings pages stay.

Any key ending in `.enabled` or `.hidden` is reserved for the host.

Your own settings are limited today. The server accepts
`register.setting` for a key listed in `contributes.settings`. The client
context carries no manifest `contributes`, so the client refuses every
plugin key: `register.setting`, `settings.get`, `settings.set` and
`settings.subscribe` all throw. The server context has no settings reader.
Until that changes, draw your own page with `register.settingsPage` and keep
values in `userData`.

## Licence

Set `licence` to the SPDX expression of your terms. Put the full text in
`LICENSE` at the top of the folder. The Modules page in Settings shows your
`licence`, author and version. Once the plugin is enabled, it opens the
`LICENSE` text beside a line naming `THIRD-PARTY-NOTICES.md`. With no
`LICENSE`, it says the plugin ships none. Rockett honours each plugin author's terms and attribution.

## Install and enable

1. Copy the folder into the plugin folder, named by its `id`. The plugin
   folder is `ROCKETT_PLUGIN_DIR`, or `plugins` inside `DATA_DIR` when unset.
2. Restart the server. The Modules page lists the plugin `disabled`, with a
   reason naming its closure sha256.
3. As an admin, set two app settings: `GET /api/settings`, then
   `PATCH /api/settings` with `If-Match` set to the returned `ETag` and this
   body, using the sha256 from step 2:

   ```
   { "set": { "plugin.acme.enabled": true, "plugin.acme.sha256": "<sha256>" } }
   ```

4. Restart the server. The plugin lists `loaded`. Its client loads in each
   browser after the shipped modules.

The closure sha256 covers every file in the folder, whatever its name.
Changing any file disables the plugin at the next start, with a reason
naming the new sha256; repeat step 3 to accept it. The server runs a
read-only copy of the bytes it hashed, so edits never reach running code.
Set `plugin.<id>.enabled` to `false` to turn a plugin off.

`GET /api/modules` and the Modules page list every plugin with one status:
`loaded`, `disabled`, `incompatible` or `failed`, and the reason.

## Worked example: hello

Rockett's own tests install this plugin. It adds one exporter on the server
and one settings page on the client.

`hello/manifest.json`:

```json
{
  "manifestVersion": 1,
  "id": "hello",
  "name": "Hello",
  "version": "1.0.0",
  "apiRange": "^0.23",
  "licence": "MIT",
  "author": "Rockett CAD",
  "contributes": { "exporters": ["hello.text"] }
}
```

`hello/greeting.mjs`, a second server file:

```js
export const greeting = "hello";
```

`hello/server.mjs` registers exporter `hello.text`, which writes the bytes
`hello`:

```js
import { greeting } from "./greeting.mjs";

export default {
  activate({ register }) {
    register.exporter({
      format: "hello.text",
      label: "Hello",
      ext: "txt",
      mime: "text/plain",
      source: "bodies",
      write: () => Buffer.from(greeting),
    });
  },
};
```

`hello/client.mjs` adds the page "Hello page" under the Hello section of
Settings. It imports the host's JSX runtime:

```js
import { jsx } from "react/jsx-runtime";

export default {
  activate({ register }) {
    register.settingsPage({
      id: "hello.page",
      title: "Hello page",
      component: () => jsx("p", { children: "Hello from a plugin" }),
    });
  },
};
```

Install it as above. Before enabling, the Modules page shows Hello
`disabled` with its sha256. After enabling and a restart, it shows `loaded`.
Edit `greeting.mjs` and restart: Hello is `disabled` again, with a new
sha256.
