---
name: inspect-a-repository
description: Before an outside agent is installed or given a credential, when the person in charge of a department's agents needs to know what it does and how safe it is.
---

# Inspect a repository

Part of inspect. Before an outside agent is installed or given a credential, when the person in charge of a department's agents needs to know what it does and how safe it is.

## When to use this

Before an outside agent is installed or given a credential, when the person in charge of a department's agents needs to know what it does and how safe it is.

## What this needs

- repository (url, required)
- commit (identifier, optional: left blank, the newest commit on the default branch)

## What a good result looks like

An inspection report in eight sections whose every finding stands on its own and cites a file and line at the commit, or the call it came from; risks carry a level and a category from a published list; judgments that did not check are listed as held back with why; and the summary leads with the few findings that matter most.

## What it produces

- sbom (application/vnd.cyclonedx+json, per task)
- inspection (application/vnd.agentmesh.inspection-report+json, per task)

## When it comes back empty

When the archive holds no file it can read as text, it still writes the report with what was inspected and a finding that there was no code to read; when the message names no repository, it says so and inspects nothing; when it names no commit, it inspects the newest commit on the repository's default branch.

## How to do it

Give the repository's address, https://github.com/<owner>/<name>, on a repository: line (a message from another agent may give <owner>/<name>), and, to inspect one commit, its digest on a commit: line, or one GitHub commit address that names both; with no commit, the newest commit on the default branch is read. The script reads GitHub's records and the archive at the commit with GET requests only, unpacks it in the job's own folder, reads the facts by rule with the reverse engineer's and the security reviewer's carried scripts, lists the dependencies and asks OSV about them, has AgentMesh's screening pass every line the model would read (POST /v1/screen-text with the job's own credential; a line it holds is left out and named as a risk, and a screening that cannot answer means no judgment), asks the model for the judgments in up to three calls, keeps only the judgments that cite facts and check against the commit, decides whether each outside system is required by rule, and writes every finding through one emitter. It runs nothing from the repository, and removes its copy when the job ends.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/inspect-a-repository.mjs
- scripts/emit.mjs
- scripts/limits.mjs
- scripts/screen.mjs
- scripts/request.mjs
- scripts/github.mjs
- scripts/untar.mjs
- scripts/collect.mjs
- scripts/agent-facts.mjs
- scripts/deps.mjs
- scripts/judge.mjs
- scripts/checks.mjs
- scripts/report.mjs
- scripts/lists.mjs
- scripts/facts.mjs
- scripts/codebase.mjs
- scripts/surface.mjs
- scripts/js-source.mjs
- scripts/declarations.mjs
- scripts/flags.mjs
- scripts/sbom.mjs
- scripts/evidence.mjs
- scripts/secrets.mjs
- scripts/trace-programs.mjs
- scripts/model-caller.mjs
