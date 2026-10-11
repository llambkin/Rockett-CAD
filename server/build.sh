#!/bin/sh
set -eu

outdir=dist
for argument in "$@"; do
    case "$argument" in
        --outdir=*) outdir=${argument#--outdir=} ;;
    esac
done

jobs=
bundles=
for entry in ../modules/*/kernel.ts; do
    [ -f "$entry" ] || continue
    name=${entry#../modules/}
    name=${name%/kernel.ts}
    jobs="$jobs $name.kernel=$entry"
    bundles="$bundles${bundles:+,}\"rockett.$name\":\"./$name.kernel.mjs\""
done

esbuild server=src/index.ts kernel-worker=src/kernel/worker.ts $jobs --bundle --platform=node --format=esm --outdir="$outdir" --out-extension:.js=.mjs --external:opencascade.js --external:express --external:multer --external:fflate --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" --define:BLEND_WASM_URL='"./blend.wasm"' --loader:.wasm=dataurl --define:KERNEL_BUNDLES="{$bundles}" "$@"
cp ../modules/kernel/blend/blend.wasm "$outdir/blend.wasm"
