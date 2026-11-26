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
import { checkDescription, checkDrafts, checkGlance, checkSkillNames } from "./checks.mjs";
import { buildReport, markdownOf, notJudged, replyOf, scriptFindings } from "./report.mjs";
import { stepLine } from "./lists.mjs";
import { admit, askerOf } from "./limits.mjs";

export const VERSION = "0.4.5";
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
    let gh, repository, commitRec, recent, bytes, newestOn = null;
    try {
      // 0.4.3: the first working copy goes out the moment the job starts,
      // before any call to GitHub, with the repository the request names and
      // no commit yet, so the report's view is up and says the step at once.
      onStatus(stepLine(1, "Reading the repository"));
      onStart({ owner, name, url: `https://github.com/${owner}/${name}`, sha: null, checked: false, date: null, version: VERSION, started_at: startedAt });
      gh = githubReader({ owner, name, env, fetchImpl });
      repository = await gh.repository();
      // 0.4.0: no commit named, so the newest on the default branch.
      newestOn = req.commit ? null : String(repository.default_branch ?? "").trim();
      commitRec = req.commit ? await gh.commit(req.commit) : await gh.newestCommit(newestOn);
      // 0.4.0: the repository and the commit are known now, so the first
      // working copy goes out at once, with the step Inspect is on, rather
      // than once the archive is read and unpacked (45 seconds on
      // design-agent, with nothing on the page meanwhile). It is not yet
      // checked against the archive; the copy after the archive says.
      const early = String(commitRec?.sha ?? "").toLowerCase();
      if (/^[0-9a-f]{40}$/.test(early)) onStart({ owner, name, url: String(repository.html_url ?? `https://github.com/${owner}/${name}`), sha: early, checked: false, date: commitRec?.commit?.committer?.date ?? commitRec?.commit?.author?.date ?? null, version: VERSION, started_at: startedAt });
      const since = new Date(now().getTime() - 90 * DAY_MS).toISOString();
      recent = { ...(await gh.recentCommits(since)), since };
      bytes = await gh.archive(String(commitRec.sha ?? req.commit ?? "").toLowerCase());
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
    onStatus(stepLine(2, "Reading the code"));
    const collected = collectFacts({ files, read, bytesOf, archive, github: { repository, commit: commitRec, recent, newest_on: newestOn }, owner, name, sha });
    const { facts, byId, add } = collected;
    onStart({ owner, name, url, sha, checked: archive.commit === sha, date: facts.find((f) => f.kind === "commit")?.data?.date ?? null, version: VERSION, started_at: startedAt });

    // The dependency list, and OSV.
    const made = makeSbom({ files, read, repository: url, commit: sha, tool: { name: "inspect", version: VERSION } });
    const { bom, gaps } = addUvLock(made.bom, made.gaps, files, read);
    for (const g of gaps) add("bom-gap", g.evidence?.[0] ?? null, { about: g.about, why: g.why });
    onStatus(stepLine(2, "Checking its dependencies for known security flaws"));
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
    onStatus(stepLine(2, "Writing what the code shows"));
    for (const f of scriptFindings({ facts, ctx, owner, name, sha, repoUrl: url, osv, bomGaps: gaps, files, textFiles, skillTexts: collected.skillTexts, cased: collected.cased })) emitter.emitFinding(f);

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
        // 0.3.3: each skill's plain name and words replace the title its own
        // description gave it; that description stays in its detail, for the viewer.
        if (r.skills) {
          const s = checkSkillNames(r.skills, byId);
          for (const f of emitter.findings()) {
            const id = f.kind === "skill" ? f.based_on?.find((x) => s.kept.has(x)) : null;
            if (!id) continue;
            const { title, does } = s.kept.get(id);
            f.detail = { ...(f.detail ?? {}), plain: true, does, ...(f.title !== title ? { title_by_scripts: f.title } : {}) };
            f.title = title;
            f.says = `${does}${f.says && f.detail.description && f.says.startsWith(f.detail.description) ? f.says.slice(f.detail.description.length) : ""}`.trim();
          }
          held.push(...s.held);
        }
      };
      const j = await judge({ facts, repo: `${owner}/${name} at ${sha}`, ...(ask ? { ask } : {}), onStatus, onCall });
      const g = await j.glance(emitter.findings());
      if (g.failed) for (const f of notJudged([1], g.failed, "1")) emitter.emitFinding(f);
      else {
        // The description first (0.3.0), then the findings that matter most.
        const desc = checkDescription(g.description, emitter.findings());
        if (desc.kept) emitter.emitFinding(desc.kept);
        held.push(...desc.held);
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
    onStatus(stepLine(5, "Finishing the report"));
    return { code: 0, reply: deepScrub(replyOf(report, { notes })), report, bom };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The step every piece comes from: the offering's own id, as the adapter's
 *  collector needs on each entry of pieces.json. An entry without one is
 *  dropped from the delivery, which is how 0.1.0 to 0.2.0 delivered nothing. */
export const STEP = "inspect-a-repository";

/** Write what a job hands back under its folder: the three pieces and
 *  pieces.json, each entry with its name, step, path, media type and one
 *  sentence saying what it is. */
export function writeOutputs(jobDir, { report, bom }) {
  mkdirSync(join(jobDir, "out"), { recursive: true });
  writeFileSync(join(jobDir, "out", "inspection.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(jobDir, "out", "inspection.md"), markdownOf(report));
  writeFileSync(join(jobDir, "out", "sbom.cdx.json"), `${JSON.stringify(bom, null, 2)}\n`);
  const pieces = [
    { name: "inspection", step: STEP, path: "out/inspection.json", media_type: "application/vnd.agentmesh.inspection-report+json", about: "The inspection report: the findings in eight sections, each citing a file and line at the commit, with the facts they rest on." },
    { name: "inspection-md", step: STEP, path: "out/inspection.md", media_type: "text/markdown", about: "The same report as Markdown, for a person to read." },
    { name: "sbom", step: STEP, path: "out/sbom.cdx.json", media_type: "application/vnd.cyclonedx+json", about: "The dependency list as a CycloneDX bill of materials, made by rule." },
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
    // 0.4.5: a request that would start an inspection is counted first, by
    // asker and for the day, in the records folder the host keeps across jobs;
    // over a cap it is refused here, before anything is read or asked.
    const recordsDir = flags.records ?? process.env.RECORDS ?? null;
    const gate = recordsDir && readRequest(text).ok ? admit({ recordsDir: resolve(recordsDir), asker: askerOf(jobDir) }) : { ok: true };
    if (!gate.ok) {
      process.stdout.write(`${JSON.stringify({ reply: gate.refusal })}\n`);
      process.exitCode = 0;
    } else {
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
}
