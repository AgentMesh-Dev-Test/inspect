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

The 0.2.2 install and proof on dev:
- Filed through the deploy ticket at 11:50 am Mountain time on 2026-11-25 and approved as asking for nothing new. It has been running as inspect.platform@agentmesh.ai since 11:54 am.
- Dev's Descriptor for it, GET /v1/agents/:key/descriptor, gives agent_version 0.2.2 and names views/report.html at sha256:476fb1bdf933f94b7ee7f8fe308d3fb5f688961053090a27062080f570a8f803.
- GET /v1/agents/:key/views/:digest serves the view for that digest, 46,037 bytes, and the bytes hash to it.
- No live run was made: the view draws the report as 0.2.1 delivers it, and the stand-in host drew a delivered one.

## 0.2.3: the report's view in five tabs

The owner approved the design on 2026-11-25 ("Go do it"). The report was one long page; it is now five tabs under its head. Only views/report.html changed, with its tests, its digest and the version.

- **The tabs.** Overview (sections 1 and 2), What it does (3 and 4), What it reaches (5 and 6), Risks (7), and Tests and gaps (8).
  - The head (the repository, the commit, the dates, the counts) and the status line (Running, Draft, Accepted, Published) stay above the tabs, so every tab shows them.
  - Each tab's label gives the prefix its findings' ids carry (S7 for S7-010), its name and its count of findings. The five counts add up to the report's total.
  - Risks also names the highest level in section 7, as a word and its shape ("25 · ▲ High"). A level is never a color alone.
  - Overview holds At a glance (the risks by level and the judgments it repeats), then What was inspected, then "Save a summary for security", which moved there from the head.
  - The level filter is on Risks and counts section 7. The tabs take the place of 0.2.2's section filter.
  - A judgment held back is listed on the tab that holds its section.
- **While the job runs.**
  - A tab none of whose sections has arrived says "Nothing here yet", names its sections as waiting, and shows "…" in place of a count, with a dotted rule under it.
  - A tab with some findings and more to come shows its count so far with a live dot and the dotted rule. Each section still to come says that more findings arrive once the model has judged it.
  - The view knows what is still to come from the findings themselves: the scripts' findings arrive at once, and a call of the model has answered once one finding of its sections (3 to 5, or 6 to 8) is the model's or says the judgment was not made. Section 1 comes last.
  - A count includes the findings a working copy leaves out to stay small (the report's counts by section), and the section says how many more arrive with the report.
  - New data never changes the tab. Focus is put back where it was after each redraw, on a tab, a row, a filter or a button.
- **"See S7-010".** It opens the tab that holds the finding, lets go of a level filter that would hide it, unfolds its section if it is past the first twelve, opens it, and brings it into sight once the host has fitted the frame to the tab.
- **The ARIA tabs pattern.** A tablist of five tabs, each controlling its tabpanel; only the open tab is in the page's tab order; the arrow keys, Home and End move between the tabs and open the one moved to; a tab has a focus ring of its own.
- **At a phone's width** the tab strip scrolls sideways inside itself, with a fading edge where more tabs lie, and keeps the open tab in sight. The page never scrolls sideways.
- **The frame.** After every change of tab the view sends view/resize, even when the height has not changed.
- The frame keeps nothing between visits, so the view always starts on Overview.
- Everything 0.2.2 drew is kept: Not rated with the open square, the count wording, section 7's whole titles, Copy, the summary for security, and light and dark through the host's --ca-* tokens.

The tests:
- test/view-draw.test.mjs holds 0.2.2's four tests, moved onto the tabs, and six new ones: the five tabs and their counts in the ARIA pattern; a See link opening another tab, and one past the fold; a tab waiting while the job runs, with the counts climbing as the model answers; the tab staying put, with its focus, when new data arrives; and the keys, each change asking the frame to fit.
- Each of the ten fails on 0.2.2's view.
- The suite: 83 tests, 82 pass, one skipped.

How it was checked in a browser:
- test/view-host.html is now kept in the repository: a stand-in for Next's host (app-next/src/view-frame.ts) with an iframe sandboxed with allow-scripts alone, Section 9.3's policy laid into the view's document, the host's side of the bridge, and the twelve tokens read from Next's own light and dark values.
- test/view-shots.mjs opens it in headless Edge, started hidden, and saves a screenshot of each case with what the host heard.
- The cases: the report delivered by the 0.2.2 run on design-agent at 86d8f66 (223 findings) and that run's working copy after the model's first answer (178 findings), each on Overview and on Risks, at a 1440 window with a 690-pixel frame and at a 400 window with a 368-pixel frame, in light and in dark; and the working copy with no findings yet, on What it does.
- In all 17 the view said ready within 30 ms, asked only for resize, sent nothing outside the bridge and scrolled nothing sideways. At 400 the tab strip scrolled inside itself.
- The design pass, made from the screenshots, fixed three things:
  - a dotted rule under the open tab while it filled, which read as broken (the open tab now always has its solid rule);
  - waiting tabs 160 pixels tall: their class shared the name of the page's own "waiting" line and took its padding;
  - three signals for one fact on a waiting tab (the live dot is now only on tabs that are filling).

The 0.2.3 install and proof on dev:
- Filed through the deploy ticket at 1:32 pm Mountain time on 2026-11-25 and approved as asking for nothing new. It has been running as inspect.platform@agentmesh.ai since 1:36 pm.
- Dev's Descriptor for it, GET /v1/agents/:key/descriptor, gives agent_version 0.2.3 and names views/report.html at sha256:84fd9268110c5784a54f9de398d872e21067d9a2d0969cdc382aa9cca21d5f0f, asking for resize, copy-text and save-file.
- GET /v1/agents/:key/views/:digest serves the view for that digest, 60,653 bytes, and the bytes hash to it.
- One live run from the Next app on dev, as a new dev test account of ours (made for the run, closed after it), on langchain-ai/design-agent at 86d8f66, in headless Edge at a 1440 window in light: job 01a2146e-26af-7001-812c-f40f75a1911a.

| Mountain time | In the view |
|---|---|
| 1:38:13 pm | sent from Inspect's page |
| 1:39:03 pm | the first findings: 143 so far; Overview 6, What it does 113, What it reaches 9, Risks 9 and Tests and gaps 6, each still filling |
| 1:39:56 pm | the model's answer on sections 3 to 5: What it does settles at 129, What it reaches climbs to 25 |
| 1:41:57 pm | delivered: 228 findings, 223 in sections 2 to 8 and 5 at a glance; Overview 11, What it does 129, What it reaches 36, Risks 31 (highest High) and Tests and gaps 21 |
| 1:42:06 pm | the view draws the draft, still on Overview |

- The view stayed on Overview through every update; it moved only when Risks was clicked.
- The screenshots (1440 wide, light): one while it ran with the counts climbing, one on Overview when it finished, one on Risks.

## 0.2.4: the whole view is tabs, with no commentary

The owner rejected the result page again on 2026-11-25 ("Fix it"): the tabs sat under a head, the status line and lines that explained the counts, and the page carried remarks about how the report was made. Only views/report.html changed, with its tests, the stand-in host, its digest and the version. The host's side (the Next app's job page) changed in AgentMesh at the same time.

- **One row of six tabs, with nothing above it.** Overview, What it does, What it reaches, Risks, Tests and gaps, and About Inspect.
  - The view's own head is gone: the eyebrow, the repository's name, the commit and dates line, the count sentence and the Running, Draft, Accepted, Published line. The host's header names the repository.
  - No section codes on a tab. The first five carry a small count; Risks also names its highest level as a word and a shape.
  - The ARIA tabs pattern, the keys, view/resize after each change of tab, and the tab staying put when data arrives are kept.
- **Overview:** the risk tiles (each opens Risks at its level), the top judgments, each with its level and a link that reads "See it in Risks" (or the tab that holds it), what was inspected as a label and value list (license, what it is built on, how actively it is kept up, publisher, the commit in seven characters), and a plain "Save a summary for security" button.
- **Rows show only the title, and on Risks the level.** Opening a row shows the finding's words, where it is in the code (file and line), the category by its plain name from the OWASP lists, and Copy. No file, category code or Copy on a closed row.
- **Inside the tabs:** a tab of two sections has two plain headings (What it does and How it works; What it connects to and What it can do on its own); a tab of one has none. No numbers and no counts in headings. Every row is shown; nothing folds.
- **Risks:** the level filter; the risks highest first; what it needs to run safely (least access and approvals) under "To run it safely". No line saying how many are shown.
- **Tests and gaps:** section 8, and any judgment held back under "Held back".
- **About Inspect:** what it does (the Descriptor's summary), how it works (scripts collect the facts, a model writes the judgments and cites them) and what it doesn't do (its first two refusals), from the Descriptor the host hands in view/data, with Inspect's own words when the host hands none.
- **Removed:** every sentence that explained a count, a section or how the report was made: "5 findings, each repeated from sections 2 to 8", the report's total split by section, "Showing 31 of the 31 findings in section 7", "This section is written last…", "This copy leaves out each finding's words…", the footer, the security box's description, the waiting card, the lines under sections still to come, "Written by", "Level, as the model judged it", and a finding's id in a toast.
- **While running:** the counts fill in, a tab with nothing yet shows "…", and one line under the tabs says what Inspect is doing in a few words ("Reading the code", "Judging what it can do on its own, its risks and its tests"), mapped from the stage its working copy names. It is gone once the report is done. A job that stops says so in one line in the same place.

The tests:
- test/view-draw.test.mjs is rewritten for the six tabs: the tab set with nothing above it; rows closed by default with the evidence only when opened; Overview; See it in Risks; the Risks filter and its groups; the headings; About Inspect from the Descriptor; the line while running; the tab staying put; the keys; and a test that fails if the page draws any of "repeated from sections", "findings: ", a section or category code, a status word, a full commit or "Drawn by".
- The suite: 84 tests, 83 pass, one skipped.

How it was checked in a browser:
- test/view-host.html no longer draws a heading of its own and hands the view the Descriptor; test/view-shots.mjs can open rows (`open` in a case).
- In headless Edge, started hidden: a synthetic report shaped like design-agent's (223 findings) on each tab at a 1440 window with a 960-pixel frame, delivered, while running and with nothing yet, in light and dark, and at 400 with a 368-pixel frame. The view said ready within 45 ms, asked only for resize, sent nothing outside the bridge and scrolled nothing sideways.
- The design pass fixed three things: the tiles did not fill their grid cells, a zero tile drew its shape in the danger color, and an open row's words sat a few pixels left of its title.

The 0.2.4 install and proof on dev:
- Filed as an update through the deploy ticket at 3:31 pm Mountain time on 2026-11-25 and approved as asking for nothing new. It was running as inspect.platform@agentmesh.ai by 3:45 pm.
- Dev's Descriptor for it gave agent_version 0.2.4 and named views/report.html at sha256:c7483d42a54a874cdf729893642eb723f092e532c8c66c48e794759c1ac55f54; GET /v1/agents/:key/views/:digest served 49,312 bytes that hash to it.
- One live run from the Next app on dev (the job page rebuilt in AgentMesh at the same time), as a new dev test account of ours, on langchain-ai/design-agent at 86d8f66, in headless Chromium at 1440 wide in light: job 01a214f3-5baa-7001-b4fa-43273a0f38a8. Sent at 4:03:43 pm; at 1 min 24 s the view showed Overview 6, What it does 127, What it reaches 21, Risks 9 and Tests and gaps 6, filling, with "Judging what it can do on its own, its risks and its tests" under the tabs; delivered by 4:08:47 pm with 215 findings (Overview 11, What it does 127, What it reaches 32, Risks 29 with the highest High, Tests and gaps 16). The page's text, the host's and the view's, held none of "Drawn by", "Delivered", "A draft until you accept it", "repeated from sections", "findings: ", "S7-", "LLM0" or a 40-character hex.

## 0.2.5: what a tab opens on

The cut pass on 0.2.4's live screenshots found two things, fixed here. Only views/report.html changed, with its tests, its digest and the version.

- **A section opens on the model's judgments, then the scripts' lists.** What it does opened on "Its skills" and 36 skill names before the jobs the agent does; What it reaches opened on credentials before the systems they reach. Rows are now ordered by level, then by kind (the jobs, outputs and inputs; the systems and spend; which tools run without an OK; how it runs; what Inspect couldn't tell; then the tests, tools, credentials, skills and parts), then the report's order.
- **The All chip on Risks carries no count.** It counted the risks (27) while the tab counted section 7 with what it needs to run safely (29): two numbers for one tab. The level chips keep theirs.
- **Code in the model's words** (`interrupt_on`) is drawn in the code face, without the backticks.
- The suite: 85 tests, 84 pass, one skipped. The new test fails on 0.2.4's view.
- Checked in the stand-in host with 0.2.4's delivered design-agent report (215 findings) on each tab, light and dark: ready within 50 ms, only resize asked, nothing outside the bridge, nothing sideways.
