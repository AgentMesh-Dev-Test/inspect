## What Inspect is (decided by Jeff, the owner, 2026-11-25)

Inspect takes a GitHub repository address and a commit, reads the agent's code, and hands back an inspection report on what the agent does and how safe it is.
- Its reader is the person in charge of a department's agents, deciding whether to bring in an outside agent before anything is installed or given a credential.
- What it leaves out: it does NOT judge fit with anyone's plan or match the agent to catalog roles. A future Roadmap agent will read Inspect's report for that.
- No recommendation: it gives no bring-it-in-or-not verdict.

The owner's four answers:
1. Kind: plugin-on-harness.
2. one-agent.
3. What it reaches:
   - GitHub, read only (public repos at a commit);
   - OSV (osv.dev), read only, for known holes in dependencies;
   - a model for the judgments, through the shared model caller (Common Agent 12.4.1, system of kind model).
   It writes to nothing.
4. build-new, reusing the reverse engineer's fact-gathering skills.

The report: eight sections, confirmed by the owner.

| # | Section | What it holds |
|---|---|---|
| 1 | At a glance | The few findings that matter most, written last |
| 2 | What was inspected | Repo, commit, date, publisher, license, what it is built on (language, framework), how actively it is kept up |
| 3 | What it does | Each job in plain words; its skills as separate parts, and whether each can be lifted out on its own; what you give it and what it hands back |
| 4 | How it works | The models it calls and whether you can change them, how it runs, what it remembers between jobs, the steps where a person must step in |
| 5 | What it connects to | Each system it reaches, the credentials it expects, read or write access, and what it spends per run (model calls, paid services) |
| 6 | What it can do on its own | The tools it gives its model (shell, file writes, browser, sending messages), and which run without a person's OK |
| 7 | Risks, and what it needs to run safely | Where outside content can reach an action (the prompt-injection path), where data leaves, scripts that run at install, committed secrets, known holes in dependencies, license obligations. Then the least access it needs and what to put behind an approval |
| 8 | Tests, and what Inspect couldn't tell | Its tests and what they miss; what Inspect could not settle without running it; questions for the publisher |

Rules for the report:
- The report is a list of findings, each standing on its own, grouped by section. A later page will draw each finding as it arrives.
- Every finding cites a file and line at the commit.
- Each risk carries a level and a category from a published list: the OWASP Top 10 for LLM Applications and OWASP's agentic AI threats list, SPDX license names, and a CycloneDX dependency list.
- Scripts collect the facts; the model writes only the judgments, and each judgment cites a fact the scripts found. That is the split that fixed the reverse engineer.
- Read only: it never runs the repo's code. Inspect calls no write action anywhere.
- Sections 3, 4 and 5 must be precise, because the future Roadmap agent reads them.
- Its output format is a JSON Schema in the spec. Our hard rule is "published form first, no private schemas".

Findings mid-run: a separate piece of work, the "Adapter Streaming work", is adding a way for an agent on the adapter to send findings and status lines to its running job. Until that adapter is released, Inspect delivers the whole report at the end. Shape its code so that posting each finding as it is found is a small later change (one place that emits a finding).

Reuse: Inspect reuses the reverse engineer's fact-gathering skills: read-the-codebase, list-the-dependencies (including the CycloneDX SBOM), check-the-evidence, and the scripts those skills run. It does not reuse the parts that exist for rebuilding code (strings, constants, declarations, the baseline test run). The owner wants these shared, pinned to a version, not forked. The repo family (repo-reader, repo-architect, repo-scanner) already fetches and reads GitHub repositories: reuse how it fetches a repo at a commit. The security reviewer has the reach / spend / never-do shape; borrow its vocabulary for section 7.

## The person's word on the spec (2026-11-25), relayed word for word by the coordinator: he gave the spec's approval to the builder

you own the spec, don't ask me for approval on it.

## The person's answer on spending (2026-11-25), relayed word for word by the coordinator

The proposal put to him, as written: "At most three model calls a job, with at most 400,000 tokens read and 48,000 written in all; GitHub and OSV cost nothing."

His answer:

approved

## The person's correction (2026-11-25), relayed word for word by the coordinator: the limit moved out of the build

No - building the software is different than setting limits on running it!

you're job is to build the software
