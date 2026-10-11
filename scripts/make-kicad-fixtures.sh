#!/bin/sh
set -eu

dry_run=false
if [ "${1:-}" = --dry-run ]; then
  dry_run=true
  shift
fi
argument=${1:-}
if [ "$#" -gt 1 ] || [ "${argument#-}" != "$argument" ]; then
  printf '%s\n' 'Usage: make-kicad-fixtures.sh [--dry-run] [new-output-directory]' >&2
  exit 2
fi
physical_dir() {
  CDPATH= cd -P -- "$1" && pwd -P
}
root=$(physical_dir "$(dirname -- "$0")/..")
source=$(physical_dir "$root/modules/kicad/test/fixtures/reference/source")
output=${1:-"$root/modules/kicad/test/fixtures/reference/oracle"}
output_parent=$(physical_dir "$(dirname -- "$output")")
output="$output_parent/$(basename -- "$output")"
if [ -d "$output" ]; then
  output=$(physical_dir "$output")
fi
case "$output" in
  "$source"|"$source/"*)
    printf '%s\n' 'Output directory must be outside the source fixture.' >&2
    exit 2
    ;;
esac
image9=docker.io/kicad/kicad@sha256:e638b79b0321f29395a5b783e94bb9f3c73303e8da15da27b8f5cb4b67a37729
image10=docker.io/kicad/kicad@sha256:18693567392b80da435f9fa952ce3a3e534c66eb5a6033f5b9c80aa3b19dd3ec
run() {
  if "$dry_run"; then
    for arg do
      printf "'%s' " "$(printf '%s' "$arg" | sed "s/'/'\\\\''/g")"
    done
    printf '\n'
  else
    "$@"
  fi
}
if ! "$dry_run"; then
  if [ -e "$output" ] || [ -L "$output" ]; then
    printf '%s\n' 'Output directory already exists; choose a new directory.' >&2
    exit 2
  fi
  command -v docker >/dev/null
  mkdir -- "$output"
  output=$(physical_dir "$output")
fi
run docker run --rm --pull never --network none --user "$(id -u):$(id -g)" \
  --env HOME=/tmp --env XDG_CONFIG_HOME=/tmp/config \
  --mount "type=bind,src=$source,dst=/source,readonly" \
  --mount "type=bind,src=$output,dst=/out" --entrypoint /bin/sh "$image9" -ec \
  'mkdir /out/kicad9; kicad-cli pcb export step --user-origin 0x0mm --output /out/kicad9/reference.step /source/reference.kicad_pcb'
run docker run --rm --pull never --network none --user "$(id -u):$(id -g)" \
  --env HOME=/tmp --env XDG_CONFIG_HOME=/tmp/config \
  --mount "type=bind,src=$source,dst=/source,readonly" \
  --mount "type=bind,src=$output,dst=/out" --entrypoint /bin/sh "$image10" -ec \
  'mkdir /out/kicad10; cp -R /source/. /out/kicad10/; kicad-cli pcb upgrade --force /out/kicad10/reference.kicad_pcb; kicad-cli pcb export step --user-origin 0x0mm --output /out/kicad10/reference.step /out/kicad10/reference.kicad_pcb'
