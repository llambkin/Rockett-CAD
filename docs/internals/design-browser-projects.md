# Projects kept in the browser

Status: proposal awaiting Mark's approval under DEC-407. The implementation
rows are written from the approved design. Colours are the SET-023 graded
greys in `design-settings.md`. It sits beside the DEC-406 folders in
`design-projects.md` and reuses their folder row, breadcrumb, Move to and drag,
plus the DEC-004 `project-row`, `error-banner` and today's `window.confirm`
delete prompt. It adds no new pattern.

A browser project is the EXCH-013 `.rockett` file held in IndexedDB instead
of on the server. Geometry still runs on the server, so it opens only while
the server is reachable, and the server holds a full copy while it is open.
It is not an offline or private mode, which would need a second kernel in the
browser. It keeps a project off the shared list and off the server between
sessions.

## Where they show

```
| Projects                                                 |
| [ Filter by name...          ]   Sort [ Modified  v ]    |
| [B] This browser     2 projects                          |
| [F] Brackets         3 items           (e) (m) (x)       |
| Gearbox lid                        (e) (c) (d) (m) (x)   |
|   31 features . 22/09/2026 09:40                         |

| Projects > This browser                                  |
| Kept until you clear this site's data. 3.4 MB used.      |
| Motor mount                        (e) (c) (d) (m) (x)   |
|   12 features . 23/09/2026 10:14 . 1.2 MB                |
[B] browser glyph   (d) download   other keys as design-projects.md
```

- This browser is a folder row pinned first at the root, with no actions. It
  opens `/browser`; a browser project opens `/browser/<key>`, where the key
  names the IndexedDB record. It holds projects only, flat.
- A row shows its location by its folder, as DEC-406 does. Filter hits from
  this browser read `in This browser`. Rows add their stored size.
- The storage line is `text-dim` (9.38 on `bg1`) once `persist()` is
  granted. Otherwise it is `warn` (9.36) and reads
  `The browser may delete these when space runs low. Download a copy.`, or
  over plain HTTP `This browser cannot keep these safe. Download a copy.`
- Rename, Duplicate, Download and Delete work on the record and never call
  the server. Delete keeps today's confirm.

## Moving between this browser and the server

```
+-- Move "Gearbox lid" --------------------- x --+
|  Projects                                      |
|    Brackets                     (here)         |  <- dimmed
|    Enclosures                                  |
|  This browser                                  |  <- selected
|                                [Move] [Cancel] |
+------------------------------------------------+
```

The DEC-406 Move to dialog gains This browser as a second root, and drag onto
its row works too, so no separate menu items are needed. A folder cannot move
there. A move into this browser always confirms, since another move does not
undo it:

`Move "Gearbox lid" to this browser? Other users lose access, and clearing
this site's data deletes it.`

- To the browser: `GET /projects/:id/file`, one IndexedDB transaction writes
  the record, then `DELETE /projects/:id`. Never delete first.
- To the server: `POST /projects/file` with a new optional `folderId`, then
  the record is deleted. No confirm: the project is safer there.
- The source is removed, since Download already makes a copy. If removing it
  fails, both copies stay and the `error-banner` names the copy left behind:
  `"Gearbox lid" is in this browser, but the server copy was not removed.`
- After AUTH-019 only the owner or an admin moves a server project out, as
  only they may delete it. Named risk: a member with it open gets a 404 on
  the next edit, as with a delete today.
- Each move gives a new id, so old links show not found.

## Opening

1. `POST /projects/file` with `temporary: true` makes a temporary server
   copy: an ordinary project directory plus a `temporary.json` marker,
   `{ owner, touchedAt }`. `GET /projects`, folders and DOC-006 backups skip
   it. The AUTH-019 guard admits only the opener.
2. The workbench runs against the temporary id unchanged. Every request to
   it updates `touchedAt`.
3. After each mutating response the client writes `document` into the record
   in one transaction. A new reference image goes in as a Blob with the first
   document that uses it; unreferenced assets drop. Blobs take a quarter less
   space than base64. Refetching the file after each edit would resend every
   asset.
4. Back to projects deletes the copy. `pagehide` sends the same `DELETE` with
   `keepalive`, best effort.
5. A sweep at startup and hourly deletes copies untouched for 24 hours. A tab
   that returns later gets a 404, recreates the copy from the record once and
   reloads; the edit that met the 404 is lost. A second 404 shows the
   `error-banner`.

The record is the truth; the server copy is a cache. A failed write, such as
`QuotaExceededError`, shows `Not saved in this browser: <reason>.` with a
Download button that reads the server copy, and each later edit retries.
Leaving then confirms `Changes not saved in this browser will be lost.`

Named risk: every open uploads the whole file, and the upload limit is 64 MB.
The client refuses an image that would take the file past it, or the project
could never open again.

## Eviction

- IndexedDB is best effort by default. Under storage pressure a browser may
  delete the whole site's data; Safari can after seven days without a visit.
  Clearing site data always deletes it.
- The first move to this browser calls `navigator.storage.persist()`. Chrome
  grants or refuses silently; Firefox asks. The storage line shows the result,
  with usage from `navigator.storage.estimate()`.
- `navigator.storage` exists only in a secure context, HTTPS or localhost.
  Over plain HTTP on a LAN, IndexedDB works but cannot ask to be kept.
- Storage is per origin. Another host name or port for the same server has
  an empty list. Named risk: a changed address looks like data loss.
- No server backup covers browser projects. Download is the backup.

## A second tab or browser

- Another tab sees the same list and rereads it when it regains focus.
- Two tabs may open one project, each with its own server copy. Each record
  carries `revision`; a write checks it is unchanged since this tab's last
  write and bumps it, in one transaction. A refused tab stops writing, shows
  `"Motor mount" changed in another tab. Reload to continue.` and loses at
  most its last edit. Web Locks would need a secure context, so they are
  rejected.
- Another browser, profile or computer sees none of it, nor does any other
  user. A private window keeps its projects until it closes.
- Users signing in on one profile would share a list. Recommended: one
  database per user, `rockett-<userId>`. Not a security boundary.

## Questions for Mark

Each is recommended yes.

1. A move removes the source, and only after the destination confirms its
   write? Download already makes a copy.
2. Open through a temporary server copy, deleted on close and swept after 24
   hours idle, with the browser record as the truth?
3. This browser is one flat folder at the root, with no folders inside?
   Folders stay one shared tree.
4. A move into this browser always confirms, although other moves do not?
5. Allow browser projects over plain HTTP with the warning line, rather than
   hide them there? IndexedDB works; only keeping them safe is weaker.
6. One browser database per signed-in user once AUTH lands?
