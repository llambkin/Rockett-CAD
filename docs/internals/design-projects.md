# Project list: folders, sort and filter

Status: proposal awaiting Mark's approval under DEC-406. DOC-029 and CUST-023
wait until DEC-406 records it under Rulings in `WORK-ORDER.md`. Colours are
the SET-023 graded greys in `design-settings.md`. Everything composes the
DEC-004 patterns already in `App.tsx` (`project-list-card`, `project-row`,
`icon-btn`, `RenameInput`) and elsewhere (`context-menu`, `DraggablePanel`,
`tree-item`, `dimmed`, `tb-select`, `error-banner`), except two new patterns
that need DEC-406: the breadcrumb, and drag to move, a gesture DEC-004 names.

## Root and a nested folder

```
+-- project-list-card -------------------------------------+
| Rockett CAD                                              |
| [ New project name...        ] [Create] [New folder]     |
| [New project from STEP]                                  |
| Projects                                                 |
| [ Filter by name...          ]   Sort [ Modified  v ]    |
| [F] Brackets         3 items           (e) (m) (x)       |
| [F] Enclosures       0 items           (e) (m) (x)       |
| Gearbox lid                            (e) (c) (m) (x)   |
|   31 features . 22/09/2026 09:40                         |
+----------------------------------------------------------+

| Projects > Brackets > Steel                              |
| [F] Plates           2 items           (e) (m) (x)       |
| Motor mount                            (e) (c) (m) (x)   |
|   12 features . 23/09/2026 10:14                         |
[F] folder glyph   (e) rename   (c) duplicate   (m) move to   (x) delete
```

- Breadcrumb ancestors are `accent` text buttons (9.39 on `bg1`). Folder rows
  are `project-row`s with a glyph and item count, above projects.
- Create, New folder and STEP import act in the current folder. A new folder
  opens in `RenameInput`. A new project is created, then moved; named risk:
  if the move fails it sits at the root, where it is still found.

## Right-click menus

A `context-menu` on a right-click of a row; Delete is its `danger` item.
Duplicate places the copy beside the original.

```
Project row:  | Open | Rename | Duplicate | Move to... | Delete |
Folder row:   | Open | Rename | Move to... | Delete |
```

## Move to

A `DraggablePanel` dialog with `tree-item` rows and `DialogFooter`.

```
+-- Move "Plates" -------------------- x --+
|  Projects                                |
|    Brackets                              |
|      Steel            (here)             |  <- dimmed
|        Plates         (this folder)      |  <- dimmed
|    Enclosures                            |  <- selected
|                          [Move] [Cancel] |
+------------------------------------------+
```

The current folder, the moved folder and its descendants are `dimmed` and
cannot be picked, so the dialog cannot make a cycle.

## Drag onto a folder

```
| Projects > Brackets                                      |
| #[F] Steel           2 items                           # |  <- target
|   Motor mount  (dragged)                                 |
```

A row dragged over a folder row or breadcrumb segment gives it a static 2 px
`accent` border (8.30 on `bg2`). Release moves at once, since another move
undoes it. Its own folder or a descendant shows no target. Move to is the
keyboard and single-pointer alternative (WCAG 2.5.7).

## Empty, loading, failed and delete

```
| Projects > Enclosures                                    |
| This folder is empty. Drag a project here or Move to.    |
```

- Empty root: `No projects yet`, as today. Loading: `Loading projects...`.
  Failed: `error-banner` with `Projects did not load: <reason>.` and Retry.
- A project keeps today's `Delete project "Motor mount"?` confirm; an empty
  folder confirms `Delete folder "Enclosures"?`. A folder with items does not
  delete: `Folder "Brackets" is not empty. Move or delete its 3 items first.`
  shows in the `error-banner`, as it does for the server's 409.

## Sort and filter

- Sort is a `tb-select`: Modified (newest first, today's order and the
  default) or Name (A to Z, numeric aware). Folders have no date, so they
  always sort by name, above projects.
- The filter matches names case-insensitively across the whole tree. Hits
  list flat with their folder as the meta line, `in Brackets > Steel`. No hit:
  `No project or folder matches "zz".` Esc clears it. Neither is saved.

## URL

BUG-028 gave projects `/projects/<id>`. Folders get `/folders/<id>`; `/` stays
the root. An id, not a name path, so renames and moves never break a link.
Project URLs stay folder-free, so a moved project keeps its link. Back to
projects returns to the project's folder. An unknown folder id shows the root
with `Folder not found.` The `server/src/app.ts` catch-all already serves it.

## Storage

Recommended, as DEC-406 says: one `folders.json` through `JsonStore`
(namespace `folders`, version 1) holding `folders` as `{id, name, parentId}`
and `placement` from project id to folder id. A project missing from
`placement`, or placed in a missing folder, sits at the root. A move is one
atomic write. Documents and `modifiedAt` stay untouched, so a move is not an
edit and needs no schema migration or backup. Empty folders need no stand-in
project. Rejected:

- `folderId` in each document: a migrated shape change, and each move
  rewrites the document and lifts it to the top of Modified.
- A field in the DOC-022 `project.json`: the tree gets two owners. Both field
  options still need a file for empty folders.
- Real directories: break `projects/<id>` and its id check, and a move becomes
  a directory rename on the DEC-301 share mount.

## Shared or per user

Recommended: one shared tree. The target is up to three collaborators on the
same parts, so a project has one place and "it is in Brackets" means the same
to everyone. Per-user trees need a placement per user per project and a rule
for where a newly shared project lands. After AUTH-020 every user sees every
folder, and only the projects AUTH-019 lets them open. Any signed-in user
creates, renames and deletes empty folders; moving a project passes the
AUTH-019 guard. Named risk: folder names show to every user, and a folder can
look empty to one user yet refuse to delete.

## Questions for Mark

Each is recommended yes.

1. One shared tree in `folders.json`, documents untouched?
2. Delete only empty folders? There is no trash, and a recursive delete could
   remove another user's projects.
3. Approve the breadcrumb and drag to move as new patterns?
4. Folders get `/folders/<id>`, and Back to projects returns there?
5. The filter searches the whole tree, not only the current folder?
6. Any signed-in user manages folders, not only admins?
