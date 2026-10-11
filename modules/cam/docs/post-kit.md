# Rockett post kit

This file is for an AI assistant. The user pastes it, then their current post processor, and asks for a Rockett post.

## Instruction to the assistant

Convert the post the user gives you into one Rockett declarative post.

1. Read the old post and find what it writes: units, arcs and their planes, canned cycles, tool change and tool length lines, spindle, coolant, dwell, stops, comments and number formats.
2. Write a JSON post that passes the JSON schema below and every rule in Rules the schema cannot state. Start from the GRBL example at the end and change only what the old post does differently.
3. Keep the old post's behaviour: its units words, its arc form (planes and incremental centres), its canned cycles or none, and its tool change and tool length lines.
4. Give the post an `id` and `label` for the user's machine.
5. Templates are data. Never put code, expressions, conditions or keys the schema does not list into the JSON.
6. Reply with the JSON post in one `json` code block, then a list headed "Cannot express" with one line for each behaviour of the old post this format has no place for, or "None". Write nothing else.
7. If Rockett refuses the import, the user pastes the refusal line back. Fix what it names and reply the same way with the whole corrected post.

Things this format cannot express include chip-breaking drilling (Fusion `chip-breaking`, G73), tapping (Fusion `tapping`, `left-tapping` and `right-tapping`, G84 and G74), boring and reaming (Fusion `boring`, `reaming` and their variants, G85 to G89 and G76), absolute arc centres (G90.1), probing, subprograms and macros, variables and expressions, conditional output, rotary axes, line numbers and manual tool length tables. List each one the old post uses under Cannot express.

## How a post works

Rockett plans toolpaths in mm, converts them to the output units, then writes each line from a template. A template is a list of lines. Each line is tokens separated by single spaces, and each token is one of:

- a word listed in `words`, as `G1` or `M30`;
- a whole word variable, `{units}`, `{offset}` or `{plane}`;
- an address letter and a variable, as `X{x}`, written with the letter's number format from `formats`.

A token whose variable has no value is left out, and a motion line with no axis left is not written. Each output file runs: Rockett's comment block, naming the program, kernel, post and input; the laser note, in a laser file; header; for each tool, toolChange and toolLength when tool change is on; for each section, the spindle and coolant lines, then its moves; footer. With tool change off, a new file starts at each change of tool, so tools A, B, A make three files. Rockett checks every line it writes against `words` and `formats`.

## Templates

Every template below is a key of `templates`, plus `comment`. A template uses only its own variables and must contain its required ones.

| Template | Required | Optional | May be [] | Called |
| --- | --- | --- | --- | --- |
| `header` | `{units}` `{offset}` | none | no | Once at the start of each file. |
| `footer` | none | none | no | Once at the end of each file. |
| `toolChange` | none | `{tool}` | when capabilities.toolChange is false | Before each tool when tool change is on. With it off, each run of one tool gets its own file. |
| `toolLength` | none | `{tool}` | yes | Right after toolChange. |
| `spindleCw` | `{rpm}` | none | no | At the start of each section that turns the spindle clockwise. |
| `spindleCcw` | `{rpm}` | none | no | At the start of each section that turns the spindle counterclockwise. |
| `spindleOff` | none | none | no | At the start of each section with no spindle. |
| `coolantFlood` | none | none | no | After the spindle line of a section with flood coolant. |
| `coolantMist` | none | none | no | After the spindle line of a section with mist coolant. |
| `coolantOff` | none | none | no | After the spindle line of a section with no coolant. |
| `rapid` | `{x}` `{y}` `{z}` | none | no | For each rapid move. |
| `linear` | `{x}` `{y}` `{z}` `{feed}` | `{power}` | no | For each feed move. |
| `arcCw` | `{x}` `{y}` `{z}` `{i}` `{j}` `{k}` `{feed}` `{plane}` | `{power}` | when capabilities.arcs is false | For each clockwise arc whose plane capabilities.arcs allows. The two axes in the arc's plane are always written. |
| `arcCcw` | `{x}` `{y}` `{z}` `{i}` `{j}` `{k}` `{feed}` `{plane}` | `{power}` | when capabilities.arcs is false | For each counterclockwise arc whose plane capabilities.arcs allows. The two axes in the arc's plane are always written. |
| `drill` | none | `{x}` `{y}` `{clear}` `{top}` `{bottom}` `{feed}` `{dwell}` | when capabilities.cycles is false | For each hole of a drilling cycle when capabilities.cycles is true. |
| `drillDwell` | none | `{x}` `{y}` `{clear}` `{top}` `{bottom}` `{feed}` `{dwell}` | yes | Instead of drill for a drilling cycle with a dwell, when it is not []. |
| `peck` | none | `{x}` `{y}` `{clear}` `{top}` `{bottom}` `{feed}` `{dwell}` `{peck}` | when capabilities.cycles is false | For each hole of a peck drilling cycle when capabilities.cycles is true. |
| `cycleEnd` | none | none | when capabilities.cycles is false | After the last hole of each cycle. |
| `dwell` | `{seconds}` | none | no | For each dwell. |
| `stop` | none | none | no | For a program stop. |
| `optionalStop` | none | none | no | For an optional stop. |
| `accelerationProfile` | `{profile}` | none | may be left out | Before a move whose acceleration profile differs from the last, when the machine profile turns acceleration profiles on. |

## Variables

| Variable | Form | Value |
| --- | --- | --- |
| `{units}` | whole word | G21 for mm output or G20 for inch output. |
| `{offset}` | whole word | The setup's work offset, taken from workOffsets. |
| `{tool}` | letter and number | Tool number. |
| `{rpm}` | letter and number | Spindle speed in revolutions per minute. |
| `{x}` | letter and number | Target X in output units. |
| `{y}` | letter and number | Target Y in output units. |
| `{z}` | letter and number | Target Z in output units. |
| `{feed}` | letter and number | Feed rate in output units per minute. |
| `{power}` | letter and number | Laser power as an S value, 0 to the machine's maximum. |
| `{i}` | letter and number | Arc centre X minus arc start X (incremental). |
| `{j}` | letter and number | Arc centre Y minus arc start Y (incremental). |
| `{k}` | letter and number | Arc centre Z minus arc start Z (incremental). |
| `{plane}` | whole word | G17, G18 or G19, the arc's plane. |
| `{clear}` | letter and number | Cycle retract height (the R plane). |
| `{top}` | letter and number | Top of the hole. |
| `{bottom}` | letter and number | Bottom of the hole. |
| `{dwell}` | letter and number | Dwell at the bottom of the hole, in seconds. |
| `{peck}` | letter and number | Depth of each peck. |
| `{seconds}` | letter and number | Dwell time in seconds. |
| `{profile}` | letter and number | Acceleration profile number, 1 for rapids and roughing. |

## Dialect switches

- `capabilities.arcs`: `true` writes arcs in all three planes through arcCw and arcCcw. `"xy"` writes XY arcs only, turns other arcs into short lines, and drops `{k}` and `{plane}` from the required variables. `false` turns every arc into short lines within 0.005 mm, and the arc templates may be [].
- `capabilities.cycles`: `true` writes drilling through drill, drillDwell, peck and cycleEnd. `false` expands every cycle into rapid, linear and dwell lines, and the cycle templates may be [].
- `capabilities.toolChange`: `true` lets one file hold several tools through toolChange and toolLength, when the export dialog's tool change choice is M6. `false` refuses tool change, so each run of one tool gets its own file.
- `toolChangeDefault`: accepted, but export never reads it. The machine profile and the export dialog choose tool change. Leave it out.
- `laser`: present when the post can run a laser. `note` is written as a comment before the header of each laser file, `on` replaces the spindle lines of each section, and linear, arcCw and arcCcw must contain `{power}`.
- Units: the header's `{units}` writes G21 or G20, and Rockett converts every number before formatting. `words` must hold G21. A post without G20 imports, but export refuses inch output with it.
- Comments: `templates.comment` is `({text})`, `;{text}` or `; {text}`. Rockett replaces `(`, `)`, `;` and characters outside printable ASCII in comment text with spaces.
- Drilling: start drill, drillDwell and peck with G99 where the controller has it, as `G99 G81 X{x} Y{y} Z{bottom} R{clear} F{feed}`. Rockett moves between holes at `{clear}`.
- Acceleration profiles: `templates.accelerationProfile` may be left out. It is written only when the machine profile turns acceleration profiles on.
- `formats`: the decimals of each address letter, and whether trailing zeros are dropped.
- `modal`: an address letter listed alone is written only when its value changes. A list of words is a modal group, written only when the word differs from the group's last one. Everything is written again after a tool change, a cycle and raw lines. Modal applies to every template, so a footer M5 is left out when the spindle is already off. The two axes in an arc's plane are always written.

## Rules the schema cannot state

Rockett checks these at import, after the JSON schema passes.

- Every word in a template line, a `modal` group, `workOffsets` and `laser.on` is listed in `words`.
- An address letter in a template line, and a letter listed alone in `modal`, has a number format in `formats`.
- `{units}`, `{offset}` and `{plane}` stand alone. Every other variable follows its address letter, as `X{x}`.
- A template uses only the variables its row in Templates lists, and contains every required one.
- A template is [] only where its row allows it.
- A word is in at most one modal group.
- With `laser`, linear, arcCw and arcCcw contain `{power}`, as `S{power}`.
- `words` holds G21. When the post has arc templates and `capabilities.arcs` is not `"xy"`, `words` also holds G17, G18 and G19.
- `modal` never lists I, J, K or P alone: arc centres and dwell times are written on every line that uses them. Refused as `modal[9]: I must be written on every line that uses it; accepted: a letter in formats other than I, J, K, P`.
- `accelerationProfile` is left out, never []. Refused as `templates.accelerationProfile: must not be empty; accepted: at least one line, or leave the key out`.
- With `capabilities.cycles` true, a drill with a dwell writes `{dwell}`: through drillDwell, or through drill when drillDwell is []. Refused as `templates.drillDwell: must not be empty when capabilities.cycles is true and templates.drill has no {dwell}; accepted: a line with P{dwell}, as G82 X{x} Y{y} Z{bottom} R{clear} P{dwell} F{feed}`. A peck cycle writes a dwell only through `{dwell}` in peck.

Rockett checks these at export, against the lines it wrote. A post that breaks one imports, then every export with it is refused.

- The footer repeats every spindleOff and coolantOff line word for word, as `M5` and `M9`. Refused as `the post footer never sends M5`.
- G20, G21 and the work offset words appear only through the header's `{units}` and `{offset}`. A fixed G21 in the header is refused as `the file sets units G21 G21, not G21`, and a fixed G54 in the footer as `the file sets work offset G54 G54, not G54`.
- With tool change on, toolChange has one line with `{tool}` and at least one fixed word, as `T{tool} M6`, because Rockett finds each tool change in the file by those words. `{tool}` alone is refused as `the file changes to tools ..., not ...`.
- `workOffsets` is in order: entry n is the setup's work offset n, so G54 is 1 and G55 is 2. A setup with work offset 2 and a post with one entry is refused as `post <id> has no work offset 2`.

## Import and refusals

Import post in Settings, CAM, Posts takes one JSON file of at most 65536 bytes in UTF-8. Rockett adds `user.` to the id, so a user post never replaces a shipped one, and importing the same id again replaces the earlier copy. The post as Rockett stores it, with no spaces and with the new id, must also fit in 65536 bytes.

A refusal is one line naming the JSON path, the problem and the accepted values, as:

```text
Post did not import: post capabilities.arcs: is not an accepted value; accepted: true, false or "xy".
```

Delete in Settings, CAM, Posts removes a user post. Setups that use it keep their own copy and still export.

## Mapping from other posts

Each cell names where the source usually keeps the same behaviour. Where a cell says check, look for your post's equivalent.

| Rockett | Fusion .cps | Vectric .pp | Mach3 and Mach4 | LinuxCNC |
| --- | --- | --- | --- | --- |
| `header` | `onOpen()` | `begin HEADER` | check | check |
| `footer` | `onClose()` | `begin FOOTER` | check | `M2` or `M30` |
| `toolChange` | the tool call in `onSection()` | `begin TOOLCHANGE` | `T{tool} M6` | `T{tool} M6` |
| `toolLength` | `tool.lengthOffset` in `onSection()` | check | `G43 H{tool}` | `G43 H{tool}` |
| `spindleCw`, `spindleCcw` | `spindleSpeed` and `tool.clockwise` | `[S]` in the header or tool change | `M3 S{rpm}`, `M4 S{rpm}` | `M3 S{rpm}`, `M4 S{rpm}` |
| coolant templates | `tool.coolant` | check | `M8`, `M7`, `M9` | `M8`, `M7`, `M9` |
| `rapid` | `onRapid()` | `begin RAPID_MOVE` | `G0` | `G0` |
| `linear` | `onLinear()` | `begin FIRST_FEED_MOVE`, `begin FEED_MOVE` | `G1` | `G1` |
| `arcCw`, `arcCcw` | `onCircular()` | `begin CW_ARC_MOVE`, `begin CCW_ARC_MOVE` | `G2`, `G3`; in Mach3 the IJ mode setting picks incremental or absolute centres, and Rockett writes incremental | `G2`, `G3`, incremental centres by default (`G91.1`) |
| `capabilities.arcs` | `allowedCircularPlanes` | check | check | `G17`, `G18`, `G19` |
| `drill`, `drillDwell`, `peck`, `cycleEnd` | `onCyclePoint()`, `onCycleEnd()`; `cycleType` `drilling`, `counter-boring`, `deep-drilling` | check | `G81`, `G82`, `G83`, `G80` | `G81`, `G82`, `G83`, `G80`, with `R` retract and `Q` peck |
| `dwell` | `onDwell()` | `begin DWELL_MOVE` | `G4 P`; in Mach3 a setting picks seconds or milliseconds | `G4 P` in seconds |
| `stop`, `optionalStop` | `onCommand()` with `COMMAND_STOP`, `COMMAND_OPTIONAL_STOP` | check | `M0`, `M1` | `M0`, `M1` |
| `comment` | `onComment()` | check | `({text})` in the Mach3 manual | `({text})` or `; {text}` |
| `formats` | `createFormat()` decimals | the format in each `VAR` line, as `1.3` | check | check |
| `modal` | `createModal()`, `createVariable()` | `A` always or `C` on change in each `VAR` line | check | check |
| units | `unit` | the `UNITS` line | `G21`, `G20` | `G21`, `G20` |
| `extension` | `extension` | `FILE_EXTENSION` | check | check |

## JSON schema

```json
{
  "type": "object",
  "required": [
    "id",
    "label",
    "extension",
    "capabilities",
    "words",
    "formats",
    "modal",
    "workOffsets",
    "templates"
  ],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9.-]*$",
      "description": "lower case letters, digits, dots and hyphens, starting with a letter or digit"
    },
    "label": {
      "type": "string",
      "pattern": "^[ -~]+$",
      "description": "printable ASCII text"
    },
    "extension": {
      "type": "string",
      "pattern": "^[a-z0-9]+$",
      "description": "lower case letters and digits with no dot, as \"nc\""
    },
    "capabilities": {
      "type": "object",
      "required": [
        "arcs",
        "cycles",
        "toolChange"
      ],
      "properties": {
        "arcs": {
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "string",
              "const": "xy"
            }
          ],
          "description": "true, false or \"xy\""
        },
        "cycles": {
          "type": "boolean",
          "description": "true or false"
        },
        "toolChange": {
          "type": "boolean",
          "description": "true or false"
        }
      },
      "additionalProperties": false,
      "description": "an object { arcs, cycles, toolChange }"
    },
    "toolChangeDefault": {
      "type": "boolean",
      "description": "true or false"
    },
    "words": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^[A-Z][-+]?\\d+(?:\\.\\d+)?$",
        "description": "a capital letter and a number, as G1, M30 or G91.1"
      },
      "description": "a list of every G and M word the post writes"
    },
    "formats": {
      "type": "object",
      "patternProperties": {
        "^[A-FH-LP-Z]$": {
          "type": "object",
          "required": [
            "decimals",
            "trim"
          ],
          "properties": {
            "decimals": {
              "type": "integer",
              "minimum": 0,
              "maximum": 6,
              "description": "a whole number from 0 to 6"
            },
            "trim": {
              "type": "boolean",
              "description": "true drops trailing zeros, false keeps them"
            }
          },
          "description": "an object { decimals, trim }"
        }
      },
      "additionalProperties": false,
      "description": "address letters other than G, M, N and O"
    },
    "modal": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        ]
      },
      "description": "a list of address letters and lists of words"
    },
    "workOffsets": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "minItems": 1,
      "description": "a non-empty list of words, as G54"
    },
    "laser": {
      "type": "object",
      "required": [
        "note",
        "on"
      ],
      "properties": {
        "note": {
          "type": "string",
          "pattern": "^[ -~]+$",
          "description": "printable ASCII text"
        },
        "on": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "minItems": 1,
          "description": "a non-empty list of lines of words"
        }
      },
      "additionalProperties": false,
      "description": "an object { note, on }"
    },
    "templates": {
      "type": "object",
      "required": [
        "header",
        "footer",
        "toolChange",
        "toolLength",
        "spindleCw",
        "spindleCcw",
        "spindleOff",
        "coolantFlood",
        "coolantMist",
        "coolantOff",
        "rapid",
        "linear",
        "arcCw",
        "arcCcw",
        "drill",
        "drillDwell",
        "peck",
        "cycleEnd",
        "dwell",
        "stop",
        "optionalStop",
        "comment"
      ],
      "properties": {
        "header": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "footer": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "toolChange": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "toolLength": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "spindleCw": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "spindleCcw": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "spindleOff": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "coolantFlood": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "coolantMist": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "coolantOff": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "rapid": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "linear": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "arcCw": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "arcCcw": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "drill": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "drillDwell": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "peck": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "cycleEnd": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "dwell": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "stop": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "optionalStop": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "accelerationProfile": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "a list of template lines, tokens separated by single spaces, [] for none"
        },
        "comment": {
          "type": "string",
          "pattern": "^(?:(\\()\\{text\\}\\)|(; ?)\\{text\\})$",
          "description": "\"({text})\", \";{text}\" or \"; {text}\""
        }
      },
      "additionalProperties": false,
      "description": "an object with one key per template, plus comment"
    }
  },
  "additionalProperties": false,
  "description": "a post object"
}
```

## Example: GRBL 1.1

The shipped GRBL 1.1 post, complete. Copy its shape.

```json
{
  "id": "grbl",
  "label": "GRBL 1.1",
  "extension": "nc",
  "capabilities": {
    "arcs": true,
    "cycles": false,
    "toolChange": false
  },
  "words": [
    "G0",
    "G1",
    "G2",
    "G3",
    "G4",
    "G17",
    "G18",
    "G19",
    "G20",
    "G21",
    "G54",
    "G55",
    "G56",
    "G57",
    "G58",
    "G59",
    "G90",
    "G91.1",
    "G94",
    "M0",
    "M1",
    "M3",
    "M4",
    "M5",
    "M7",
    "M8",
    "M9",
    "M30"
  ],
  "formats": {
    "X": {
      "decimals": 4,
      "trim": true
    },
    "Y": {
      "decimals": 4,
      "trim": true
    },
    "Z": {
      "decimals": 4,
      "trim": true
    },
    "I": {
      "decimals": 4,
      "trim": true
    },
    "J": {
      "decimals": 4,
      "trim": true
    },
    "K": {
      "decimals": 4,
      "trim": true
    },
    "F": {
      "decimals": 1,
      "trim": true
    },
    "S": {
      "decimals": 0,
      "trim": true
    },
    "P": {
      "decimals": 3,
      "trim": true
    }
  },
  "modal": [
    [
      "G0",
      "G1",
      "G2",
      "G3"
    ],
    [
      "G17",
      "G18",
      "G19"
    ],
    [
      "M3",
      "M4",
      "M5"
    ],
    [
      "M7",
      "M8",
      "M9"
    ],
    "X",
    "Y",
    "Z",
    "F",
    "S"
  ],
  "workOffsets": [
    "G54",
    "G55",
    "G56",
    "G57",
    "G58",
    "G59"
  ],
  "laser": {
    "note": "Laser mode: GRBL needs $32=1",
    "on": [
      "M4"
    ]
  },
  "templates": {
    "header": [
      "G90 G94 G91.1 G17 {units}",
      "{offset}"
    ],
    "footer": [
      "M5",
      "M9",
      "M30"
    ],
    "toolChange": [],
    "toolLength": [],
    "spindleCw": [
      "M3 S{rpm}"
    ],
    "spindleCcw": [
      "M4 S{rpm}"
    ],
    "spindleOff": [
      "M5"
    ],
    "coolantFlood": [
      "M8"
    ],
    "coolantMist": [
      "M7"
    ],
    "coolantOff": [
      "M9"
    ],
    "rapid": [
      "G0 X{x} Y{y} Z{z}"
    ],
    "linear": [
      "G1 X{x} Y{y} Z{z} F{feed} S{power}"
    ],
    "arcCw": [
      "{plane} G2 X{x} Y{y} Z{z} I{i} J{j} K{k} F{feed} S{power}"
    ],
    "arcCcw": [
      "{plane} G3 X{x} Y{y} Z{z} I{i} J{j} K{k} F{feed} S{power}"
    ],
    "drill": [],
    "drillDwell": [],
    "peck": [],
    "cycleEnd": [],
    "dwell": [
      "G4 P{seconds}"
    ],
    "stop": [
      "M0"
    ],
    "optionalStop": [
      "M1"
    ],
    "comment": "({text})"
  }
}
```
