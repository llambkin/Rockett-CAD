# Interop readers

DEC-205 checks our exports with readers we did not write. They are dev tools
and never ship: the production image installs with `--omit=dev`, and no npm
script runs the container.

```sh
scripts/interop-check <step|3mf|glb|dxf> <file>
```

It prints one JSON line with `format`, `reader`, `version`, `ok` and the
reader's own counts and messages. Exit 0 means read and accepted, 1 means
rejected, 2 means a usage or runtime error.

## Readers

| Format | Reader                                         | Version        | Pin                                     |
| ------ | ---------------------------------------------- | -------------- | --------------------------------------- |
| GLB    | `gltf-validator`, run by Node on the host      | 2.0.0-dev.3.10 | exact root devDependency, no deps       |
| STEP   | `STEPControl_Reader` from `cadquery-ocp-novtk` | 8.0.1.0.0      | wheel sha256 in `scripts/interop-check` |
| 3MF    | `lib3mf`, strict mode                          | 2.5.0          | wheel sha256                            |
| DXF    | `ezdxf.readfile` then `audit()`                | 1.4.4          | wheel sha256                            |

STEP counts as accepted when `ReadFile` returns `RetDone`, every root
transfers, there is at least one solid and `BRepCheck_Analyzer` finds the
shape valid. 3MF needs no strict-mode warning and every mesh object passing
lib3mf's `IsManifoldAndOriented`. DXF needs an audit with no errors. GLB needs
zero validator errors.

## Image

Base: `python:3.13-slim-trixie`, linux/amd64 manifest
`sha256:37134a49d21d2120e4c4d73bb76f8a4ab9aef31f096f7ec2ead48c2feead4332`
(index `sha256:8d9d0b8bcf6506481eae4907c18f5e3e7902e629f5f6d684f9e7c32e85e3ddf0`).

The script builds `rockett-interop:<hash of its Containerfile>` on first use;
only the build touches the network. `pip install --require-hashes --no-deps`
installs the three readers and five packages they import: numpy, pyparsing,
typing-extensions and fonttools for ezdxf, and `cadquery-ocp-proxy`. OCP links
`libGL`, `libX11` and `libexpat`, so eight Debian trixie packages come from
snapshot `20260922T000000Z`, each checked against its sha256 and unpacked
with `dpkg-deb -x`. A plain `apt-get install libgl1` would pull Mesa and LLVM.

Readers run with `--network none`, a read-only root, no capabilities and
uid 65534. The file goes in on stdin, so nothing on the host is mounted.

`cadquery-ocp-novtk` replaces the `cadquery-ocp` named in DEC-205. It is the
same OCP 8.0.1 build without VTK: `cadquery-ocp` 8.0.1.0.0 requires
`vtk==9.6.2` (a 146 MB wheel that requires matplotlib) and its module fails to
import without it.

## Evidence

`server/test/fixtures/interop/` holds:

| File                | Written by                                                                           |
| ------------------- | ------------------------------------------------------------------------------------ |
| `box.3mf`           | `write3mf` in `server/test/export.test.ts`                                           |
| `xde-assembly.step` | `STEPCAFControl_Writer` in `server/test/xdeProbe.test.ts`                            |
| `xde-assembly.glb`  | `RWGltf_CafWriter` in `server/test/xdeProbe.test.ts`                                 |
| `reference-box.3mf` | lib3mf 2.5.0 in the reader image, welded 20 x 20 x 10 mm box                         |
| `reference-r12.dxf` | ezdxf 1.4.4 in the reader image: R12 lines, arc, circle, point, `CONSTRUCTION` layer |

The first three are compared with a fresh export on every `npm test`,
ignoring the STEP `FILE_NAME` record and comparing 3MF zip entries rather
than zip bytes. Refresh them after a deliberate exporter change:

```sh
INTEROP_UPDATE=1 npx vitest run --project node server/test/export.test.ts server/test/xdeProbe.test.ts
```

The two reference files are reader-written known-good samples.

## Results, 2026-09-23

| File                | Verdict  | Reader output                                                                               |
| ------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `xde-assembly.step` | accepted | 758 entities, 1 root, 3 valid solids, volume 12125 mm3                                      |
| `xde-assembly.glb`  | accepted | 0 errors, 0 warnings, 2 materials, 36 triangles                                             |
| `reference-box.3mf` | accepted | 1 object, 8 vertices, 12 triangles, manifold                                                |
| `reference-r12.dxf` | accepted | AC1009, 2 LINE, 1 ARC, 1 CIRCLE, 1 POINT, no audit errors                                   |
| `box.3mf`           | rejected | no strict-mode warning, but `MainBody` has 24 vertices for 12 triangles and is not manifold |

`write3mf` writes each B-Rep face's vertices separately, so edges between
faces are not shared. Each file truncated to half its length is rejected: STEP
`RetFail`, 3MF `Could not read ZIP file`, GLB
`GLB_UNEXPECTED_END_OF_CHUNK_DATA`, DXF `StopIteration`.
