// Inspect one public GitHub repository at one commit, and hand back the
// inspection report, the dependency list and a short summary.
//
// The steps, in order: read the request (request.mjs); read GitHub's records
// of the repository and the commit, its recent commits and the archive at the
// commit (github.mjs, GET only); unpack the archive inside the job's own work
// folder, writing no link (untar.mjs); tell whether it holds an agent, a
// plugin or skills alone, and of several plugins keep only the files of the
// one named, else the first, with what each plugin adds as facts
// (plugin-facts.mjs, 0.5.0); read every fact by rule (collect.mjs,
// over the reverse engineer's and the security reviewer's carried scripts and
// Inspect's own patterns); make the CycloneDX list (the reverse engineer's
// sbom.mjs, with uv.lock added by deps.mjs) and ask OSV about it; write the
// scripts' findings (report.mjs); have AgentMesh's screening pass every
// line the model would read, and fail closed (screen.mjs, 0.4.6); ask the model for the judgments in up to
// three calls (judge.mjs) and keep only those that check (checks.mjs); write
// section 1 last; write the report. 0.6.0: from AgentMesh's agent platforms
// database (platforms.mjs), what it is built on, how tied it is in each
// category it uses and what moving it elsewhere would take, by rule, with
// what each outside service is really needed for from the first call. Every finding passes the one emitter
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
//   needs: node >= 22; GITHUB_API, OSV_API, the model's four settings, and
//   the job credential and platform address the platform gives a job
//   (MESH_JOB_JWT, MESH_JOB_NKEY_SEED, MESH_API_BASE)
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
import { collectFacts, factLine } from "./collect.mjs";
import { addUvLock, checkWithOsv, lineOfComponent } from "./deps.mjs";
import { createEmitter, liveUpdates } from "./emit.mjs";
import { factsRead, glanceLine, judge } from "./judge.mjs";
import { checkDescription, checkDrafts, checkGlance, checkHookWords, checkPortability, checkSkillNames, foldIntoHooks, withoutCounts } from "./checks.mjs";
import { buildReport, markdownOf, notJudged, replyOf, screeningFindings, scriptFindings, SCREENING_SOURCE } from "./report.mjs";
import { screenLines } from "./screen.mjs";
import { stepLine } from "./lists.mjs";
import { admit, askerOf } from "./limits.mjs";
import { loadedSkills, pickPlugin, pluginFacts, scopeOf, shapeOf, subjectOf } from "./plugin-facts.mjs";
import { loadDatabase, platformUses, readingOf } from "./platforms.mjs";
import { guidanceOf } from "./guidance.mjs";

export const VERSION = "0.7.1";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One inspection: {code, reply, report?, bom?}. Every system is reached
 * through what is handed in: `fetchImpl` for GitHub, OSV and AgentMesh's
 * screening, `ask` for the model, `screen` for the screening of the lines the
 * model would read (by default screen.mjs over `fetchImpl`); `onFinding` hears each finding as it is emitted, `onStatus` a
 * status line as each stage begins, and `onStart` the repository and the
 * commit once the archive is read, before the first finding.
 */
export async function inspect({ text, workDir, env = process.env, fetchImpl = fetch, ask, screen = (lines) => screenLines(lines, { env, fetchImpl }), now = () => new Date(), onFinding, onStatus = () => {}, onStart = () => {} } = {}) {
  const startedAt = now().toISOString();
  const req = readRequest(text);
  if (!req.ok) return { code: 0, reply: req.refusal };
  const notes = [...(req.asks_to_run ? [RUN_REFUSAL] : []), ...(req.asks_verdict ? [VERDICT_REFUSAL] : [])];
  const { owner, name } = req;
  const dir = join(resolve(workDir), "codebase");
  rmSync(dir, { recursive: true, force: true });
  try {
    let gh, repository, commitRec, recent, bytes, newestOn = null, tags = null;
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
      // 0.7.0: one more call, for the guidance's tagged release; a failure
      // of any kind leaves it unknown and inspects on.
      try { tags = await gh.tags(); } catch { tags = null; }
    } catch (e) {
      if (e instanceof GitHubFailed) return { code: e.kind === "no-repository" || e.kind === "no-commit" || e.kind === "too-large" ? 0 : 1, reply: [...notes, e.said].join("\n\n") };
      throw e;
    }
    const sha = String(commitRec.sha ?? "").toLowerCase();
    const archive = untar(bytes, dir);
    if (!archive.ok) return { code: 1, reply: [...notes, archive.said].join("\n\n") };
    const all = walk(dir);
    const read = (f) => readInside(dir, f);
    const bytesOf = (f) => { try { return readFileSync(join(dir, f)); } catch { return null; } };
    // 0.5.0: an agent, a plugin (or several) or skills alone; of several
    // plugins, the one the request names, else the first, and only its files.
    const shape = shapeOf(all, read);
    const picked = pickPlugin(shape, req.plugin, `${owner}/${name}`);
    if (!picked.ok) return { code: 0, reply: [...notes, picked.refusal].join("\n\n") };
    if (picked.note) notes.push(picked.note);
    const files = scopeOf(all, shape, picked.plugin);
    const subject = subjectOf(shape, picked, files, all);
    const textFiles = files.filter((f) => { const b = bytesOf(f); return b && looksLikeText(b); }).length;
    const url = String(repository.html_url ?? `https://github.com/${owner}/${name}`);
    onStatus(stepLine(2, "Reading the code"));
    const collected = collectFacts({ files, read, bytesOf, archive, github: { repository, commit: commitRec, recent, newest_on: newestOn }, owner, name, sha });
    const { facts, byId, add } = collected;
    if (subject) {
      // What a plugin adds to the person's tools, and what its scripts touch.
      for (const f of pluginFacts(files, read, shape, picked.plugin, all)) add(f.kind, { file: f.file, line: f.line }, f.data);
      // A SKILL.md the plugin's tools never load (one inside another skill) is no skill of it.
      const loaded = picked.plugin ? loadedSkills(files, picked.plugin) : null;
      if (loaded) for (const f of facts) if (f.kind === "skill" && !f.data?.for_coding_assistants && !loaded.has(f.data?.folder)) f.data.not_loaded = true;
    }
    const about = { owner, name, url, sha, checked: archive.commit === sha, date: facts.find((f) => f.kind === "commit")?.data?.date ?? null, version: VERSION, started_at: startedAt, ...(subject ? { subject } : {}) };
    onStart(about);

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

    // 0.6.0: how tied it is to its platform, from the agent platforms
    // database: each place the code shows a platform, a feature of it or an
    // open standard is a fact at its file and line, and the reading is made
    // from those alone.
    const db = loadDatabase();
    const frameworkFacts = facts.filter((f) => f.kind === "framework");
    const found = platformUses({ files, read, db, frameworks: frameworkFacts.map((f) => ({ ...f.data, file: f.file, line: f.line })) });
    for (const [id, list] of found.present) for (const x of list) {
      x.fact = x.how === "framework" ? frameworkFacts.find((f) => f.file === x.file && f.line === x.line)?.id : add("platform", { file: x.file, line: x.line }, { platform: id, shown_by: x.how, value: x.value }).id;
    }
    for (const u of found.uses) u.fact = add("platform-use", { file: u.file, line: u.line }, { platform: u.platform, category: u.category, evidence: u.kind, value: u.value }).id;
    for (const s of found.standards) s.fact = add("standard-use", { file: s.file, line: s.line }, { standard: s.standard, category: s.category, evidence: s.kind, value: s.value }).id;
    const portability = readingOf({
      found, db, frameworks: frameworkFacts.map((f) => f.data), subject,
      ownCode: facts.find((f) => f.kind === "own-code")?.data ?? null,
      languages: facts.filter((f) => f.kind === "language").map((f) => f.data),
      schedules: files.some((f) => f.split("/").pop() === "schedules.json"),
      pluginParts: subject ? { hooks: facts.filter((f) => f.kind === "hook"), commands: facts.filter((f) => f.kind === "slash-command" || f.kind === "sub-agent"), mcp: facts.filter((f) => f.kind === "mcp-server"), manifests: facts.filter((f) => f.kind === "plugin-manifest" && f.data?.tool !== "Agent Plugins") } : {},
    });
    // 0.7.0: how well it follows AgentMesh's portability guidance, by rule.
    portability.guidance = guidanceOf({ all, root: picked.plugin?.root ?? "", read, facts, portability, tags });
    about.portability = portability;
    onStart(about);
    for (const f of facts) if (!byId.has(f.id)) byId.set(f.id, f);

    const ctx = contextFor({ files, read });
    const emitter = createEmitter({ onFinding });
    onStatus(stepLine(2, "Writing what the code shows"));
    for (const f of scriptFindings({ facts, ctx, owner, name, sha, repoUrl: url, osv, bomGaps: gaps, files, textFiles, skillTexts: collected.skillTexts, cased: collected.cased, subject, read })) emitter.emitFinding(f);

    // The judgments.
    const held = [];
    const usage = { code_host_calls: gh.calls.length, vulnerability_database_calls: osv.calls.length, model_calls: 0, tokens_in: 0, tokens_out: 0 };
    const known = {
      spdx: new Set(facts.filter((f) => f.kind === "license" || f.kind === "repository-license").map((f) => f.data?.spdx).filter(Boolean)),
      purls: new Set(bom.components.map((c) => c.purl ?? c["bom-ref"])),
      osv: new Set(facts.filter((f) => f.kind === "vulnerability").map((f) => f.data.osv_id)),
    };
    const repoWords = `${owner}/${name} at ${sha}`;
    // 0.4.6: nothing reaches the model that AgentMesh's screening has not
    // passed, line by line, exactly as the calls would read it; it fails
    // closed, so a screening that cannot answer means no judgment.
    const screening = { requests: 0, passages: 0, held: 0 };
    const screened = async (lines) => {
      const s = lines.length ? await screen(lines) : { ok: true, verdicts: [], requests: 0, texts: 0 };
      screening.requests += s.requests ?? 0;
      screening.passages += s.texts ?? 0;
      if (s.ok) screening.held += s.verdicts.filter((v) => v.verdict !== "pass").length;
      return s;
    };
    const ALL_CALLS = [[[3, 4, 5], "3, 4 and 5"], [[6, 7, 8], "6, 7 and 8"], [[1], "1"]];
    let toRead = [], first = null;
    if (textFiles) {
      onStatus(stepLine(3, "Having the code's text screened before the model reads it"));
      toRead = factsRead(facts, repoWords, subject, portability);
      first = await screened(toRead.map(factLine));
      if (!first.ok) for (const [sections, words] of ALL_CALLS) for (const f of notJudged(sections, first.why, words, SCREENING_SOURCE)) emitter.emitFinding(f);
      else {
        const heldBack = toRead.map((fact, i) => ({ fact, ...first.verdicts[i] })).filter((h) => h.verdict !== "pass");
        for (const f of screeningFindings(heldBack, ctx)) emitter.emitFinding(f);
        if (toRead.length && heldBack.length === toRead.length) {
          for (const [sections, words] of ALL_CALLS) for (const f of notJudged(sections, "AgentMesh's screening held all of the code's text, so the model was given nothing to read", words, SCREENING_SOURCE)) emitter.emitFinding(f);
          first = { ...first, ok: false };
        }
      }
    }
    if (textFiles && first.ok) {
      // Each call reads what it would have read, less what the screening held.
      const withheld = new Set(toRead.filter((f, i) => first.verdicts[i].verdict !== "pass").map((f) => f.id));
      // Each call's judgments are checked and emitted the moment it answers,
      // so sections 3 to 5 reach the sender while 6 to 8 are still being judged.
      const SECTIONS_OF = { first: [[3, 4, 5], "3, 4 and 5"], second: [[6, 7, 8], "6, 7 and 8"] };
      const onCall = async (which, r) => {
        const [sections, words] = SECTIONS_OF[which];
        if (r.failed) { for (const f of notJudged(sections, r.failed, words)) emitter.emitFinding(f); return; }
        const c = checkDrafts(r.drafts, { sections, byId, ctx, known });
        // 0.5.7, a plugin: the counts are the report's, never the model's,
        // and a risk about a hook's own code is said on that hook's row.
        if (subject) for (const f of c.kept) { f.title = withoutCounts(f.title); f.says = withoutCounts(f.says); }
        const fold = subject ? foldIntoHooks(c.kept, emitter.findings().filter((f) => f.detail?.hook && f.by === "script"), byId) : { stay: c.kept, folded: new Map() };
        for (const [hook, risks] of fold.folded) {
          const RANK = ["critical", "high", "medium", "low", "none"];
          const top = [hook.level, ...risks.map((r) => r.level)].filter(Boolean).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0];
          if (top && top !== hook.level) { hook.level = top; hook.level_by = "model"; }
          const cats = [...(hook.categories ?? [])];
          for (const k of risks.flatMap((r) => r.categories ?? [])) if (!cats.some((x) => x.id === k.id)) cats.push(k);
          hook.categories = cats;
          hook.based_on = [...new Set([...(hook.based_on ?? []), ...risks.flatMap((r) => r.based_on ?? [])])];
          hook.detail = { ...hook.detail, hook: { ...hook.detail.hook, also: [...(hook.detail.hook.also ?? []), ...risks.map((r) => ({ title: r.title, says: r.says, level: r.level, ...(r.detail?.safe ? { safe: r.detail.safe } : {}) }))] } };
        }
        for (const f of fold.stay) emitter.emitFinding(f);
        held.push(...c.held);
        // 0.3.3: each skill's plain name and words replace the title its own
        // description gave it; that description stays in its detail, for the viewer.
        if (r.skills) {
          const s = checkSkillNames(r.skills, byId);
          for (const f of emitter.findings()) {
            // 0.5.3: the finding that only counts the skills (detail.own) is none of them.
            const id = f.kind === "skill" && !(f.detail && "own" in f.detail) ? f.based_on?.find((x) => s.kept.has(x)) : null;
            if (!id) continue;
            const { title, does } = s.kept.get(id);
            f.detail = { ...(f.detail ?? {}), plain: true, does, ...(f.title !== title ? { title_by_scripts: f.title } : {}) };
            f.title = subject ? withoutCounts(title) : title;
            f.says = `${subject ? withoutCounts(does) : does}${f.says && f.detail.description && f.says.startsWith(f.detail.description) ? f.says.slice(f.detail.description.length) : ""}`.trim();
          }
          held.push(...s.held);
        }
        // 0.6.0: what each outside service is really needed for, on its row
        // of the reading, and the working copy posted again with it.
        if (r.portability) {
          const p = checkPortability(r.portability, portability, byId);
          for (const row of portability.uses) {
            const k = p.kept.get(row.category);
            if (k) Object.assign(row, { needs: k.needs, choices: k.choices || null, needs_based_on: k.based_on });
          }
          held.push(...p.held);
          if (p.kept.size) onStart(about);
        }
        // 0.5.0: each hook's plain words go on the scripts' risk for it.
        if (r.hooks) {
          const h = checkHookWords(r.hooks, byId);
          for (const f of emitter.findings()) {
            if (!f.detail?.hook) continue;
            const does = [...new Set((f.based_on ?? []).map((id) => h.kept.get(id)).filter(Boolean))];
            if (does.length) f.detail = { ...f.detail, hook: { ...f.detail.hook, does } };
          }
          held.push(...h.held);
        }
      };
      const j = await judge({ facts, withheld, repo: repoWords, subject, portability, ...(ask ? { ask } : {}), onStatus, onCall });
      // The last call reads the findings, and a script's finding can carry the
      // code's own words, so they are screened too, and only those that pass
      // are read.
      const all = emitter.findings();
      const gs = await screened(all.map(glanceLine));
      const g = gs.ok ? await j.glance(all.filter((f, i) => gs.verdicts[i].verdict === "pass")) : { failed: gs.why, screening: true };
      if (g.failed) for (const f of notJudged([1], g.failed, "1", ...(g.screening ? [SCREENING_SOURCE] : []))) emitter.emitFinding(f);
      else {
        // The description first (0.3.0), then the findings that matter most.
        const desc = checkDescription(subject && g.description ? withoutCounts(g.description) : g.description, emitter.findings());
        if (desc.kept) emitter.emitFinding(desc.kept);
        held.push(...desc.held);
        const c = checkGlance(subject ? (g.drafts ?? []).map((x) => ({ ...x, says: withoutCounts(x?.says) })) : g.drafts, emitter.findings());
        for (const f of c.kept) emitter.emitFinding(f);
        held.push(...c.held);
      }
      Object.assign(usage, { model_calls: j.usage.model_calls, tokens_in: j.usage.tokens_in, tokens_out: j.usage.tokens_out });
    }

    Object.assign(usage, { screening_requests: screening.requests, screened_passages: screening.passages, screening_held: screening.held });
    const commitFact = facts.find((f) => f.kind === "commit");
    const report = deepScrub(buildReport({
      owner, name, url, sha, checked: archive.commit === sha, date: commitFact?.data?.date ?? null, version: VERSION, now: now().toISOString(),
      findings: emitter.findings(), held, facts, bom, osv, usage, subject, portability,
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
