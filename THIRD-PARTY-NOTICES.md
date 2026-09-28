# Third-party notices

Rockett CAD ships third-party code in two artefacts: the Docker image and the
client bundle the image serves. The table lists each package with its exact
version, the licence its installed `package.json` states, where it ships and
its upstream. `scripts/check-notices.sh` compares the table with
`npm ls --omit=dev --all --parseable` and the installed packages, fails when
a `.wasm` under `modules/` has no section here, and `npm run check` runs it.

This file covers third-party code only. Rockett CAD's own licence is not set
yet.

## opencascade.js

`opencascade.js` `2.0.0-msegec.occt801.2` is the WebAssembly build of Open
CASCADE Technology 8.0.1, licensed LGPL-2.1-only. It is built from the fork at
https://github.com/msegec/opencascade.js.

- The corresponding source is the fork's tagged commit
  `v2.0.0-msegec.occt801.2`. Its `Dockerfile` builds this package from OCCT
  tag `V8_0_1` and applies the explicit planar fold patch.
- The image installs the release asset that `server/package.json` pins with
  `npm ci`. Its licence text ships beside it in
  `node_modules/opencascade.js/LICENSE`.
- The server bundle leaves it external and loads
  `opencascade.js/dist/node.js` at runtime. Swapping
  `node_modules/opencascade.js/dist` for a compatible build replaces the
  library without rebuilding Rockett CAD.
- Rockett CAD is for intranet use only and is not distributed.

## adaptive.wasm

`modules/cam/wasm/adaptive/adaptive.wasm` is FreeCAD's adaptive clearing
engine built to WebAssembly. As a whole it is LGPL-2.1-or-later. It links:

- FreeCAD `src/Mod/CAM/libarea/Adaptive.cpp`, LGPL-2.1-or-later, Copyright
  2018 Kresimir Tusek. https://github.com/FreeCAD/FreeCAD at commit
  `c1d008a9fcf4fd66644852c5d334d22aedd62921`.
- Clipper 6.4.2 from the same FreeCAD path, BSL-1.0, Copyright 2010-2017
  Angus Johnson. http://www.angusj.com
- Clipper2 2.0.1 as FreeCAD vendors it in `src/3rdParty/Clipper2` at the same
  commit, BSL-1.0, Copyright 2010-2025 Angus Johnson.
  https://github.com/AngusJohnson/Clipper2
- `entry.cpp`, the glue this repository adds, offered under
  LGPL-2.1-or-later.

The licence texts ship beside it in `freecad/LICENSE` and
`freecad/src/3rdParty/Clipper2/LICENSE`.

- The corresponding source is `modules/cam/wasm/adaptive/` at the commit that
  ships the file. Its `README.md` and `build.sh` rebuild it, and
  `SHA256SUMS` ties every upstream file and the built file to the commit
  above. The README also says what a replacement build must keep.
- This public repository carries the file with its source. The image and the
  client bundle do not carry it yet.

## Before distribution

Distribution is not approved. Confirm these obligations first:

- LGPL-2.1 section 6: accompany the image with the corresponding source of
  the exact `opencascade.js` build, or a written offer of it. An artefact
  that carries `adaptive.wasm` does the same with its directory.
- The client and CAM bundles are minified without licence comments, and the
  image carries neither this file nor the licence texts of the bundled
  packages. Copy both into the image. Each image package keeps its own
  licence file under `node_modules`.
- The base image `node:24-trixie-slim` carries Node.js and Debian packages
  under their own licences. This table does not inventory them.

## Packages

`image` means the runtime `npm ci --omit=dev --workspace server` installs it.
`client bundle` means Vite bundles its code into the client build output. A
`build helper` is Vite or Rolldown runtime code that the build emits into the
bundle. `CAM bundles` means only the bundles built from `modules/cam` carry
its code; the image's `npm ci` does not install it, and nothing builds those
bundles before CAM-002. `none (types only)` packages appear in `npm ls` as
peers but ship in no artefact.

| Package                 | Version                | Licence       | Ships in                     | Upstream                                             |
| ----------------------- | ---------------------- | ------------- | ---------------------------- | ---------------------------------------------------- |
| @types/react            | 19.3.0                 | MIT           | none (types only)            | https://github.com/DefinitelyTyped/DefinitelyTyped   |
| accepts                 | 2.0.0                  | MIT           | image                        | https://github.com/jshttp/accepts                    |
| append-field            | 1.0.0                  | MIT           | image                        | https://github.com/LinusU/node-append-field          |
| body-parser             | 2.3.0                  | MIT           | image                        | https://github.com/expressjs/body-parser             |
| busboy                  | 1.6.0                  | MIT           | image                        | https://github.com/mscdex/busboy                     |
| bytes                   | 3.1.2                  | MIT           | image                        | https://github.com/visionmedia/bytes.js              |
| call-bind-apply-helpers | 1.0.2                  | MIT           | image                        | https://github.com/ljharb/call-bind-apply-helpers    |
| call-bound              | 1.0.4                  | MIT           | image                        | https://github.com/ljharb/call-bound                 |
| clipper2-ts             | 2.0.1-18               | BSL-1.0       | CAM bundles                  | https://github.com/countertype/clipper2-ts           |
| content-disposition     | 1.1.0                  | MIT           | image                        | https://github.com/jshttp/content-disposition        |
| content-type            | 1.0.5                  | MIT           | image                        | https://github.com/jshttp/content-type               |
| content-type            | 2.1.0                  | MIT           | image                        | https://github.com/jshttp/content-type               |
| cookie                  | 0.7.2                  | MIT           | image                        | https://github.com/jshttp/cookie                     |
| cookie-signature        | 1.2.2                  | MIT           | image                        | https://github.com/visionmedia/node-cookie-signature |
| csstype                 | 3.2.3                  | MIT           | none (types only)            | https://github.com/frenic/csstype                    |
| debug                   | 4.4.3                  | MIT           | image                        | https://github.com/debug-js/debug                    |
| depd                    | 2.0.0                  | MIT           | image                        | https://github.com/dougwilson/nodejs-depd            |
| dunder-proto            | 1.0.1                  | MIT           | image                        | https://github.com/es-shims/dunder-proto             |
| ee-first                | 1.1.1                  | MIT           | image                        | https://github.com/jonathanong/ee-first              |
| encodeurl               | 2.0.0                  | MIT           | image                        | https://github.com/pillarjs/encodeurl                |
| es-define-property      | 1.0.1                  | MIT           | image                        | https://github.com/ljharb/es-define-property         |
| es-errors               | 1.3.0                  | MIT           | image                        | https://github.com/ljharb/es-errors                  |
| es-object-atoms         | 1.1.2                  | MIT           | image                        | https://github.com/ljharb/es-object-atoms            |
| escape-html             | 1.0.3                  | MIT           | image                        | https://github.com/component/escape-html             |
| etag                    | 1.8.1                  | MIT           | image                        | https://github.com/jshttp/etag                       |
| express                 | 5.2.1                  | MIT           | image                        | https://github.com/expressjs/express                 |
| fflate                  | 0.8.3                  | MIT           | image                        | https://github.com/101arrowz/fflate                  |
| finalhandler            | 2.1.1                  | MIT           | image                        | https://github.com/pillarjs/finalhandler             |
| forwarded               | 0.2.0                  | MIT           | image                        | https://github.com/jshttp/forwarded                  |
| fresh                   | 2.0.0                  | MIT           | image                        | https://github.com/jshttp/fresh                      |
| function-bind           | 1.1.2                  | MIT           | image                        | https://github.com/Raynos/function-bind              |
| get-intrinsic           | 1.3.0                  | MIT           | image                        | https://github.com/ljharb/get-intrinsic              |
| get-proto               | 1.0.1                  | MIT           | image                        | https://github.com/ljharb/get-proto                  |
| gopd                    | 1.2.0                  | MIT           | image                        | https://github.com/ljharb/gopd                       |
| has-symbols             | 1.1.0                  | MIT           | image                        | https://github.com/inspect-js/has-symbols            |
| hasown                  | 2.0.4                  | MIT           | image                        | https://github.com/inspect-js/hasOwn                 |
| http-errors             | 2.0.1                  | MIT           | image                        | https://github.com/jshttp/http-errors                |
| iconv-lite              | 0.7.3                  | MIT           | image                        | https://github.com/pillarjs/iconv-lite               |
| inherits                | 2.0.4                  | ISC           | image                        | https://github.com/isaacs/inherits                   |
| ipaddr.js               | 1.9.1                  | MIT           | image                        | https://github.com/whitequark/ipaddr.js              |
| is-promise              | 4.0.0                  | MIT           | image                        | https://github.com/then/is-promise                   |
| math-intrinsics         | 1.1.0                  | MIT           | image                        | https://github.com/es-shims/math-intrinsics          |
| media-typer             | 0.3.0                  | MIT           | image                        | https://github.com/jshttp/media-typer                |
| media-typer             | 1.1.1                  | MIT           | image                        | https://github.com/jshttp/media-typer                |
| merge-descriptors       | 2.0.0                  | MIT           | image                        | https://github.com/sindresorhus/merge-descriptors    |
| mime-db                 | 1.52.0                 | MIT           | image                        | https://github.com/jshttp/mime-db                    |
| mime-db                 | 1.54.0                 | MIT           | image                        | https://github.com/jshttp/mime-db                    |
| mime-types              | 2.1.35                 | MIT           | image                        | https://github.com/jshttp/mime-types                 |
| mime-types              | 3.0.2                  | MIT           | image                        | https://github.com/jshttp/mime-types                 |
| ms                      | 2.1.3                  | MIT           | image                        | https://github.com/vercel/ms                         |
| multer                  | 2.4.0                  | MIT           | image                        | https://github.com/expressjs/multer                  |
| negotiator              | 1.1.0                  | MIT           | image                        | https://github.com/jshttp/negotiator                 |
| object-inspect          | 1.13.4                 | MIT           | image                        | https://github.com/inspect-js/object-inspect         |
| on-finished             | 2.4.1                  | MIT           | image                        | https://github.com/jshttp/on-finished                |
| once                    | 1.4.0                  | ISC           | image                        | https://github.com/isaacs/once                       |
| opencascade.js          | 2.0.0-msegec.occt801.2 | LGPL-2.1-only | image                        | https://github.com/msegec/opencascade.js             |
| parseurl                | 1.3.3                  | MIT           | image                        | https://github.com/pillarjs/parseurl                 |
| path-to-regexp          | 8.4.2                  | MIT           | image                        | https://github.com/pillarjs/path-to-regexp           |
| proxy-addr              | 2.0.8                  | MIT           | image                        | https://github.com/jshttp/proxy-addr                 |
| qs                      | 6.16.0                 | BSD-3-Clause  | image                        | https://github.com/ljharb/qs                         |
| range-parser            | 1.3.0                  | MIT           | image                        | https://github.com/jshttp/range-parser               |
| raw-body                | 3.0.2                  | MIT           | image                        | https://github.com/stream-utils/raw-body             |
| react                   | 19.3.0                 | MIT           | client bundle                | https://github.com/react/react                       |
| react-dom               | 19.3.0                 | MIT           | client bundle                | https://github.com/react/react                       |
| rolldown                | 1.2.9                  | MIT           | client bundle (build helper) | https://github.com/rolldown/rolldown                 |
| router                  | 2.2.0                  | MIT           | image                        | https://github.com/pillarjs/router                   |
| safer-buffer            | 2.1.2                  | MIT           | image                        | https://github.com/ChALkeR/safer-buffer              |
| scheduler               | 0.28.0                 | MIT           | client bundle                | https://github.com/react/react                       |
| send                    | 1.2.1                  | MIT           | image                        | https://github.com/pillarjs/send                     |
| serve-static            | 2.2.1                  | MIT           | image                        | https://github.com/expressjs/serve-static            |
| setprototypeof          | 1.2.0                  | ISC           | image                        | https://github.com/wesleytodd/setprototypeof         |
| side-channel            | 1.1.1                  | MIT           | image                        | https://github.com/ljharb/side-channel               |
| side-channel-list       | 1.0.1                  | MIT           | image                        | https://github.com/ljharb/side-channel-list          |
| side-channel-map        | 1.0.1                  | MIT           | image                        | https://github.com/ljharb/side-channel-map           |
| side-channel-weakmap    | 1.0.2                  | MIT           | image                        | https://github.com/ljharb/side-channel-weakmap       |
| statuses                | 2.0.2                  | MIT           | image                        | https://github.com/jshttp/statuses                   |
| streamsearch            | 1.1.0                  | MIT           | image                        | https://github.com/mscdex/streamsearch               |
| three                   | 0.186.0                | MIT           | client bundle                | https://github.com/mrdoob/three.js                   |
| toidentifier            | 1.0.1                  | MIT           | image                        | https://github.com/component/toidentifier            |
| type-is                 | 1.6.18                 | MIT           | image                        | https://github.com/jshttp/type-is                    |
| type-is                 | 2.1.0                  | MIT           | image                        | https://github.com/jshttp/type-is                    |
| typebox                 | 1.3.34                 | MIT           | image and client bundle      | https://github.com/sinclairzx81/typebox              |
| unpipe                  | 1.0.0                  | MIT           | image                        | https://github.com/stream-utils/unpipe               |
| vary                    | 1.1.2                  | MIT           | image                        | https://github.com/jshttp/vary                       |
| vite                    | 8.3.0                  | MIT           | client bundle (build helper) | https://github.com/vitejs/vite                       |
| wrappy                  | 1.0.2                  | ISC           | image                        | https://github.com/npm/wrappy                        |
| ws                      | 8.21.3                 | MIT           | image                        | https://github.com/websockets/ws                     |
| zustand                 | 5.0.15                 | MIT           | client bundle                | https://github.com/pmndrs/zustand                    |
