#!/bin/sh
set -eu

image=docker.io/emscripten/emsdk:6.0.10@sha256:e077d54e2b8970575ebc4f185ac1de0b95c05f2b266134d4ba27449af7aebf65
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
cd "$here"

grep -v ' adaptive.wasm$' SHA256SUMS | sha256sum --quiet -c -

output=$(mktemp adaptive.wasm.XXXXXX)
trap 'rm -f -- "$output"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

tar -cf - entry.cpp freecad/src |
    podman run --rm -i --network=none --pull=never "$image" sh -eu -c '
mkdir -p /build/include/clipper2
cd /build
tar -xf -
libarea=freecad/src/Mod/CAM/libarea
clipper2=freecad/src/3rdParty/Clipper2
sed "s|@PROJECT_VERSION@|2.0.1|" $clipper2/clipper.version.in >include/clipper2/clipper.version.h
em++ -O2 -std=c++20 -DUSINGZ -DCLIPPER2_MAX_DECIMAL_PRECISION=8 \
    -I$libarea -I$clipper2/Clipper2Lib/include -Iinclude \
    -m64 -sSTANDALONE_WASM --no-entry \
    -sEXPORTED_FUNCTIONS=_adaptive,_malloc \
    -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=1gb \
    entry.cpp $libarea/Adaptive.cpp $libarea/clipper.cpp \
    $clipper2/Clipper2Lib/src/clipper.engine.cpp \
    $clipper2/Clipper2Lib/src/clipper.offset.cpp \
    -o adaptive.wasm >&2
cat adaptive.wasm
' >"$output"

sed "s/ adaptive.wasm$/ $output/" SHA256SUMS | sha256sum -c -
chmod 644 "$output"
mv -f -- "$output" adaptive.wasm
