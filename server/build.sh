#!/bin/sh
set -eu

outdir=dist
for argument in "$@"; do
    case "$argument" in
        --outdir=*) outdir=${argument#--outdir=} ;;
    esac
done

esbuild server=src/index.ts kernel-worker=src/kernel/worker.ts --bundle --platform=node --format=esm --outdir="$outdir" --out-extension:.js=.mjs --external:opencascade.js --external:express --external:multer --external:fflate --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" --define:BLEND_WASM_URL='"./blend.wasm"' "$@"
cp ../modules/kernel/blend/blend.wasm "$outdir/blend.wasm"
