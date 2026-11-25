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
