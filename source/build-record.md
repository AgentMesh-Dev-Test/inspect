# inspect 0.1.0: the build record

Date: 2026-11-25 (Mountain time).

## What it is

Inspect takes a public GitHub repository and a commit, reads the agent's code at that commit without running any of it, and hands back an inspection report on what the agent does and how safe it is: findings in eight sections, each citing a file and line at the commit (or, where the fact is in no file, the call it came from). Scripts collect the facts; a model writes only the judgments, and each judgment cites facts the scripts found. It gives no verdict and judges no fit. The owner's words are in request.md.

## Who did what

- One builder, the harness (Claude Code), wrote the spec, the architecture record, the prose of the agent's files, the tests and the scripts. It started in an ADLC plugin (0.4.2) build folder, and the plugin's generators wrote the agent's own files and the standard checks.
- The spec: the owner gave the spec's approval to the builder: "you own the spec, don't ask me for approval on it" (request.md). He declined to run the plugin's approval command and directed the build ("I asked you to build this"), and then said he never wanted Inspect built through the ADLC. So the plugin's lock was never written, its build gates were not used, and its `put` was not run. The package was checked by its own suite (60 tests, 59 pass, one skipped) and by the Common Agent packer, and it was filed on dev through the platform's front door (POST /v1/deploy/by-email) with the platform's deploy key, as the platform's own address.
- The handle and the price were decided by the coordinator on the owner's word: inspect.platform@agentmesh.ai, and free, as repo-reader, repo-architect and repo-scanner declare.
- No running limit is in the spec or the record (the owner: "building the software is different than setting limits on running it!"). The record says the package sets none.

## What it reuses, pinned, not forked

reused.json pins every carried file to CommonAgent/adlc 7d66f36 and its sha256; test/constraints.test.mjs [C3] fails when one drifts.

- The reverse engineer 0.3.2's fact-gathering scripts, byte for byte: codebase.mjs, facts.mjs, surface.mjs, js-source.mjs, declarations.mjs, flags.mjs (read-the-codebase), sbom.mjs (list-the-dependencies, the CycloneDX 1.5 list) and evidence.mjs (check-the-evidence).
- The security reviewer 0.3.3's secrets.mjs (the credential scan and scrub) and trace-programs.mjs (what each program reaches and starts), byte for byte; its reach / spend / never-do words in section 7's prompt.
- The shared model caller (Common Agent 12.4.1): lines 1 to 488 of adlc 7d66f36's agents/package-maker/shared/model-caller.mjs, byte for byte. Its command-line block (lines 489 to 499, which read PROMPT_FILE) is left out, because the plugin's Code gate refuses a script that reads a variable the agent's files do not declare, and Inspect never starts the caller as a command. The coordinator chose this way around the gate on 2026-11-25; it is a divergence from the shared file, to raise with the owner.
- Not carried: the reverse engineer's archive.mjs (it refuses any archive holding a link, and GitHub's archive of a repository with a link always holds one), its request reader, and its rebuild parts (carried tests, baseline, behaviors, interfaces, kinds).
- From the repo family (packages/repo in AgentMesh): how repo-architect fetches a commit, one GET of /repos/{owner}/{name}/tarball/{ref} with a size cap, and the archive header's commit. Its GitHub client is not carried, because it reads only as the platform's GitHub App, whose key an agent put on AgentMesh from a build folder cannot carry; Inspect reads public repositories anonymously, at most six calls a job. Its archive reader keeps no lockfiles, so it is not carried either.

## Where it lives

The build folder is agents/inspect on branch adlc/inspect of AgentMesh-Dev-Test/adlc-plugin-proof, the place plugin builds go. The agent repository AgentMesh reads is https://github.com/AgentMesh-Dev-Test/inspect: the package under package/, and what it was built from under source/. It is not in AgentMesh's packages/repo: AgentMesh's own gates scan every file of a package there, the byte-pinned copies among them, which may not be edited.

## Dev

- OSV's address is the setting OSV_API, bound in dev's env/dev.json (AgentMesh PR 1035, merged; dev services deployed with deploy.sh) and in the dev fleet host's /opt/fleet/env/dev.json (backup dev.json.bak-osv-20261125T133731Z). Production has no binding yet.
- 0.1.0 was filed at 7:18 am Mountain time on 2026-11-25 (deploy request dr_bHQNgH4wvfdYbPbkjUk08yOl), approved by the platform's deploy key and running as inspect.platform@agentmesh.ai at 7:21. Its conformance check came back inconclusive (7 cases inconclusive, 1 flagged for review, none failed).
- 0.1.1 (the human-step facts from a skill's instructions and from a question offering an approval, found missing by the first proof) was filed as an update through the same ticket (dr_gXLdCrSNZvnXCgwCertOK5yS), approved as asking for nothing new, and running at 7:32.

## The proof on dev: langchain-ai/design-agent at 86d8f66

0.1.1 answered in about four minutes (job 01a21320-1e86-7000-9a83-38addc5c2ae4): 224 findings in the eight sections, none held back, 1,116 facts, 4 GitHub calls, 9 OSV calls, 3 model calls. The report fits its own schema, and the commit is marked checked. Against what was read by hand:

- 35 skills: the report counts 36 of the agent's own, and 15 more kept for coding assistants under .agents/skills (S3-001, one SKILL.md for each under skills/). The repository's own docs/architecture/context-and-failures.md line 16 says 36 skills, so the hand count was one short.
- 5 systems: the report finds 10 (S5-010 to S5-019): Slack, LangSmith, the model providers, Google Gemini audio and grounding, HeyGen (skills/media-use/audio/scripts/lib/heygen.mjs:16), ElevenLabs (lib/tts.mjs:31), PostHog telemetry (skills/media-use/scripts/lib/telemetry.mjs:13), GitHub, Paper and MCP servers, and run-time downloads. The hand count missed the skill scripts' services.
- 2 steps that need a person: confirmed. The plan approval (S4-009, skills/faceless-explainer/SKILL.md:94) and the approval before the final render (S4-010, skills/hyperframes-cli/SKILL.md:27; S4-011, src/design_agent/pipelines/launch_film.py:178). No tool call waits for a person in code: interrupt_on is an empty mapping (S4-012, src/design_agent/assembly.py:362).
- Apache-2.0: confirmed (S2-004, LICENSE:1, and GitHub's record).
- Two skills that can be lifted out, brand-lint.mjs and contrast-report.mjs: brand-lint.mjs is confirmed, with workspace/tools/toolchain.mjs, which it imports from its own folder, reading two settings with defaults (S3-103; toolchain.mjs:39 and :40). contrast-report.mjs cannot be lifted out on its own: its package-loader.mjs loads a package whose name it works out at run time (S3-112; package-loader.mjs:54) and installs it with npm when it is missing. In all, the report finds 59 scripts that can be lifted out.

## 0.1.2: the findings reach the sender while the job runs

What changed: the one emitter (scripts/emit.mjs) posts each finding to the running job as a piece named by its id (S3-014 and so on) as soon as it is found. It posts a status line as each stage begins. Both go as lines of the job folder's updates.jsonl, which adapter 0.102.0 reads while the job is open and applies to the job's A2A Task.

What the dev fleet needed, dev only, each change backed up:

- Adapter 0.102.0 on the fleet host. The dev fleet ran 0.100.2-dev.2, so 0.102.0-dev.1 was packed from AgentMesh main (tools/pack-adapter.mjs --env dev) and installed with npm install -g.
- MESH_ADAPTER_JOBS=/mesh/jobs/node-platform on mesh-node-platform, so the adapter's job folders are on the shared mount where the worker writes. The setting lives in /opt/fleet/mesh-node-platform.jobs-on-mount.config.js, which wraps the generated /opt/fleet/deploymgr-agents.config.js. pm2 keeps it, and it survived the 0.1.2 install. The permanent home is the deployment manager's template (an adlc change, not made).
- A one-second metadata cache on the /mesh mount (gcsfuse --metadata-cache-ttl-secs=1 in /etc/systemd/system/mesh-state.service; backup mesh-state.service.bak-ttl-20261125T152150Z).
  - With gcsfuse's default of 60 seconds, the adapter saw updates.jsonl grow once a minute.
  - Its last read before the reply could miss the end of the file: the first proof put 179 of 226 findings on the Task.
  - The host's reads now and then get ESTALE (-116) while the worker rewrites the file. The adapter reads again the next second, and nothing is lost.

The proof, on the sender's Task as the core holds it: langchain-ai/design-agent at 86d8f66, sent at 8:36 am Mountain time on 2026-11-25, Task 01a21359-827b-7000-b162-bad4902a3d13.

| After the send | On the sender's Task |
|---|---|
| 3 s | the Task is open |
| 15 s | the first status line: reading GitHub's records |
| 23 s | the first 4 findings |
| 62 s | 93 findings |
| 82 s | the scripts' findings all there; asking the model about sections 3 to 5 |
| 152 s | asking about sections 6 to 8, with sections 3 to 5 posted |
| 254 s | writing section 1 |
| 262 s | Done: all 217 findings on the Task |
| 267.5 s | the answer reaches the sender |

The first finding reached the sender 244 seconds before the answer. The scripts' findings took a minute to arrive, because every append on the worker's mounted bucket uploads the whole file again. 0.2.0 writes each batch at once.

## 0.2.0: the report's view, the Markdown copy, and the working copy

To the published Common Agent Specification, Section 6.13, and the Descriptor to user interface binding 0.2.0, Section 9 (CommonAgent/common-agent-standards main at 6d47910).

- **The report's view, views/report.html.** One self-contained file, declared in views[] by its digest for the output inspection, asking only for resize, copy-text and save-file.
  - It opens on At a glance, with the risks by level.
  - Then come the eight sections, one line per finding, with its level, its category and its file and line.
  - Risks sort by level, and a person can filter by section and by level.
  - A person can copy each finding with the address of its line at the commit, and save a plain-text summary for security.
  - Each level is a word and a shape (critical an octagon, high a triangle, medium a diamond, low a ring), never a color alone.
  - Colors and fonts come from the --ca-* tokens, each with a fallback for light and for dark.
  - It loads nothing, names no address, and runs under its own content security policy as well as the host's.
- **The working copy.** Each write of updates.jsonl ends with the report so far, posted under the report's own name, inspection.
  - It is marked partial, with the stage the job is at, and is re-posted whole, replacing the one before.
  - It must fit one piece (60,000 characters). Findings go without their words when they do not fit. When that still does not fit, findings with no level are left out from the largest section first, and the copy counts them.
  - So the view draws the findings so far while the job runs, and the delivered report replaces the copy.
  - The report's schema says so: a partial member, and a short finding for the copy.
  - The writes are batched once per turn of the event loop. The scripts' findings are now one upload, where they were one upload each in 0.1.2.
- **inspection.md.** The same report as Markdown for the plain page.
  - Each level is in words, and each place is a link to its line on GitHub.
  - Every character from the repository or the model that could start a link, an image or a tag is made plain.
- **Words for a person (6.13.1, 6.13.8).**
  - The name "Inspect", a one-sentence summary, and an about for each input written for a person.
  - An example: design-agent at 86d8f66, with what a good result looks like.
  - The specification gives a label to settings, not to inputs, so the inputs carry their sentence in about.
- **The count of risks by level** leaves out section 1, which repeats findings of the other sections.

How the view was checked, by a stand-in host that played the host's side of the bridge:
- It ran in headless Edge, started hidden and driven over the DevTools protocol.
- The view was in a sandboxed frame under Section 9.3's policy.
- The fixtures were the delivered design-agent report, a working copy as it stands after the model's first answer, a working copy that then changes, and an empty report.
- It covered light, dark, the fallbacks with no tokens, a stopped job, an accepted report and a narrow frame.

What it found:
- In every case the view said ready within 50 ms of loading and asked only for what it declares.
- It reached nothing on the network, and it could not read the host's page (SecurityError).
- The design pass, made from the screenshots, fixed four things:
  - zero-count tiles that kept the danger color;
  - an empty level column in sections with no levels;
  - paths cut before the file name and line;
  - a frame that never shrank after a filter.

The 0.2.0 install and proof on dev:

- 0.2.0 was filed as an update through the deploy ticket and approved as asking for nothing new. It has been running since 9:14 am Mountain time on 2026-11-25.
- The installed package holds views/report.html at its declared digest, sha256:c61e8f8d1966a80a6ed8be76f13022e00e8ad1d8896bc3c85f8fc3b018c957d9.
- The route a view host will read it from, GET /v1/agents/:key/views/:digest, is being added by the views-host work. It answered 404 on dev at the time of the proof.

The design-agent proof, sent at 9:14 am Mountain time, Task 01a2137c-d5b8-7000-8b47-27ecefdfb11e:

| After the send | On the sender's Task |
|---|---|
| 2 s | the Task is open |
| 12 s | the first status line |
| 20 s | the first working copy, with no findings yet, and the stage |
| 24 s | the first findings |
| 28.6 s | all 143 of the scripts' findings, and a working copy holding them; asking the model about sections 3 to 5 |
| 80 s | sections 3 to 5 posted (175 findings), and a working copy holding them |
| 179 s | all 226 findings, and the last working copy (47 KB) |
| 182.3 s | the answer reaches the sender, with inspection.json, inspection.md and sbom.cdx.json |

The delivered report fits its schema. The answer came 85 seconds sooner than in the 0.1.2 proof, because the scripts' findings are now one upload.

## 0.2.1: the delivery reaches the sender, and the view says when it did not

- **The delivery.** From 0.1.0 to 0.2.0, the job's files never reached the sender. The adapter's collector (jobCollect) drops every pieces.json entry that names no step, and Inspect's entries named none. So the answer went out with no job manifest and no files: no inspection.json, no inspection.md, no sbom.cdx.json.
  - The proofs above read the report from the job folder on the bucket, not from the delivery, so they did not show it.
  - The views-host work found it: a run from the Next app on dev ended answered with no versions.
  - Each entry now names its step, the offering's id inspect-a-repository, as the channel packages do, with one sentence saying what the piece is.
  - test/report.test.mjs [F5.A4] holds every entry to what the collector needs.
- **The view, when the job ended and only the working copy arrived.**
  - The host sends view/data once more with job_state completed and lifecycle null: answered without its deliverable (DESCRIPTOR-UI Section 6, rule 1).
  - 0.2.0 still drew Running, because the working copy says partial.
  - 0.2.1 reads the job's state first. It draws "Finished, but the full report did not arrive", with the findings that were posted. A failed or canceled job still draws as stopped.

The 0.2.1 install and proof on dev:

- Filed through the deploy ticket and approved as asking for nothing new. It has been running since 9:50 am Mountain time on 2026-11-25.
- The design-agent proof was sent at 9:51 am; its Task was 01a2139e-55ad-7000-b12a-b25b07e8f631.
  - The Task completed in 177 seconds.
  - Its answer carries the job manifest with all three pieces, each with step inspect-a-repository: inspection (1,024,391 bytes), inspection-md (179,075 bytes) and sbom (175,405 bytes). Their files are on the answer for the sender.
  - The 0.2.0 proof's answer, read the same way, carried the words alone.
- GET /v1/agents/:key/views/:digest on dev now serves views/report.html for sha256:e8d075de783125c609b0a85569056f6046b3853d33b248c9ec004ed54bc3a3e5, and the bytes hash to it.

## 0.2.2: three flaws in the report's view

A run from the Next app on dev showed them, drawing the delivered design-agent report of 225 findings (job 01a213f4-c082-7000-8420-b9df3a0654ba, Inspect 0.2.1). Only views/report.html changed, with its tests, its digest and the version.

- **Every item At a glance shows its level.**
  - "Which tools run without an OK" (S1-001) drew an empty level column.
  - It repeats S6-011, a finding of kind autonomy. Only risks carry a level, so it has none.
  - The view now draws a finding with no level as "Not rated", with a shape of its own, an open square.
  - An item At a glance takes its own level, else the level of the finding it repeats.
  - The level filter says Not rated too, with the square. So does a row with no level in a section that has levels (S7-027 and S7-028 here).
- **The counts say what they count.**
  - The report's total, 225, holds section 1's five findings, which repeat findings of sections 2 to 8. The filter counts sections 2 to 8: 220.
  - The head now says "225 findings: 220 in sections 2 to 8, and 5 at a glance that repeat them".
  - At a glance says "5 findings, each repeated from sections 2 to 8".
  - The filter says "Showing 220 of the 220 findings in sections 2 to 8".
  - The total stays the report's own, as inspection.md and the reply give it.
  - A working copy that leaves findings out says how many more arrive with the report.
- **Section 7's titles are whole.**
  - A row held the level, the title, the category and the file and line on one line. The title, kept to that line, got what was left: a few characters in a 690-pixel frame.
  - A row is now the level, then the whole title, wrapping, with the file and line under it, then the category.
  - At a phone's width, the level and the category share the first line, and the title takes the row's whole width under them.
  - A path may break after each folder. The category keeps its +N however long its first id is.
  - The open row no longer repeats the title, which the row now shows whole.

The tests:
- test/view-draw.test.mjs runs the view's own script against a stand-in page in a vm context, with no browser, and holds the three fixes.
- Each of its four tests fails on 0.2.1's view.
- The suite: 77 tests, 76 pass, one skipped.

How it was checked in a browser:
- A stand-in host like 0.2.0's, made again for this: the Section 9.3 policy, a sandboxed srcdoc frame, the host's side of the bridge.
- It ran in headless Edge, started hidden.
- It drew the 225-finding report, delivered, with lifecycle draft: at a 1440 window with a 690-pixel frame, and at a 400 window with a 368-pixel frame, each in light and in dark.
- In each the view said ready, asked only for resize, reported no failure and scrolled nothing sideways.
- The screenshots show each item At a glance with its level, the three counts agreeing, and every title of section 7 whole, folded and unfolded.

It was made in the agent repository directly. The build folder in adlc-plugin-proof still holds 0.2.1's view.
