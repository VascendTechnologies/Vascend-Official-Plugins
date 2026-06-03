<p align="center">
  <img src="img.png" alt="Vascend Official Plugins" width="100%">
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-7C5CFF" alt="Claude Code plugin">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="Zero dependencies">
</p>

<p align="center">
  <b>English</b> · <a href="./README.it.md">Italiano</a>
</p>

# Vascend Official Plugins

Official marketplace of the [Vascend](https://github.com/VascendTechnologies)
plugins for [Claude Code](https://claude.com/claude-code): a method that makes an
AI agent **think, execute and remember** in a structured, traceable and
verifiable way, with zero dependencies.

## Installation

```
/plugin marketplace add VascendTechnologies/Vascend-Official-Plugins
/plugin install vascend@vascend-official-plugins
```

After pushing to this repo, to update:

```
/plugin marketplace update vascend-official-plugins
/reload-plugins
```

## Available plugins

| Plugin | Description | Install |
|---|---|---|
| [`vascend`](./vascend) | Danilov method for Claude Code: structured `INDEX/DEFINITIONS/RELATIONS` prompts and `DanilovGoal` execution tracked with one-hot bits, with a chained HMAC signed Trace and a deterministic verdict. | `/plugin install vascend@vascend-official-plugins` |

## The idea: the memory palace

The method borrows a real technique, the **memory palace** (*method of loci*):
to remember something, you picture yourself walking through a familiar place and
"place" each item in a fixed room. It is the trick **Patrick Jane uses in _The
Mentalist_**, the mental castle where every piece of information has its exact
spot and you get back to it by walking there.

<p align="center">
  <img src="mentalist.jpg" alt="Patrick Jane in The Mentalist" width="60%"><br>
  <sub>Patrick Jane in <i>The Mentalist</i> (CBS / Warner Bros.)</sub>
</p>

Vascend makes it literal for an AI agent:

- the **plan** is the castle;
- each **task** is a **fixed room**: bit K is always room K, it never moves;
- **completing** a task means **turning on the light** in that room (only via `mark.js`);
- the goal is reached when **the whole castle is lit** (`state == MASK_TARGET`),
  and `validate()` returns `TRUE`.

And the castle does not stay behind the agent's eyes: **it builds it by
answering**. The chat _is_ the castle and every line written is a room made
visible, so the reader walks through the reasoning instead of reading a summary
of it. `state` is the map of the lit rooms, `missing` the ones still dark: you
always know which one to go back to.

## The three concepts

### 1. Structured prompts: `INDEX / DEFINITIONS / RELATIONS`

A new format, designed for machines before humans. Instead of describing
everything in prose, where "what it is", "what properties it has" and "how it
connects" get mixed together, it separates the three layers into a compact
numeric notation:

```
INDEX                        # the bare concepts, one word each, numbered
1 = node
2 = edge

DEFINITIONS                  # the instances with the properties that matter
@1[start]: color=#3B82F6, shape=stadium
@1[end]:   color=#10B981, shape=circle

RELATIONS                    # the links: → directed, ↔ symmetric
@R1: @1[start] → @1[end]   [ label=ok ]

OUTPUT: Mermaid diagram
```

Separating the layers triggers the model's structured parsing and yields output
that is **more faithful where the values matter**: diagrams, image generation
prompts, configurations, executable plans.

### 2. DanilovGoal: one-hot bit execution, verifiable

Each task is a **bit**. It turns on **only** by running `mark.js`, which appends
a line to the **Trace**, signed with a chained HMAC. The verdict
`validate() == (state == MASK_TARGET)` is computed by the **script** from the
signed data, **never by the agent**: it is math, not an assertion. Hand written
lines have no valid signature and are rejected, and the Trace stays tamper
evident.

### 3. Compact notation: how the agent answers and remembers

During a DanilovGoal the agent does not answer in prose. Everything it does
becomes **one relation per line**:

```
read LotTable.tsx>multi_selection | where to hook the props
edit LotTable.tsx>multi_selection | props + checkbox column
run pytest>backend_green | 6 passed
```

One line instead of a whole sentence. The format is
`<action> <entity>>goal | note` and uses about 2 syntax tokens per line, versus
about 5 for a notation loaded with `@`, `:`, unicode arrows and brackets. Over a
full turn the effect is large: **far fewer tokens generated**, and since the
agent already thinks in structured form instead of prose, the **reasoning is
shorter and faster**, both in tokens and in time.

The same lines are stored in `.vascend` files, a relation text format designed
to be **reinjected into the context cheaply**, grouped by `@plan` (the
session/goal):

```
# vascend-memory · contabilita

@plan[Course correction: retrieval via CLI]
2026-06-01T22:28:11Z · decide vascend_memory_graph>retrieval_via_cli | no MCP, memory.js from the CLI on demand
2026-06-01T22:28:12Z · decide vascend_memory_graph>no_obsidian | we read .vascend, the viewer is our own extension
```

Everything runs **offline with zero dependencies**; retrieval uses BM25 + RRF
via the CLI (`memory.js search`), with no external services.

The same file feeds the **graph**: the VS Code extension
[`vascend-memory-graph`](./vascend-memory-graph) reads the `.vascend` files and
draws them as a node and edge graph with a force layout. The **nodes** are
entities and goals (size proportional to occurrences), the **edges** are the
actions (`read`, `edit`, `fix`, `run`, ...), with filters by project, session
(`@plan`) and action.

## What the `vascend` plugin brings

- **Sticky mode** (`/vascend on`): every prompt becomes a tracked goal.
- **Hierarchical plans** (a plan and its subplans) with **automatic
  consolidation** guaranteed by the script.
- **Enforcement**: the turn does not close until the castle is lit (stall
  protection configurable via `DANILOV_MAX_STALL`, where `0` means persistent).
- **Resume across sessions**: a long task is not lost when switching session
  (`SessionStart` hook plus `resume.js --attach`).
- **Precision**: task dependencies (DAG), verification gates (`mark --check`),
  notes on individual bits (`mark --note`).
- **Subagents** `vascend-planner` (plans) and `vascend-executor` (executes).
- **Checkpoint** in Danilov notation (`/vascend-compact`), plus a prompt to `/clear`.

Full plugin details: [`vascend/README.md`](./vascend/README.md).

## Repo structure

```
.claude-plugin/marketplace.json   # marketplace index
vascend/                          # plugin (skill + commands + hooks + agents + scripts)
vascend-memory-graph/             # companion: VS Code extension, graph of the .vascend memories
LICENSE                           # MIT
```

Each plugin lives in its own subfolder with its `.claude-plugin/plugin.json`.
To add a new one: create the folder, add the manifest and reference it in
`marketplace.json` (`source`).

## License

[MIT](./LICENSE) (c) 2026 Lorenzo Danilov.
