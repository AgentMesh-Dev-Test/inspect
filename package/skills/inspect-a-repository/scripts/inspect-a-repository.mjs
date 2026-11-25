// Inspect one public GitHub repository at one commit, and hand back the
// inspection report, the dependency list and a short summary.
//
// The steps, in order: read the request (request.mjs); read GitHub's records
// of the repository and the commit, its recent commits and the archive at the
// commit (github.mjs, GET only); unpack the archive inside the job's own work
// folder, writing no link (untar.mjs); read every fact by rule (collect.mjs,
// over the reverse engineer's and the security reviewer's carried scripts and
// Inspect's own patterns); make the CycloneDX list (the reverse engineer's
// sbom.mjs, with uv.lock added by deps.mjs) and ask OSV about it; write the
// scripts' findings (report.mjs); ask the model for the judgments in up to
// three calls (judge.mjs) and keep only those that check (checks.mjs); write
// section 1 last; write the report. Every finding passes the one emitter
// (emit.mjs). Nothing from the repository is ever run, and the unpacked copy
// is removed when the job ends.
//
//   node inspect-a-repository.mjs --job <job_dir> --records <records> --work <work> --text-file <message.txt>
//
// It prints one JSON object, {"reply": "..."}, and on an inspection writes
// out/inspection.json, out/inspection.md and out/sbom.cdx.json and lists them
// in pieces.json.
// Exit 0 when it answered (a report or a refusal), 1 when GitHub failed, 2
// when --job is not given.
//
//   needs: node >= 22; GITHUB_API, OSV_API and the model's four settings
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readInside, walk } from "./codebase.mjs";
import { makeSbom } from "./sbom.mjs";
import { contextFor } from "./evidence.mjs";
import { deepScrub, looksLikeText } from "./secrets.mjs";
import { readRequest, RUN_REFUSAL, VERDICT_REFUSAL } from "./request.mjs";
import { githubReader, GitHubFailed } from "./github.mjs";
import { untar } from "./untar.mjs";
import { collectFacts } from "./collect.mjs";
import { addUvLock, checkWithOsv, lineOfComponent } from "./deps.mjs";
import { createEmitter, liveUpdates } from "./emit.mjs";
import { judge } from "./judge.mjs";
import { checkDrafts, checkGlance } from "./checks.mjs";
import { buildReport, markdownOf, notJudged, replyOf, scriptFindings } from "./report.mjs";

export const VERSION = "0.2.0";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One inspection: {code, reply, report?, bom?}. Every system is reached
 * through what is handed in: `fetchImpl` for GitHub and OSV, `ask` for the
 * model; `onFinding` hears each finding as it is emitted, `onStatus` a
 * status line as each stage begins, and `onStart` the repository and the
 * commit once the archive is read, before the first finding.
 */
export async function inspect({ text, workDir, env = process.env, fetchImpl = fetch, ask, now = () => new Date(), onFinding, onStatus = () => {}, onStart = () => {} } = {}) {
  const startedAt = now().toISOString();
  const req = readRequest(text);
  if (!req.ok) return { code: 0, reply: req.refusal };
  const notes = [...(req.asks_to_run ? [RUN_REFUSAL] : []), ...(req.asks_verdict ? [VERDICT_REFUSAL] : [])];
  const { owner, name } = req;
  const dir = join(resolve(workDir), "codebase");
  rmSync(dir, { recursive: true, force: true });
  try {
    let gh, repository, commitRec, recent, bytes;
    try {
      onStatus(`Reading GitHub's records of ${owner}/${name} and its archive at ${req.commit}.`);
      gh = githubReader({ owner, name, env, fetchImpl });
      repository = await gh.repository();
      commitRec = await gh.commit(req.commit);
      const since = new Date(now().getTime() - 90 * DAY_MS).toISOString();
      recent = { ...(await gh.recentCommits(since)), since };
      bytes = await gh.archive(String(commitRec.sha ?? req.commit).toLowerCase());
    } catch (e) {
      if (e instanceof GitHubFailed) return { code: e.kind === "no-repository" || e.kind === "no-commit" || e.kind === "too-large" ? 0 : 1, reply: [...notes, e.said].join("\n\n") };
      throw e;
    }
    const sha = String(commitRec.sha ?? "").toLowerCase();
    const archive = untar(bytes, dir);
    if (!archive.ok) return { code: 1, reply: [...notes, archive.said].join("\n\n") };
    const files = walk(dir);
    const read = (f) => readInside(dir, f);
    const bytesOf = (f) => { try { return readFileSync(join(dir, f)); } catch { return null; } };
    const textFiles = files.filter((f) => { const b = bytesOf(f); return b && looksLikeText(b); }).length;
    const url = String(repository.html_url ?? `https://github.com/${owner}/${name}`);
    onStatus(`Unpacked ${files.length} files of ${owner}/${name} at ${sha.slice(0, 12)}; reading the facts by rule.`); // cut-ok: a short digest in a status line; the full one is in the report
    const collected = collectFacts({ files, read, bytesOf, archive, github: { repository, commit: commitRec, recent }, owner, name, sha });
    const { facts, byId, add } = collected;
    onStart({ owner, name, url, sha, checked: archive.commit === sha, date: facts.find((f) => f.kind === "commit")?.data?.date ?? null, version: VERSION, started_at: startedAt });

    // The dependency list, and OSV.
    const made = makeSbom({ files, read, repository: url, commit: sha, tool: { name: "inspect", version: VERSION } });
    const { bom, gaps } = addUvLock(made.bom, made.gaps, files, read);
    for (const g of gaps) add("bom-gap", g.evidence?.[0] ?? null, { about: g.about, why: g.why });
    onStatus(`Read ${facts.length} facts; listed ${bom.components.length} dependencies and asking OSV about their known vulnerabilities.`);
    const osv = await checkWithOsv(bom.components, { env, fetchImpl });
    if (!osv.ok) add("osv-failed", { source: { system: "vulnerability-database", call: osv.calls.at(-1)?.call ?? "POST /v1/querybatch", field: "status" } }, { said: osv.said });
    for (const v of osv.found) {
      const at = lineOfComponent(v.component, read);
      add("vulnerability", at, { purl: v.component.purl ?? v.component["bom-ref"], name: v.component.name, version: v.component.version, osv_id: v.vuln.id, aliases: v.vuln.aliases, summary: v.vuln.summary, fixed: v.fixed, level: v.level });
    }
    for (const n of osv.not_checked) add("not-checked", lineOfComponent(n.component, read), { purl: n.component.purl ?? n.component["bom-ref"], why: n.why });
    for (const id of osv.unread) add("vulnerability-unread", { source: { system: "vulnerability-database", call: "GET /v1/vulns/{id}", field: id } }, { id });
    for (const f of facts) if (!byId.has(f.id)) byId.set(f.id, f);

    const ctx = contextFor({ files, read });
    const emitter = createEmitter({ onFinding });
    onStatus(`OSV ${osv.ok ? `names ${osv.found.length} known vulnerabilities` : "could not be asked"}; writing the findings the scripts make.`);
    for (const f of scriptFindings({ facts, ctx, owner, name, sha, repoUrl: url, osv, bomGaps: gaps, files, textFiles })) emitter.emitFinding(f);

    // The judgments.
    const held = [];
    const usage = { code_host_calls: gh.calls.length, vulnerability_database_calls: osv.calls.length, model_calls: 0, tokens_in: 0, tokens_out: 0 };
    const known = {
      spdx: new Set(facts.filter((f) => f.kind === "license" || f.kind === "repository-license").map((f) => f.data?.spdx).filter(Boolean)),
      purls: new Set(bom.components.map((c) => c.purl ?? c["bom-ref"])),
      osv: new Set(facts.filter((f) => f.kind === "vulnerability").map((f) => f.data.osv_id)),
    };
    if (textFiles) {
      // Each call's judgments are checked and emitted the moment it answers,
      // so sections 3 to 5 reach the sender while 6 to 8 are still being judged.
      const SECTIONS_OF = { first: [[3, 4, 5], "3, 4 and 5"], second: [[6, 7, 8], "6, 7 and 8"] };
      const onCall = async (which, r) => {
        const [sections, words] = SECTIONS_OF[which];
        if (r.failed) { for (const f of notJudged(sections, r.failed, words)) emitter.emitFinding(f); return; }
        const c = checkDrafts(r.drafts, { sections, byId, ctx, known });
        for (const f of c.kept) emitter.emitFinding(f);
        held.push(...c.held);
      };
      const j = await judge({ facts, repo: `${owner}/${name} at ${sha}`, ...(ask ? { ask } : {}), onStatus, onCall });
      const g = await j.glance(emitter.findings());
      if (g.failed) for (const f of notJudged([1], g.failed, "1")) emitter.emitFinding(f);
      else {
        const c = checkGlance(g.drafts, emitter.findings());
        for (const f of c.kept) emitter.emitFinding(f);
        held.push(...c.held);
      }
      Object.assign(usage, { model_calls: j.usage.model_calls, tokens_in: j.usage.tokens_in, tokens_out: j.usage.tokens_out });
    }

    const commitFact = facts.find((f) => f.kind === "commit");
    const report = deepScrub(buildReport({
      owner, name, url, sha, checked: archive.commit === sha, date: commitFact?.data?.date ?? null, version: VERSION, now: now().toISOString(),
      findings: emitter.findings(), held, facts, bom, osv, usage,
    }));
    onStatus(`Done: ${report.counts.findings} findings, ${report.counts.held_back} judgments held back; the report follows as the answer.`);
    return { code: 0, reply: deepScrub(replyOf(report, { notes })), report, bom };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Write what a job hands back under its folder: the three pieces and pieces.json. */
export function writeOutputs(jobDir, { report, bom }) {
  mkdirSync(join(jobDir, "out"), { recursive: true });
  writeFileSync(join(jobDir, "out", "inspection.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(jobDir, "out", "inspection.md"), markdownOf(report));
  writeFileSync(join(jobDir, "out", "sbom.cdx.json"), `${JSON.stringify(bom, null, 2)}\n`);
  const pieces = [
    { name: "inspection", path: "out/inspection.json", media_type: "application/vnd.agentmesh.inspection-report+json" },
    { name: "inspection-md", path: "out/inspection.md", media_type: "text/markdown" },
    { name: "sbom", path: "out/sbom.cdx.json", media_type: "application/vnd.cyclonedx+json" },
  ];
  writeFileSync(join(jobDir, "pieces.json"), `${JSON.stringify(pieces, null, 2)}\n`);
}

function flagsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const m = /^--([a-z-]+)$/.exec(argv[i]);
    if (m && i + 1 < argv.length) { out[m[1]] = argv[i + 1]; i += 1; }
  }
  return out;
}

const ranDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ranDirectly) {
  const flags = flagsOf(process.argv.slice(2));
  if (!flags.job) {
    process.stdout.write(`${JSON.stringify({ reply: "--job is required: the job's folder." })}\n`);
    process.exitCode = 2;
  } else {
    const jobDir = resolve(flags.job);
    const textFile = flags["text-file"] ?? join(jobDir, "message.txt");
    const text = existsSync(textFile) ? readFileSync(textFile, "utf8") : "";
    // The archive is unpacked in this job's own temporary folder, not the
    // work folder the host keeps across jobs (on a worker that is a mounted
    // bucket, where a thousand files would be a thousand writes), and the
    // folder is removed when the job ends.
    const workDir = mkdtempSync(join(tmpdir(), `inspect-${basename(jobDir).replace(/[^\w.-]/g, "_")}-`));
    // Each finding and each stage goes to the running job as it happens,
    // through the job folder's updates file (emit.mjs liveUpdates).
    const live = liveUpdates(jobDir);
    inspect({ text, workDir, onStart: live.start, onFinding: live.finding, onStatus: live.status }).then((out) => {
      live.flush();
      if (out.report) writeOutputs(jobDir, out);
      rmSync(workDir, { recursive: true, force: true });
      process.stdout.write(`${JSON.stringify({ reply: out.reply })}\n`);
      process.exitCode = out.code;
    }, (e) => {
      rmSync(workDir, { recursive: true, force: true });
      process.stdout.write(`${JSON.stringify({ reply: `Inspect stopped on an error of its own: ${e?.message ?? e}` })}\n`);
      process.exitCode = 1;
    });
  }
}
