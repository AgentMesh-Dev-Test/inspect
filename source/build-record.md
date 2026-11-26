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

The 0.2.5 install on dev: filed through the deploy ticket at 4:14 pm Mountain time on 2026-11-25, approved as asking for nothing new, running by 4:17 pm; dev served views/report.html at sha256:2bac3c5a039d6eca577b1850fbb40bfc71b47be94195b1c2d87d839b130c5af7.

## 0.2.6: plain words everywhere a person reads

The coordinator's second review of the live screenshots (2026-11-25), against the ui-design skill. The scripts, the model's instructions and their check, the Markdown report and the view changed, with their tests.

- **A package's known security flaws are one finding.** It was one finding per advisory, titled "@hono/node-server 2.1.5: GHSA-jpvv-r467-5p4w", five rows for one package. Now one finding per package at its version, titled "<package> <version> has known security flaws" (or "a known security flaw"), at the highest level of its advisories; each advisory's summary, the version that fixes it and its id are in detail.advisories, and the view shows them only in the opened row.
- **Titles a person reads.** A skill is titled by its own one-line description when the repository gives one, else by its name with spaces ("Brand design", never "brand-design"); a script part by its name with spaces; a credential by its setting's name in words ("Gemini API key"); a committed credential as "in the code" or "in a test file", with the file in its evidence. The findings that sum up a list are titled "Skills" and "Tests", and the view draws them as the list's subheading, never as a row. The view says older reports' slugs and setting names in words too, with the name in the opened row.
- **The model writes for a manager.** Its instructions (judge.mjs PLAIN_RULE) forbid file and folder names, paths, line numbers, names with underscores or dots, calls, command lines, version tags, advisory ids, finding codes, backquotes and the word facts. checks.mjs notPlain holds back a judgment or an At a glance line that breaks it, with why, as it does a verdict. The words Inspect's own reasons used ("what the facts show") are now "what the code shows".
- **The Markdown report is plain** (the Plain page and its download): headings without numbers, no finding codes, categories in words ("Supply chain"), the short commit in the text and in each line's link, sources said as "GitHub's records", no remarks on how the report was made and no closing line about the JSON. A package's advisories are listed by id with the version that fixes each. The declared convention in the Descriptor says so. The data (JSON) download keeps its codes.
- **The view:** no count on any tab (Risks keeps its highest level); a judgment's title on Overview is the link to it, with no "See it in" line; each section's lists under subheadings (What it takes, What it hands back, Skills, Scripts; Where a person steps in; Credentials; Tools; What Inspect couldn't tell, Gaps in the tests, Tests); a heading that repeats its tab's name is left out; on Risks a Not rated chip when a risk has no level, so the chips add up to the rows.
- The suite: 89 tests, 88 pass, one skipped. New tests: the advisories grouped, the plain-words check, the Markdown's banned strings (finding codes, LLM and ASI codes, a full commit, the JSON's file name, "the facts"), the groups and subheadings, and the advisory row.

The 0.2.6 install and its proof on dev: running by 4:52 pm Mountain time on 2026-11-25 (view at sha256:9586aef0be079d7364f41265b46ae22e23b9149c4c0802b5bbd5a7bcdd159d0e). One live run from the Next app as a new test account, langchain-ai/design-agent at 86d8f66, job 01a21521-9b4a-7000-87c3-a23a0644ded2: sent 4:54:14 pm, delivered 4:57:12 pm. The cut pass on its screenshots found what 0.2.7 fixes.

## 0.2.7: what 0.2.6's live run still showed

- **Skill titles.** Eleven skills were titled ">": their SKILL.md describes them in a folded YAML block, which the reverse engineer's facts keep as the marker alone. Others read "INVOKE THIS SKILL when…", "composition''s" and an em dash. A block marker now gives the name with spaces; a trigger phrase ("Use this skill when", "INVOKE THIS SKILL when") is dropped, shouted words are lowered, doubled quotes undone and an em dash becomes a colon.
- **Advisories.** A summary that opens with the package's own name ("Hono: …") drops it; the view draws code in a summary in the code face, without its backquotes.
- **The dependency list's gaps** were three rows titled with a path each ("Not in the dependency list: the versions installed for skills/…/package.json"). They are one finding, "Some versions are missing from the dependency list", with the paths in its words and its evidence.
- **"the facts".** About Inspect read "Scripts collect the facts…", from the Descriptor's own words; the Descriptor and the plugin now say "Scripts read the code by rule; a model writes only the judgments, and each judgment cites the lines it rests on." The model wrote "the facts" in three judgments, which 0.2.6 held back; 0.2.7 says it as "the code" (checks.mjs plainWords) and keeps them, and the model is told to write "the code shows". A held-back reason no longer quotes the words it holds back. "npm" said in passing is plain; a command as typed ("npm install", "npx", "through gh") is not.
- The suite: 90 tests, 89 pass, one skipped.

The 0.2.7 install and its proof on dev: running by 5:06 pm Mountain time on 2026-11-25 (view at sha256:c428efdf64a4bb7f261a23672275ecc61c0aea28633c437d186f2f22564775f3). One live run from the Next app as a new test account, langchain-ai/design-agent at 86d8f66, job 01a2152d-0b05-7001-b1df-ae1ee83aafd2: sent 5:06 pm, delivered 5:09 pm.

## 0.3.0: a page that does the person good

The owner used 0.2.7's page: "if it does no good, you shouldn't put it on there in the first place." Who is on the page: someone deciding whether to bring an outside agent into their plan, who opened the job when Inspect finished. Their questions: what is this agent and what does it do; how much is really there; what does it need from me to run; should I worry. Their next step: run it on another repository, or hand the report to security.

- **The view: five tabs, no About tab.** The Overview describes the whole agent: the model's description (two to four sentences, a new section 1 finding of kind description), how much is there (skills, scripts and their lines of code, its own code, tests and how many run offline, outside systems and how many are required), what was inspected, and two lines about Inspect at the foot. No risk is on it.
- **Nothing dead on the page.** No opened row shows a file and line ("In the code: skills/stills/SKILL.md:2" did nothing for the person); the evidence stays in the Markdown and the JSON. The frame is sandboxed with allow-scripts alone and DESCRIPTOR-UI 0.2.0 has no request that opens a link, so advisory ids are left out (each flaw's summary and fix stay) and the repository's address at the commit is a Copy link button (view/copy-text).
- **What it does.** Jobs name the skills that do them (the skill facts each job cites). Skills come the most substantial first, each with its size in words ("23 scripts · 3,461 lines · tested", or "Instructions only") and a thin bar for its lines; opened, what it does, the systems it uses, the tests that name it, whether it lifts out, and Read the skill. Scripts sit in their skill's size, never in a list of their own; the agent's own code is one row, its size and, in the model's words, what it covers.
- **The viewer.** A skill's instructions (carried in the report, up to 8,000 characters each and 250,000 in all, with the file's address at the commit past that) open beside the list at a desktop's width and as the whole frame at a phone's. The text is drawn as text: headings, paragraphs, lists and code from its Markdown, no markup, no image, and a link's words without its address.
- **What it reaches.** One row per outside system, credentials folded into their system: what it is used for, Required, Optional or Unclear as a word and a shape, and what the person supplies; required first. Opened: what uses it, what happens without it, what goes to it. The scripts now note for each setting whether the code has a default, a guard that skips the feature, or stops without it (collect.mjs howRead), and what the setup docs and the example settings file say (facts setup-doc and example-setting); the model judges need, supply, without and sends from them and cites them, and says "unclear" when they don't settle it.
- **Risks** holds the risks by level, which are the filter, Save a summary for security, and every risk highest first from any section; a risk and its fix are one finding (detail.safe; the model writes no separate least-access or approval findings), and a package's flaws say the version to update to.
- **Tests and gaps.** Each test row says how many tests, of what kind, and whether they run offline (from the test-file facts it cites, which now carry their kind and whether they need live keys). The model is told to say each thing once, and checks.mjs nearSame holds back a title that says or asks what another of its section and kind says. Judgments held back stay in the report, off the page.
- **Words.** Skill names keep the repository's own capitals ("PR to video", "HyperFrames CLI", "ElevenLabs"; collect.mjs casedFrom), a folded YAML description is read, and the Markdown gives the commit's date only, never the inspection's, which a reader's time zone may move. Body text is 16px or more and nothing is under 14px.
- The suite: 93 tests, 92 pass, one skipped. A local run on the real repository with a stand-in model: 155 findings, the report 943 KB.

## 0.3.1: the cut pass on 0.3.0's live run

0.3.0 was running on dev by 9:52 pm Mountain time on 2026-11-25 (view at sha256:f21740062774ff937b58c3024f73cbe9a5c4a6521a359cebb97bc7fe789d5c29); one live run from the Next app as a new test account, job 01a21633-69d4-7000-b8ca-00f49659ba91, sent 9:53 pm, delivered 9:57 pm. Its cut pass:

- **One more thing removed:** the fifteen skills kept for coding assistants that work on the repository were a list of instructions-only rows that tell the person nothing about the agent; they are counted on the Overview and in the report, and no longer listed.
- The viewer lines up with the row it was opened from, not with its button.
- The note under Skills and the two lines about Inspect are 16px, like the rest of the body text (they were 15px).
- Single-underscore emphasis in a skill's Markdown ("_into_") loses its marks, as the other emphasis does.

## 0.3.2: a gap and its question are one finding

0.3.1 was running on dev by 10:03 pm Mountain time on 2026-11-25 (view at sha256:66de2a2816dc7833fce6d64fdf7cc1b2b5f483e0dfac88394b182223c0e2d181); one live run as a new test account, job 01a2163d-5c4d-7001-b12c-fa942f722f4d, sent 10:04 pm, delivered 10:07 pm. Its cut pass found Tests and gaps still saying one thing twice in other words: "What the approval list holds at run time" (what Inspect couldn't tell) beside "Which tools wait for a person by default?" (a question for the publisher). Different words, so the title check could not see it; the cause is two kinds for one thing. The model no longer writes kind question: each could-not-tell finding ends with the question to ask the publisher, so a gap and its question are one row. The suite: 94 tests, 93 pass, one skipped.

## 0.3.3: each skill in plain words, and nothing the header says

0.3.2 was running on dev by 10:13 pm Mountain time on 2026-11-25; one live run as a new test account, job 01a21646-6a49-7001-9829-fd3453ceef01, sent 10:14 pm, delivered 10:18 pm. The coordinator's cut pass on it:

- **A skill's rows repeated themselves in words written for a model.** The title was the skill's own trigger description cut short, and the opened row the same description in full ("Use for plain verbatim captions… Route by visual identity…"). The first call now answers "skills" as well: for each of the agent's own skills, a short plain name of three to eight words and one or two plain sentences on what it does for the team (judge.mjs SKILL_NAMES). checks.mjs checkSkillNames keeps a name of two to ten words with no full stop, and words of one or two plain sentences that don't say the name again, aren't written for a model and give no verdict; one that breaks a rule is held back and the skill keeps the scripts' title. The name becomes the finding's title and the words its says (detail.does); the skill's own description stays in detail.description and is shown only in the viewer, above its instructions. The first call's output budget is 20,000 tokens.
- **The note under Skills** ("Size and tests show how much is there, not whether it's good") was a disclaimer; it is gone.
- **"What it connects to"** under What it reaches meant the same as the tab; it is gone.
- **The repository row on the Overview** repeated the header and needed a Copy link because the frame opens no link. It is gone; the Next app's header now links the subject to the job's main input when that is an https address (AgentMesh PR, job-page.ts jobSubjectLink). The Overview keeps the commit.
- The suite: 95 tests, 94 pass, one skipped.

## 0.3.4: no row says its title twice, and the models in words

0.3.3 was running on dev by 10:40 pm Mountain time on 2026-11-25 (view at sha256:35bdc3ee229279d41f598f05a072f3422c634ccf9830a30957a9ba46451072db); one live run as a new test account, job 01a2165f-6ac4-7001-9e18-eb9b0dd4a513, sent 10:41 pm, delivered 10:45 pm. All 36 skills took the model's plain name and words, none repeating its name or written for a model. The cut pass, every row on every tab opened, found two more:

- "Skill scripts start other programs" opened on "Many skill scripts start other programs on their own." The model is told a finding's words never repeat its title, and checks.mjs repeatsTitle holds back one whose words carry its title of three or more words.
- "The models it names", a script finding, listed eighteen model ids as the code writes them and a configuration file's name. Its words now name the makers ("Its code names 18 models, from Anthropic, OpenAI, Google and ElevenLabs."), and the ids, settings and files are in its detail and, in the Markdown, after "Models as the code names them".
- The suite: 96 tests, 95 pass, one skipped.

## 0.4.0: the list the owner approved on 2026-11-26

The owner: "okay, go ahead and build our list". Built in the agent repository directly, as 0.2.2 onward were, with the ui-design skill (AgentMesh main, .claude/skills/ui-design) followed for the view. Who is on the page: someone deciding whether to bring an outside agent into their company, who ran Inspect from the Next app and is watching it run, or opened the result. Their questions: what is this agent and what does it do; how much is really there; what systems does it use and what must I supply; should I worry; and, while it runs, is it still working. Their next step: send a summary to security, or go back to the author with questions.

- **The commit defaults to the newest.** The descriptor's commit input is optional ("The commit to inspect, such as 86d8f66; left blank, Inspect reads the newest commit."). With no commit named, Inspect reads the repository's record, takes its default branch, and reads that branch's newest commit's record (github.mjs newestCommit), so a job still makes four GET calls. The report records the full digest, as before, and what was inspected says "the newest on main". A typed commit or a commit address inspects that commit; a branch name is still refused, now saying the commit can be left out; a message with no repository is refused and nothing is read. An empty `commit:` line is no value (request.mjs lineValue reads the key's own line only). The spec (F1.R1, R2, R7, the new F1.R11 and F1.A11), SKILL.md, prose.json and NOT.md say the same.
- **Overview.** The description is the anchor; how much is there is a row of tiles, each with its own icon drawn in the view (skills, scripts and their lines, its own code, tests and how many run offline, systems required); then what was inspected. The two lines about Inspect at the foot are gone, and nothing replaces them. This follows the owner over the ui-design skill, which still says a few lines about the tool belong at the foot.
- **Read the skill opens a dialog** over the page, with a veil, a Close button, Escape, and focus moved into it and back to the button it was opened from; the page behind is inert, and a wheel or a touch scrolls only the instructions. The frame is as tall as its content, so the dialog is placed in the part of the frame the person can see, which the browser gives through an IntersectionObserver (it reports the visible part of a cross-origin frame), and beside the row it was opened from when it does not. At a phone's width it is the frame's width less a margin. New data while it is open leaves it as it is.
- **Systems it uses** (was What it reaches): one card per system, with its mark, its name, what it is for, what the person supplies with a key beside it, and Required, Optional or Not clear from the code as a word and a shape. The marks are Simple Icons paths (CC0, 16.37.0) for Anthropic, Google, Gemini, Google Cloud, GitHub, GitLab, ElevenLabs, LangChain and LangSmith, PostHog, Docker, npm, MCP, Figma, Notion and some thirty more, drawn in the text's color; a system named as hosts or sites is a globe; any other is its first letter. Slack and OpenAI asked Simple Icons to take their marks out, so they are letters. Nothing is fetched. Section 5's title in the report and the Markdown is "Systems it uses" too.
- **While it runs.** One status under the tabs: "Inspecting · Step 3 of 5: Judging what it does and the systems it uses", a turning ring, and a bar for each of the five steps, done ones filled and the current one striped. Every field and list still to come is a loading placeholder: the description, the systems-required tile, the jobs, the systems, the risk counts and rows, the tests. Nothing moves with reduced motion. The working copy now carries the few fields of each finding's detail the view draws (report.mjs WORKING_DETAIL: what was inspected, a skill's size, the agent's own code, the count of tests, a system's need and supply, a risk's fix), so those fields are filled while the job runs; before, every skill's size, the Overview's facts and each system's need were empty until the report arrived, which is what the owner saw.
- **Tests and gaps is a document**: a heading per group (What Inspect couldn't tell, Gaps in the tests, Tests), each item's title and all its words, 68 characters wide, each test with how many tests, of what kind and whether they run offline; nothing opens or closes. Two items that say the same thing (an older report's gap beside its question) are one.
- **Skills.** Only the agent's own skills are counted ("36 Skills"). The skills kept for the coding assistants of the people who work on the repository are neither counted nor listed: they say nothing about the agent.
- **Required or Optional by rule** (collect.mjs settingNeed and systemNeed; checks.mjs). A setting the agent's own code stops without is required; one it skips a feature without or has a default for is optional; one read plainly is what the setup docs say, else optional when the example settings file leaves it commented out; one read only inside its skills is optional; one only its tests read is never needed. A system with a required setting is required; one whose settings are all optional, or that only its skills reach, is optional. Only where these leave it unclear does the model's answer stand; the report keeps the model's answer as need_by_model either way, and a credential no system names carries its need by the same rule. test/judge.test.mjs [F4.A8] proves it offline: the same facts under two opposite sets of the model's answers give the same need for every system the rule settles.
- The suite: 101 tests, 100 pass, one skipped.

The 0.4.0 install and proof on dev:
- Filed as an update through the deploy ticket at 8:08 am Mountain time on 2026-11-26, approved as asking for nothing new, and running as inspect.platform@agentmesh.ai at 8:12 am. Dev's Descriptor gave agent_version 0.4.0, the commit input not required, and views/report.html at sha256:df7aced2625a182999d54ccab7529df3eb092c4a4ef1dcfd4ef112430ddc9b42; GET /v1/agents/:key/views/:digest served 117,261 bytes that hash to it.
- One live run from the Next app as a new dev test account of ours, langchain-ai/design-agent with the commit left blank (the form now keeps it under More options): job 01a2186a-ea2d-7000-b598-62665b3762cb. Sent 8:13:09 am; the view at 8:13:58 am on step 3 with the Overview filled but for the description and the systems-required tile; step 4 at 8:15:47 am; done at 8:17:10 am. Delivered: commit 86d8f667796890eb6d3612dbd1b9e941782fe03f, the newest on main, checked; 208 findings, 3 held back; 4 GitHub calls, 9 OSV calls, 3 model calls. Five of thirteen systems took their need by rule, all optional; one was required, Anthropic, by the model.

## 0.4.1: the cut pass on 0.4.0's live run

Every tab at 1440 and 400, light and dark, every row opened, drawn in the stand-in host from the delivered report, and the live page's own screenshots. Found and fixed:

- **A risk said again what the scripts' findings say**: "Known flaws in render sandbox libraries" beside "hono 4.13.13 has known security flaws" and "@hono/node-server 2.1.5 has known security flaws". checks.mjs now holds back a risk that rests only on known flaws OSV has already rated (spec F4.R2).
- **The publisher row** said again the owner the host's header names, which the description also says. It is gone.
- **An instructions-only skill said so twice**, on its row and in its opened "On its own" line, which now says only "Can be lifted out as it is".
- **The dialog repeated the skill's size** under its title, as the row behind it says it. It is gone.
- **The plain words**: "Dependencies not checked against OSV" is "Dependencies not checked for known security flaws".
- **The first working copy** now goes out as soon as GitHub's records name the commit, before the archive is read, so a host following the job's Task can draw the view from its first seconds.
- The suite: 103 tests, 102 pass, one skipped.

The 0.4.1 install and proof on dev: filed at 8:27 am Mountain time, running at 8:31 am, view at sha256:9d04de7bdddcd91a43ba4d3a85c18d81fd70d234e1c86ab7461b1d21ec0e66cd served whole. One live run from the Next app as the same test account, design-agent with the commit left blank: job 01a2187c-5f68-7000-9a7e-072a1dfa2066, sent 8:32:13 am, the view at 8:33:02 am on step 3, step 4 at 8:34:37 am, done at 8:36:12 am; 209 findings, 2 held back, one of them the repeated flaws risk. The Next app showed its header and its Working chip and nothing else for the first 49 seconds in both runs: it learns the job's id only when its send returns, about 45 seconds in, and draws no view before then, whatever the job has posted. That is the host's, not the view's.

## 0.4.2: a system with nothing to set up is never required

The two live runs counted the required systems 1 and 2: the second run's model called "Setup download hosts" required, where the first called its download hosts optional; both read no setting and both said the person has nothing to set up. collect.mjs systemNeed now says a system it reads no setting for, where the person has nothing to set up, is nothing to set up (need none, by rule), drawn as its own word and a dashed ring and never counted as required. Applied to both runs' systems, each counts one required system, Anthropic. A supply the model could not name ("Not shown") is no longer drawn as a line under the system. The suite: 105 tests, 104 pass, one skipped. No third live run was made: the change is the rule and its drawing, both held by tests, and the screenshots draw the second run's report with the rule applied.

The 0.4.2 install on dev: filed through the deploy ticket at 8:43 am Mountain time on 2026-11-26, approved as asking for nothing new, and running as inspect.platform@agentmesh.ai at 8:46:54 am. Dev's Descriptor gives agent_version 0.4.2, the commit input not required, and views/report.html at sha256:798de65f1ed4e8edc13fd6577e6c156615014d7d697361dd7d01ca286b039f77; GET /v1/agents/:key/views/:digest serves 117,518 bytes that hash to it, and the Next app draws the second run's job with it (five tabs, fourteen system cards, each with its mark). The test account was closed afterwards. Production is untouched.

## 0.4.3: the view up at once, owner/name taken, plain status lines

The coordinator's four fixes, from the Next builder's live runs after its host fixes (Next now learns the job's id in about four seconds and reads its Task at once).

- **The first working copy goes out the moment the job starts**, before any call to GitHub, with the repository the request names and no commit yet (the report's schema now lets commit.sha be null in that copy alone); then again once GitHub's record names the commit, and once the archive is checked. The view draws it as "Inspecting · Step 1 of 5: Reading the repository" with every field a placeholder.
- **owner/name reaches Inspect.** A run with `langchain-ai/design-agent` was refused in 16 seconds with "it needs repository (a web address)". The refusal was AgentMesh's, not Inspect's: the adapter's input door (mesh-adapter.mjs inputFitGate, with agent-messaging's fitCheck) holds an input of kind url to a web address in the message, asks its converter, and when that fails answers with the standard INPUT_NOT_UNDERSTOOD reply, whose "More: <the agent's AgentDoc address>" is that reply's own line (agent-messaging inputNotUnderstood). The repository input is now kind identifier. With no input of a kind the door holds to a form, the door passes the message to Inspect, whose own reading takes both an address and owner/name and refuses, in its own words, a message that names no repository. Next's form shows the repository as a one-line field with the descriptor's words under it and no "https://" placeholder.
- **Plain status lines.** Each is the step in the words the view draws ("Step 2 of 5: Checking its dependencies for known security flaws."), with no section numbers, digest, count or "facts". The view reads the step from the line, and an older working copy's stage by its words.
- **Words.** The summary is "Reads an outside agent's code on GitHub, without running any of it, and reports what it does and how safe it is."; the descriptor's does, the job's does, the plugin and the README say "at its newest commit or one you name".
- The suite: 107 tests, 106 pass, one skipped.

The 0.4.3 install and proof on dev:
- Filed through the deploy ticket at 11:09 am Mountain time on 2026-11-26, approved as asking for nothing new, running at 11:13:00 am. Dev's Descriptor gives agent_version 0.4.3, the new summary, both inputs kind identifier, the commit not required, and views/report.html at sha256:cddca1a8e92241d6cdbb5d88fea11904b3320b18f0ed4eff17d9a753b9c018aa; GET /v1/agents/:key/views/:digest serves 117,857 bytes that hash to it.
- One live run from the Next app as a new dev test account of ours, the repository typed as `langchain-ai/design-agent` and the commit left blank: job 01a21910-123a-7000-852a-f436398ec198.

| After the send (11:13:33.8 am) | |
|---|---|
| 0.3 s | the adapter has the message |
| 2 s | the page knows the job; Next draws its own placeholder and its Working chip |
| about 9 s | the worker has the job's folder ready (message.txt) and Inspect starts; its first working copy, Step 1 with no commit, is the first piece it posts |
| 17.8 s | the view is on screen: "Inspecting · Step 1 of 5: Reading the repository", every field a placeholder, Next's chip gone |
| 28 s | step 2 |
| 40 s | step 3 |
| 139 s | step 4 |
| 262 s | done: commit 86d8f667796890eb6d3612dbd1b9e941782fe03f, the newest on main, checked; 213 findings, 3 held back; 4 GitHub calls; one of eleven systems required, Anthropic |

- Inspect posts within a second of starting. The other 17 seconds are the platform's: about nine from the adapter having the message to the worker starting Inspect, and about seven from Inspect's first piece to the view drawn (the adapter reading the job folder's updates, the Task, Next's poll and the frame).
- The cut pass on the shots at 5 s, 20 s and done found one thing: at step 1, before any of the scripts' facts, the Overview drew "Systems required" as a single wide placeholder tile. Its fix (all five tiles as placeholders until the first facts arrive) was not deployed this round, which allowed one deploy; it waits on a branch.
- The test account was closed afterwards. Production is untouched.

## 0.4.4, waiting on a deploy turn: the Overview's tiles at the first step

The fix for 0.4.3's cut-pass finding. Until the first of the scripts' facts arrive, the Overview draws all five tiles as placeholders, each with its icon, where 0.4.3 drew "Systems required" as one wide tile alone. test/view-draw.test.mjs holds it; the stand-in host draws it at 1440 and 400. The suite: 108 tests, 107 pass, one skipped. Packed as 0.4.4 on branch inspect-0.4.4-step1-tiles; not filed on dev.
