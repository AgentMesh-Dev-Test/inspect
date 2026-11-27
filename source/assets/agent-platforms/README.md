# Agent platforms

What each agent platform provides, category by category, with the evidence that shows an agent uses each feature and a link to the vendor's own documentation for every claim. Inspect reads it to tell a buyer which platform features an agent actually uses, how tied the agent is to its platform, what moving it would take, what would be lost, and what provides the same thing elsewhere.

Every entry is dated and sourced, and the wording is neutral. A claim that is not in the vendor's documentation is not in this database: a cell that could not be confirmed is rated `unknown`.

## Layout

- `platform.schema.json`: the JSON Schema every entry follows. Its descriptions define each category.
- `platforms/<id>.json`: one entry per platform. A vendor's framework and its hosted service are one entry when they work as one (for example LangGraph with LangSmith).

`node tools/ci/check-agent-platforms.mjs` checks every entry against the schema and the rules below, in CI and in the pre-push hook. `--self-test` proves that a bad entry fails.

## The categories

Each entry rates all twelve.

| Key | Category |
| --- | --- |
| `tracing` | Tracing and telemetry |
| `evaluations` | Evaluations |
| `prompt-management` | Prompt management |
| `keys-and-secrets` | Keys and secrets |
| `memory-and-state` | Memory and saved state (checkpoints, threads) |
| `human-approval` | Human approval steps (pause and resume) |
| `deployment` | Deployment and scaling |
| `sandboxes` | Sandboxes and code execution |
| `tool-connections` | Tool connections (MCP support) |
| `agent-to-agent` | Agent-to-agent (A2A support) |
| `identity-and-access` | Identity and access |
| `packaging` | Packaging (Agent Plugins 1.0.0, Agent Skills) |

## What a cell holds

- `rating`: one of the five below.
- `what`: one short factual sentence, two at most, naming the feature as the vendor names it, and saying so when the vendor labels it preview or beta.
- `portability`: `level` (below), the open `standards` involved, and a `note` saying whether the data or interface is standard or the vendor's own, and any standard-based path the vendor offers.
- `evidence`: what to search for in an agent's repository to tell whether the agent uses the feature. Each item is a literal string from the vendor's documentation: a package name, an import, a function or class, an environment variable, a file name, a key in a config file, or a command. `not-in-code` means the feature is set up outside the code (in a console) and the note says where.
- `sources`: links to the vendor's own documentation pages. Every link starts with one of the entry's `documentation` prefixes.
- `checked`: the date the sources were read.

## Ratings

- `native`: the platform provides it through its own feature, with its own API or data format. A native feature may also import or export an open standard; `portability` says so.
- `standard`: the platform's way of doing it is an open standard (OpenTelemetry, MCP, A2A, OAuth 2.0 and the like), so the agent's code and data use the standard's interface.
- `partial`: the platform covers only part of the category, or covers it only through a third-party integration. `what` says which part.
- `none`: the vendor's documentation says the platform does not provide it, or leaves it to the developer. The source is that page.
- `unknown`: not found in the vendor's documentation on the date checked. Never a guess.

Three categories name a standard, and their rating answers whether the platform supports it, with `native` meaning the platform has only its own mechanism:

- `tool-connections`: `standard` when the platform's agents can use MCP servers as tools. Whether the platform also serves agents over MCP is said in `what`.
- `agent-to-agent`: `standard` when the platform can both call remote A2A agents and serve its own agents over A2A; `partial` when it does only one of the two.
- `packaging`: `standard` when the platform supports Agent Plugins 1.0.0 or Agent Skills; `what` says which.

An entry that groups several products rates the strongest provision across them, and `what` names the product that provides it. A vendor's preview or beta label does not change the rating; `what` says so.

## Portability levels

- `open-standard`: the data or interface follows an open standard.
- `open-source`: the vendor's own interface, but open source and runnable anywhere.
- `proprietary`: the vendor's own interface, available only from the vendor or its hosted service.
- `mixed`: parts of more than one; the note says which.
- `not-applicable`: for a `none` rating.
- `unknown`: not found.

## Rules the check enforces

- Every file is valid against `platform.schema.json` and is named after its `id`.
- A cell rated anything but `unknown` cites at least one source and has a date.
- A `native`, `standard` or `partial` cell lists at least one evidence item.
- Every source URL is under the entry's `documentation` prefixes.
- Dates are real calendar dates and not in the future.
- A `standard` rating names its standard; a `none` rating has portability `not-applicable`.

## Adding or re-checking a platform

1. Copy an existing file in `platforms/` to `platforms/<id>.json` and set `id`, `vendor`, `name`, `summary`, `products` and `documentation`.
2. For each of the twelve categories, read the vendor's current documentation and fill the cell. Use only the vendor's own public documentation, cite the specific page, and take every evidence string from it. If the documentation does not say, the rating is `unknown`.
3. Where the vendor offers a standard-based path (OpenTelemetry export, MCP, A2A, OAuth), say so in `portability`, even when the main feature is the vendor's own.
4. Set `checked` on the entry and on each cell you read to the date you read the sources.
5. Run `node tools/ci/check-agent-platforms.mjs` and fix what it names.

Product names and features change often. When re-checking an entry, update the cells whose sources changed and their dates, and keep the former product name in `what` where the vendor's documentation still mentions it.
