#!/bin/sh
set -eu

image=docker.io/emscripten/emsdk:6.0.10@sha256:e077d54e2b8970575ebc4f185ac1de0b95c05f2b266134d4ba27449af7aebf65
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
cd "$here"

grep -v ' blend.wasm$' SHA256SUMS | sha256sum --quiet -c -

output=$(mktemp blend.wasm.XXXXXX)
trap 'rm -f -- "$output"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

tar -cf - entry.cpp |
    podman run --rm -i --network=none --pull=never "$image" sh -eu -c '
mkdir -p /build
cd /build
tar -xf -
em++ -O2 -std=c++20 -sSTANDALONE_WASM --no-entry \
    -sEXPORTED_FUNCTIONS=_fillet_planes,_fillet_section,_chamfer_section,_buffer \
    entry.cpp -o blend.wasm >&2
cat blend.wasm
' >"$output"

sed "s/ blend.wasm$/ $output/" SHA256SUMS | sha256sum -c -
chmod 644 "$output"
mv -f -- "$output" blend.wasm
