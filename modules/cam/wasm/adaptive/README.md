# adaptive.wasm

`adaptive.wasm` is FreeCAD's adaptive clearing engine built to WebAssembly
(DEC-618). `modules/cam/src/toolpath/adaptiveEngine.ts` loads it and exports
`adaptiveClear`, its only entry point. Any build that keeps the `adaptive`
export and its number layout in `entry.cpp` can replace the file without
rebuilding Rockett CAD.

## Licence

`THIRD-PARTY-NOTICES.md` at the repository root owns the licences,
copyright holders and source obligations of `adaptive.wasm`.

## Source

Every file under `freecad/` is byte for byte the file at the same path in
https://github.com/FreeCAD/FreeCAD at commit
`c1d008a9fcf4fd66644852c5d334d22aedd62921`. Only the files the build needs
are kept. `SHA256SUMS` records each file and the built `adaptive.wasm`.

## Build

`./build.sh` needs Podman, and network access only to pull the image. It
checks the sources against `SHA256SUMS`, compiles them with the pinned
Emscripten image in a container with no network, and checks the new
`adaptive.wasm` against the recorded sum.

The build targets wasm64 (`-m64`). The engine stores scaled coordinates in C
`long`, which is 32 bits in wasm32 and overflows on parts a few hundred
millimetres from the origin at fine tolerance.
