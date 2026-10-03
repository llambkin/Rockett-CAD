# blend.wasm

`blend.wasm` is Rockett CAD's own blend surface module (KERN-020).
`server/src/geometry/blendModule.ts` compiles it once per process, runs each
call in a fresh instance and turns a trap into a plain error.

`fillet_planes` takes a straight edge, the outward normal of each plane
beside it and the direction from the edge into each plane, and a radius. It
returns the exact centre and contact points of the fillet section at both
ends, or declines a concave edge, a flat or knife fold, and an edge that does
not lie in both planes. A number that is not finite traps.

## Licence

`THIRD-PARTY-NOTICES.md` at the repository root owns the notice for the
toolchain code linked into `blend.wasm`.

## Build

`./build.sh` needs Podman, and network access only to pull the image. It
checks `entry.cpp` against `SHA256SUMS`, compiles it with the pinned
Emscripten image in a container with no network, and checks the new
`blend.wasm` against the recorded sum.
