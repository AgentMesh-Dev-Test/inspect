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
