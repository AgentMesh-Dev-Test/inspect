---
record: architecture-record-v1
statement: "## What Inspect is (decided by Jeff, the owner, 2026-11-25) Inspect takes a GitHub repository address and a commit, reads the agent's code, and hands back an inspection report on what the agent does and how safe it is. - Its reader is the p"
environments: [dev, test, production]
kind: plugin-on-harness
done: yes
questions: 0
systems: [text-reasoning, code-host, vulnerability-database]
standing_assets: [https://schemas.agentmesh.ai/brand/v1, https://schemas.agentmesh.ai/style-guide/v1]
cost_limit: "none set by the package: the package sets no spending limit, and whoever installs and runs it sets one for that install"
bindings:
  text-reasoning:
    dev: platform (platform)
    test: platform (platform)
    production: platform (platform)
  code-host:
    dev: itself at https://api.github.com, no key, read, approved by the owner in egress-1
    test: itself at https://api.github.com, no key, read, approved by the owner in egress-1
    production: itself at https://api.github.com, no key, read, approved by the owner in egress-1
  vulnerability-database:
    dev: itself at https://api.osv.dev, no key, read, approved by the owner in egress-2
    test: itself at https://api.osv.dev, no key, read, approved by the owner in egress-2
    production: itself at https://api.osv.dev, no key, read, approved by the owner in egress-2
---

# Architecture record: inspecting an outside agent's code before it is brought in

This record is finished: every system is named and bound in each environment, and every decision has its reason.

## Statement

> ## What Inspect is (decided by Jeff, the owner, 2026-11-25)
>
> Inspect takes a GitHub repository address and a commit, reads the agent's code, and hands back an inspection report on what the agent does and how safe it is.
> - Its reader is the person in charge of a department's agents, deciding whether to bring in an outside agent before anything is installed or given a credential.
> - What it leaves out: it does NOT judge fit with anyone's plan or match the agent to catalog roles. A future Roadmap agent will read Inspect's report for that.
> - No recommendation: it gives no bring-it-in-or-not verdict.
>
> The owner's four answers:
> 1. Kind: plugin-on-harness.
> 2. one-agent.
> 3. What it reaches:
>    - GitHub, read only (public repos at a commit);
>    - OSV ((an address, supplied at Deploy)), read only, for known holes in dependencies;
>    - a model for the judgments, through the shared model caller (Common Agent 12.4.1, system of kind model).
>    It writes to nothing.
> 4. build-new, reusing the reverse engineer's fact-gathering skills.
>
> The report: eight sections, confirmed by the owner.
>
> | # | Section | What it holds |
> |---|---|---|
> | 1 | At a glance | The few findings that matter most, written last |
> | 2 | What was inspected | Repo, commit, date, publisher, license, what it is built on (language, framework), how actively it is kept up |
> | 3 | What it does | Each job in plain words; its skills as separate parts, and whether each can be lifted out on its own; what you give it and what it hands back |
> | 4 | How it works | The models it calls and whether you can change them, how it runs, what it remembers between jobs, the steps where a person must step in |
> | 5 | What it connects to | Each system it reaches, the credentials it expects, read or write access, and what it spends per run (model calls, paid services) |
> | 6 | What it can do on its own | The tools it gives its model (shell, file writes, browser, sending messages), and which run without a person's OK |
> | 7 | Risks, and what it needs to run safely | Where outside content can reach an action (the prompt-injection path), where data leaves, scripts that run at install, committed secrets, known holes in dependencies, license obligations. Then the least access it needs and what to put behind an approval |
> | 8 | Tests, and what Inspect couldn't tell | Its tests and what they miss; what Inspect could not settle without running it; questions for the publisher |
>
> Rules for the report:
> - The report is a list of findings, each standing on its own, grouped by section. A later page will draw each finding as it arrives.
> - Every finding cites a file and line at the commit.
> - Each risk carries a level and a category from a published list: the OWASP Top 10 for LLM Applications and OWASP's agentic AI threats list, SPDX license names, and a CycloneDX dependency list.
> - Scripts collect the facts; the model writes only the judgments, and each judgment cites a fact the scripts found. That is the split that fixed the reverse engineer.
> - Read only: it never runs the repo's code. Inspect calls no write action anywhere.
> - Sections 3, 4 and 5 must be precise, because the future Roadmap agent reads them.
> - Its output format is a JSON Schema in the spec. Our hard rule is "published form first, no private schemas".
>
> Findings mid-run: a separate piece of work, the "Adapter Streaming work", is adding a way for an agent on the adapter to send findings and status lines to its running job. Until that adapter is released, Inspect delivers the whole report at the end. Shape its code so that posting each finding as it is found is a small later change (one place that emits a finding).
>
> Reuse: Inspect reuses the reverse engineer's fact-gathering skills: read-the-codebase, list-the-dependencies (including the CycloneDX SBOM), check-the-evidence, and the scripts those skills run. It does not reuse the parts that exist for rebuilding code (strings, constants, declarations, the baseline test run). The owner wants these shared, pinned to a version, not forked. The repo family (repo-reader, repo-architect, repo-scanner) already fetches and reads GitHub repositories: reuse how it fetches a repo at a commit. The security reviewer has the reach / spend / never-do shape; borrow its vocabulary for section 7.
>
> ## The person's word on the spec (2026-11-25), relayed word for word by the coordinator: he gave the spec's approval to the builder
>
> you own the spec, don't ask me for approval on it.
>
> ## The person's answer on spending (2026-11-25), relayed word for word by the coordinator
>
> The proposal put to him, as written: "At most three model calls a job, with at most 400,000 tokens read and 48,000 written in all; GitHub and OSV cost nothing."
>
> His answer:
>
> approved
>
> ## The person's correction (2026-11-25), relayed word for word by the coordinator: the limit moved out of the build
>
> No - building the software is different than setting limits on running it!
>
> you're job is to build the software

## Systems

- `text-reasoning` (text reasoning), trigger, for text, with long context: the judgments are written over many facts at once: What the agent does, how safe it is and what to put behind an approval are judgments over the facts the scripts found, and a model writes them.
- `code-host` (GitHub's API, for the repository's record, the commit's record, its recent commits and the archive of the repository at the commit), read, a public service with no key, which the owner approved: The job is about one public repository at one commit, and GitHub holds it.
- `vulnerability-database` (OSV's API, for the known vulnerabilities of the dependencies' exact versions), read, a public service with no key, which the owner approved: Known holes in dependencies are part of section 7, and OSV answers which versions have them.

## Bindings

| System | dev | test | production |
|---|---|---|---|
| text-reasoning | platform (AgentMesh's models), platform default | platform (AgentMesh's models), platform default | platform (AgentMesh's models), platform default |
| code-host | the service itself at https://api.github.com, no key, approved by the owner | the service itself at https://api.github.com, no key, approved by the owner | the service itself at https://api.github.com, no key, approved by the owner |
| vulnerability-database | the service itself at https://api.osv.dev, no key, approved by the owner | the service itself at https://api.osv.dev, no key, approved by the owner | the service itself at https://api.osv.dev, no key, approved by the owner |

## Dependencies

None.

## Kind

**plugin-on-harness**: The work is a fixed program: read the request, fetch one archive, read the facts by rule, ask OSV, ask the model for the judgments at three named points, check them, write the report. A harness reading one skill carries it, and nothing needs a service of its own.

## Components

- **the harness** (`harness`), the harness: Starts the skill's script once per job, hands it the job's input and settings, and sends back what it writes as the reply.
  - **inspect-a-repository** (`skill-inspect-a-repository`), a skill: Inspects one public GitHub repository at one commit and hands back the inspection report, the dependency list and a short summary, or refuses.
    - **scripts/inspect-a-repository.mjs** (`script-inspect-a-repository`), a script: Reads the request, fetches the archive at the commit, reads the facts by rule, lists the dependencies and asks OSV about them, has the model write the judgments, checks every judgment against the facts and the commit, and writes the report through one emitter.
      - **request reader** (`request-reader`), a part: Finds the repository and the commit in the message, and refuses what is missing, a branch or tag name, and a request to run the code.
      - **GitHub reader** (`github-reader`), a part: Reads the repository's record, the commit's record, its recent commits and the archive at the commit with GET requests only, at most six calls a job. It reaches `code-host`.
      - **archive reader** (`archive-reader`), a part: Unpacks the archive inside the job's folder, writing no link and no path that leaves it, records each link as a fact, and checks the archive names the commit.
      - **fact reader** (`fact-reader`), a part: Reads the facts by rule with the reverse engineer's and the security reviewer's carried scripts and Inspect's own patterns, each with an id, a file and a line.
      - **dependency lister** (`dependency-lister`), a part: Makes the CycloneDX 1.5 bill of materials with the reverse engineer's carried script, adding the packages of a uv.lock.
      - **OSV reader** (`osv-reader`), a part: Asks OSV which exact versions have known vulnerabilities, by batched queries that change nothing, and reads each vulnerability found. It reaches `vulnerability-database`.
      - **judgment writer** (`judge`), a part: Has the model write the judgments of sections 3 to 8 and then section 1 through the shared model caller, each citing facts by id. It reaches `text-reasoning`.
      - **evidence checker** (`evidence-checker`), a part: Holds back every judgment that cites no fact the scripts found, whose evidence does not check against the commit, that guesses in a precise section, that has no level or listed category, or that gives a verdict.
      - **report writer** (`report-writer`), a part: Emits every finding through one function, in section order, and writes the report, the dependency list and the summary.
- **text reasoning** (`text-reasoning`), an outside system: The model behind the shared caller, for text, with long context: the judgments are written over many facts at once.
- **GitHub's API, for the repository's record, the commit's record, its recent commits and the archive of the repository at the commit** (`code-host`), an outside system: The job is about one public repository at one commit, and GitHub holds it.
- **OSV's API, for the known vulnerabilities of the dependencies' exact versions** (`vulnerability-database`), an outside system: Known holes in dependencies are part of section 7, and OSV answers which versions have them.

## Connectors

- `caller` to `harness`: a job message, which the host hands to the harness; it carries the repository and the commit.
- `harness` to `script-inspect-a-repository`: by command: node scripts/inspect-a-repository.mjs, started once per job, with the job's input as flags (the job's run, Common Agent Section 12.3); it carries the repository and the commit.
- `judge` to `text-reasoning`, trigger: through the shared model caller (scripts/model-caller.mjs) and its four settings, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, read on every call (Common Agent Section 12.4.1); it carries the facts, with anything that looks like a credential taken out.
- `github-reader` to `code-host`, read: over HTTPS, with no key, at the address its binding names, read from a setting and never written into a script (Common Agent Section 12.6, rule 2); it carries the repository's and the commit's records, the recent commits and the archive.
- `osv-reader` to `vulnerability-database`, read: over HTTPS, with no key, at the address its binding names, read from a setting and never written into a script (Common Agent Section 12.6, rule 2); it carries package names and exact versions.
- `script-inspect-a-repository` to `caller`: written to the script's standard output, which the harness hands back as the job's reply; it carries the inspection report (`application/vnd.agentmesh.inspection-report+json`), the dependency list (`application/vnd.cyclonedx+json`) and the summary (`text/markdown`).

## Runtime and deployment

Runs once per job: the harness starts the skill's script as a command, and the process ends when the reply is written. It has no service of its own, opens no port and keeps no process between jobs.

- dev: `text-reasoning` on platform (AgentMesh's models), a platform default; `code-host` on the service itself at https://api.github.com, no key, read; `vulnerability-database` on the service itself at https://api.osv.dev, no key, read.
- test: `text-reasoning` on platform (AgentMesh's models), a platform default; `code-host` on the service itself at https://api.github.com, no key, read; `vulnerability-database` on the service itself at https://api.osv.dev, no key, read.
- production: `text-reasoning` on platform (AgentMesh's models), a platform default; `code-host` on the service itself at https://api.github.com, no key, read; `vulnerability-database` on the service itself at https://api.osv.dev, no key, read.

## Data flow

1. `caller` to `harness`, the repository and the commit: The caller names the outside agent's repository and a commit.
2. `harness` to `request-reader`, the message: The harness starts the script with the job's message file.
3. `request-reader` to `github-reader`, the owner, the name and the commit: The reader hands on the repository and commit it found, or the job is refused.
4. `github-reader` to `code-host`, the repository's and the commit's records, the recent commits and the archive: The GitHub reader asks with GET requests only.
5. `github-reader` to `archive-reader`, the archive at the commit: The archive is unpacked inside the job's folder, links recorded and never written.
6. `archive-reader` to `fact-reader`, the codebase at the commit: The fact reader reads every file by rule.
7. `fact-reader` to `dependency-lister`, the manifests and lockfiles: The lister makes the bill of materials by rule.
8. `osv-reader` to `vulnerability-database`, package names and exact versions: The OSV reader asks which versions have known vulnerabilities.
9. `judge` to `text-reasoning`, the facts, with anything that looks like a credential taken out: The judgment writer asks the model for judgments that cite facts by id.
10. `judge` to `evidence-checker`, the drafted judgments: The checker keeps only what checks, and lists the rest as held back.
11. `evidence-checker` to `report-writer`, the checked findings and the facts: Every finding passes the one emitter in section order.
12. `report-writer` to `caller`, the summary, the inspection report and the dependency list: The summary is the reply, with the report and the list attached.

## Drivers

- **Cost** (`cost`): none set by the package: the package sets no spending limit, and whoever installs and runs it sets one for that install. The person set it in an answer (limit-cost: none set by the package: the package sets no spending limit, and whoever installs and runs it sets one for that install).
- **Speed** (`speed`): one inspection answered within 900 seconds. One archive of at most 50 MB is read once, OSV is asked in a few batched queries, and the model is called three times; nothing waits on a person. Cited by decisions 1 and 3.
- **Data** (`data`): reads only public repositories at a commit; keeps nothing between jobs; hands the model the facts with anything that looks like a credential taken out, and OSV only package names and versions. Everything it reads is public, and a committed credential it finds must not travel any further than its file and line.
- **Trust** (`trust`): takes a job from any caller; it reads only and changes nothing on any system. It never runs the repository's code and calls no write action anywhere, so a job cannot make it act on anything. Cited by decision 3.
- **Safety** (`read-only`): It never runs the repository's code, and calls no write action anywhere. From the statement: "Read only: it never runs the repo's code. Inspect calls no write action anywhere". Cited by decision 3.
- **Verifiability** (`facts-then-judgments`): Scripts collect the facts; the model writes only the judgments, each citing a fact the scripts found. From the statement: "Scripts collect the facts; the model writes only the judgments, and each judgment cites a fact the scripts found". Cited by decision 1.
- **Verifiability** (`cited`): Every finding cites a file and line at the commit. From the statement: "Every finding cites a file and line at the commit". Cited by decision 1.
- **Precision** (`precise-sections`): Sections 3, 4 and 5 are precise, because another agent reads them. From the statement: "Sections 3, 4 and 5 must be precise, because the future Roadmap agent reads them". Cited by decisions 1 and 4.
- **Maintainability** (`shared-not-forked`): The reverse engineer's fact-gathering scripts are shared, pinned to a version, not forked. From the statement: "The owner wants these shared, pinned to a version, not forked". Cited by decision 2.
- **Modifiability** (`one-emitter`): One place emits a finding, so posting each finding as it is found is a small later change. From the statement: "Shape its code so that posting each finding as it is found is a small later change (one place that emits a finding)". Cited by decision 4.

## Egress

- dev: the target runs the agent open (it enforces no allowlist today).
- test: the target runs the agent open (it enforces no allowlist today).
- production: the target runs the agent open (it enforces no allowlist today).
- None beyond the derived set (its systems, the network, the registrar, the model it is given).

## Formats

- It takes the repository as `url`, given by a person or an agent; (an address, supplied at Deploy) or <owner>/<name>, on a repository: line or anywhere in the message. A person or an agent names the outside agent's repository.
- It takes the commit as `identifier`, given by a person or an agent; the commit's digest, 7 to 40 hexadecimal characters, on a commit: line, or the last part of a /commit/<digest> or /tree/<digest> address; left out (0.4.0), the newest commit on the repository's default branch, read from GitHub's records. The report is about one commit, which never moves.
- It hands back the inspection report as `application/vnd.agentmesh.inspection-report+json`; the inspection-report-v1 JSON Schema in the spec: the repository and commit, the eight sections, the findings in section order, the judgments held back with why, and the facts the findings cite. A page draws each finding and another agent reads sections 3 to 5, so code consumes it, exactly typed.
- It hands back the dependency list as `application/vnd.cyclonedx+json`; a CycloneDX 1.5 bill of materials, made by rule. A published dependency format any tool reads.
- It hands back the summary as `text/markdown`; a header of the fields repository, commit, findings and held_back, then ## At a glance with one line per finding of section 1, then ## Sections with the number of findings in each. A person reads the reply first; the report is attached beside it.

## Standing assets

- **the summary** (`text/markdown`, written copy): the style guide (`https://schemas.agentmesh.ai/style-guide/v1`), because written copy a person reads speaks for the organization, and the style guide says its voice, its spelling and the words it uses and avoids; the brand profile (`https://schemas.agentmesh.ai/brand/v1`), because written copy that speaks for the organization names it, and the brand profile says how its name is written, how it is first mentioned and the words it never says.
- The Design declares exactly these as `can_use`, each with what it reads, what it does with it and what it does `without` it: `https://schemas.agentmesh.ai/brand/v1`, `https://schemas.agentmesh.ai/style-guide/v1`.

## Settings

No setting beyond the bindings' own.

## Decisions

Decisions 1 to 4 choose the agent's structure. Decisions 5 to 9 are rulings: the standard's rules applied, and the answers a person or the build gave.

### Decision 1. Scripts collect every fact by rule, and the model writes only the judgments, at three named points, each citing facts by id

Context: The reverse engineer was fixed by splitting facts from judgments, and every finding must cite a file and line at the commit.

Drivers: `facts-then-judgments` (Scripts collect the facts; the model writes only the judgments, each citing a fact the scripts found); `cited` (Every finding cites a file and line at the commit); `precise-sections` (Sections 3, 4 and 5 are precise, because another agent reads them); `speed` (one inspection answered within 900 seconds).

Why: A fact read by rule always carries its file and line, and a judgment that must cite one can be checked by code before it is delivered.

Alternatives:

- A model in control that reads the code and writes the report itself: not chosen, because its claims would not be bound to facts the code can check, and its spend would not be bounded.

Consequences:

- The job is control script, intelligence called and contract full.
- A judgment the checks do not pass is listed as held back, never dropped silently.

### Decision 2. Carry the reverse engineer's and the security reviewer's scripts and the shared model caller byte for byte, each pinned in reused.json by repository, commit and sha256

Context: The owner wants the fact-gathering skills shared, pinned to a version, not forked, and a package carries its own files.

Drivers: `shared-not-forked` (The reverse engineer's fact-gathering scripts are shared, pinned to a version, not forked).

Why: A byte-for-byte copy held to a digest by a test cannot drift without the test failing, and moving to a newer version is a re-pin.

Alternatives:

- Copy and adapt the scripts: not chosen, because that is a fork, which the owner ruled out.
- Read the scripts from the adlc repository at run time: not chosen, because a package carries its own files and the agent would reach a system nobody granted.

Consequences:

- Inspect's own code wraps the carried scripts; nothing in them is changed.
- The reverse engineer's unpacker refuses an archive holding a link, so Inspect has its own archive reader.

### Decision 3. Fetch the repository as one archive at the commit from GitHub's API, read anonymously, and unpack it with Inspect's own reader

Context: The repo family reads a commit as one archive call; it reads as the platform's GitHub App, whose key an agent put on AgentMesh from a build folder cannot carry, and its archive reader keeps no lockfiles.

Drivers: `read-only` (It never runs the repository's code, and calls no write action anywhere); `speed` (one inspection answered within 900 seconds); `trust` (takes a job from any caller; it reads only and changes nothing on any system).

Why: Public repositories read without a key, one archive call reads a whole commit, and a reader that writes no link and no path outside the job's folder keeps the archive from deciding where files land.

Alternatives:

- Read as the platform's GitHub App, as the repo family does: not chosen, because the install from a build folder cannot carry the App's key, and only public repositories are inspected.
- Read each file with its own call: not chosen, because a repository of a thousand files would take a thousand calls.

Consequences:

- Anonymous reads have a small hourly allowance, so a job makes at most six calls and stops in words when the allowance runs out.

### Decision 4. Answer at the end with a typed JSON report, the dependency list and a short Markdown summary, every finding passing one emitter

Context: A page will draw each finding as it arrives, and the adapter that lets an agent post findings during a job is not released yet.

Drivers: `one-emitter` (One place emits a finding, so posting each finding as it is found is a small later change); `precise-sections` (Sections 3, 4 and 5 are precise, because another agent reads them).

Why: Code reads the report, so it is typed; a person reads the summary first; and one emitter makes posting each finding as it is found a change to one function.

Alternatives:

- A Markdown report: not chosen, because the Roadmap agent and the page read it as data.

Consequences:

- The report's schema is in the spec until it is published.

### Decision 5. Bind text-reasoning to platform (AgentMesh's models) in dev, test and production

Why: The organization chose no product for text-reasoning, so the House Stack's product fills each as a platform default: AgentMesh chooses the model and keeps it current. Every harness AgentMesh deploys uses it unless its owner names another model, and the key sits on the machine that deploys it.

Weighed: Another product behind text-reasoning: a model provider of the organization's own, bound on its stack with its own key.

What follows: The install places the model from this binding in the four settings MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, and the scripts read them on every call through the shared model caller and name no model, so changing the model is a setting and not a rebuild.

### Decision 6. Bind code-host to the service itself in dev, test and production

Why: It is a public service that takes no key and has no product behind it, so nobody chooses one; the owner approved reaching it (egress-1).

What follows: The Design declares the service with its address as a setting whose default is the address the binding names; the scripts read the setting and hold no address of their own (Common Agent Section 12.6, rule 2).

### Decision 7. Bind vulnerability-database to the service itself in dev, test and production

Why: It is a public service that takes no key and has no product behind it, so nobody chooses one; the owner approved reaching it (egress-2).

What follows: The Design declares the service with its address as a setting whose default is the address the binding names; the scripts read the setting and hold no address of their own (Common Agent Section 12.6, rule 2).

### Decision 8. The agent may reach GitHub's API, for the repository's record, the commit's record, its recent commits and the archive of the repository at the commit

Why: The person granted it in an answer (egress-1: yes).

What follows: GitHub's API, for the repository's record, the commit's record, its recent commits and the archive of the repository at the commit is the system code-host, bound to the service itself at the address the owner approved, with no key; the Design declares that address as a setting whose default it is, and the scripts hold no address of their own.

### Decision 9. The agent may reach OSV's API, for the known vulnerabilities of the dependencies' exact versions

Why: The person granted it in an answer (egress-2: yes).

What follows: OSV's API, for the known vulnerabilities of the dependencies' exact versions is the system vulnerability-database, bound to the service itself at the address the owner approved, with no key; the Design declares that address as a setting whose default it is, and the scripts hold no address of their own.

## Questions

None. Every system is named and bound in each environment, and every decision has its reason.
