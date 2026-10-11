# Reference source

Hand-written KiCad 9 board and inline fixture footprints. No KiCad library
footprints or models are copied. Licence: UNLICENSED, pending the project's
licence decision. This preparation adds no redistribution grant.

The two STEP models came from Rockett's named STEP exporter. Each is a
scalene triangular prism, in mm. Only trailing line whitespace was removed
from the STEP exports:

| Model           | XY vertices         | Height | Volume |
| --------------- | ------------------- | ------ | ------ |
| fixture-wedge-a | (0,0), (8,0), (1,3) | 2      | 24 mm³ |
| fixture-wedge-b | (0,0), (5,0), (0,2) | 4      | 20 mm³ |

Grammar, layers and model fields follow the
[KiCad 9 writer](https://github.com/KiCad/kicad-source-mirror/blob/286b0611feca00727bf70bfa184ec2c28a745dc3/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.cpp)
and [layer IDs](https://github.com/KiCad/kicad-source-mirror/blob/286b0611feca00727bf70bfa184ec2c28a745dc3/include/layer_ids.h).
The oracle script pins the official image digests from Docker Hub's
[9.0.9 metadata](https://hub.docker.com/v2/repositories/kicad/kicad/tags/9.0.9)
and [10.0.6 metadata](https://hub.docker.com/v2/repositories/kicad/kicad/tags/10.0.6).
The [KiCad 10 upgrade command](https://github.com/KiCad/kicad-source-mirror/blob/caf7377e9cb6fa1535ec3596dcb8c99bf44a996e/kicad/cli/command_pcb_upgrade.cpp)
rewrites only the copied board.

No KiCad oracle has qualified these inputs. After operator approval, preload
the pinned images separately, then run `sh scripts/make-kicad-fixtures.sh`
from the repository root with an optional new output directory. It refuses
existing outputs, never pulls images, uses absolute export origin `(0,0)`
and includes DNP models. KiCad 10 copies these inputs before upgrading.
The script's `--dry-run` prints both commands without writing files or
running Docker. Independent board and STEP checks belong to qualification.
