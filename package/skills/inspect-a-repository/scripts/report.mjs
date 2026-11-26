// The report: the findings the scripts write by rule, the findings for what
// the model could not judge, the report itself and the reply.
//
// The scripts write all of section 2 (the repository, the commit and its date,
// the publisher, the license by its SPDX identifier, what it is built on and
// how actively it is kept up), and the plain facts of the other sections:
// each skill and whether it can be lifted out, each script that can be, the
// models the code names, each credential it expects, each known vulnerability
// (with OSV's level), each committed credential (high, by rule), its tests,
// and what could not be read or asked. The model's findings are checked in
// checks.mjs; every finding of both passes the one emitter (emit.mjs).
//
// It also writes the report's two other forms (0.2.0): the working copy the
// job posts while it runs (workingCopy), and the report as Markdown for a
// person to read where the report's view is not shown (markdownOf).
//
//   needs: node >= 22. Nothing here reads the network or writes a file.
//   import { scriptFindings, notJudged, buildReport, replyOf, evidenceOf, workingCopy, markdownOf } from "./report.mjs"
import { checkEvidence } from "./evidence.mjs";
import { SECTIONS, categoryOf, LIST_IDS } from "./lists.mjs";

const trim = (s) => String(s ?? "").trim();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Titles a person reads (0.2.6): never a slug, a file name or a setting's name.
/** A name with spaces for its dashes and underscores and no file extension: "brand-lint.mjs" as "Brand lint". */
export function spaced(name) {
  const t = String(name ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return t ? `${t[0].toUpperCase()}${t.slice(1)}` : String(name ?? "");
}
/** A skill's title: its own one-line description when the repository gives
 *  one (its first sentence, when that is short), else its name with spaces. */
export function skillTitle(name, description) {
  let d = String(description ?? "").replace(/\s+/g, " ").trim().replace(/^(['"])(.*)\1$/, "$2").replace(/''/g, "'");
  // A YAML block marker (">", "|-") is not a description; the lines after it were not read.
  if (/^[>|][+-]?\d?$/.test(d)) d = "";
  // A description written to trigger the skill says what it is for.
  d = d.replace(/^(?:invoke|use)\s+this\s+skill\s+(?:when|to|for|if)\s+|^use\s+(?:when|to|for|if)\s+/i, "");
  d = d.replace(/\b(OR|AND|ANY|ALL|NOT|ONLY)\b/g, (w) => w.toLowerCase()).replace(/\s+[—–]\s+/g, ": ");
  const first = d.split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]+$/, "") ?? "";
  return first && first.length <= 110 ? `${first[0].toUpperCase()}${first.slice(1)}` : spaced(name);
}
/** A credential's title from the setting it is read from: "GEMINI_API_KEY" as "Gemini API key". */
export function credentialTitle(env) {
  const words = String(env ?? "").toLowerCase().split(/[_\s]+/).filter(Boolean).map((w) => (/^(api|url|id|ssh|aws|gcp|llm|mcp|oauth|jwt)$/.test(w) ? w.toUpperCase() : w));
  if (!words.length) return String(env ?? "");
  const t = words.join(" ");
  return `${t[0].toUpperCase()}${t.slice(1)}`;
}
const day = (iso) => (trim(iso) ? trim(iso).slice(0, 10) : "not given"); // cut-ok: the date part of an ISO time, the whole time is in the fact

/** A finding's evidence and source from the facts it cites: each file and
 *  line checked against the commit, with the line's text as the fact keeps it. */
export function evidenceOf(cited, ctx) {
  const fileFacts = cited.filter((f) => f?.file);
  const { kept } = ctx ? checkEvidence(fileFacts.map((f) => ({ file: f.file, line: f.line })), ctx) : { kept: fileFacts.map((f) => ({ file: f.file, line: f.line })) };
  const evidence = [];
  for (const e of kept) {
    if (evidence.some((x) => x.file === e.file && x.line === e.line)) continue;
    const f = fileFacts.find((x) => x.file === e.file && x.line === e.line);
    evidence.push({ file: e.file, line: e.line, ...(f?.text !== undefined ? { text: f.text } : f?.long_line ? { long_line: f.long_line } : {}) });
  }
  const source = [];
  for (const f of cited) if (f?.source && !source.some((s) => s.call === f.source.call && s.field === f.source.field)) source.push(f.source);
  return { evidence, source };
}

/**
 * The scripts' findings, in the order found, each without its id:
 * { section, kind, title, says, by: "script", based_on, evidence?, source?, ... }.
 */
export function scriptFindings({ facts, ctx, owner, name, sha, repoUrl, osv = null, bomGaps = [], files = [], textFiles = 0 }) {
  const out = [];
  const of = (kind) => facts.filter((f) => f.kind === kind);
  const push = (section, kind, title, says, cited, extra = {}) => {
    const { evidence, source } = evidenceOf(cited, ctx);
    if (!evidence.length && !source.length) return;
    out.push({ section, kind, title, says, by: "script", based_on: cited.map((f) => f.id), ...(evidence.length ? { evidence } : {}), ...(source.length ? { source } : {}), ...extra });
  };

  // Section 2: what was inspected.
  const pub = of("publisher")[0]; const act = of("activity")[0]; const com = of("commit")[0]; const rec = of("recent-commits")[0];
  if (pub) push(2, "repository", "The repository", `${owner}/${name} on GitHub, ${repoUrl}.`, [pub], { detail: { owner, name, url: repoUrl } });
  if (com) push(2, "commit", "The commit", `Commit ${String(sha).slice(0, 7)}, committed ${day(com.data?.date)}. ${com.data?.checked ? "The archive's own header names this commit." : "The archive's own header did not name this commit, so it is not marked as checked."}`, [com], { detail: { sha, date: com.data?.date ?? null, checked: com.data?.checked === true } });
  if (pub) push(2, "publisher", "The publisher", `Published by ${pub.data?.login}, a GitHub ${String(pub.data?.type ?? "account").toLowerCase()}.`, [pub], { detail: pub.data });
  const licFiles = of("license").filter((f) => f.data?.file_kind === "license" && f.file && !f.file.includes("/"));
  const licManifest = of("license").filter((f) => f.data?.file_kind === "manifest");
  const apiLic = of("repository-license")[0];
  const spdx = licFiles.map((f) => f.data?.spdx).find(Boolean) ?? licManifest.map((f) => f.data?.spdx).find(Boolean) ?? apiLic?.data?.spdx ?? null;
  if (spdx || licFiles.length || apiLic) {
    const agree = !apiLic?.data?.spdx || !spdx || apiLic.data.spdx === spdx;
    const says = spdx
      ? `Licensed ${spdx}${licFiles.length ? `, as its ${licFiles[0].file} says` : ""}${apiLic?.data?.spdx ? (agree ? ", and GitHub reads it the same way" : `; GitHub reads it as ${apiLic.data.spdx}`) : ""}.`
      : "No license file at the top of the repository names a license, and GitHub names none.";
    const cat = spdx ? [{ list: LIST_IDS.spdx, id: spdx, name: spdx }] : [];
    push(2, "license", "The license", says, [...licFiles, ...licManifest, ...(apiLic ? [apiLic] : [])], { ...(cat.length ? { categories: cat } : {}), detail: { spdx } });
  }
  const langs = of("language"); const fws = of("framework");
  if (langs.length) {
    const top = langs.slice(0, 4).map((l) => `${l.data.language} (${plural(l.data.files, "file")})`).join(", ");
    const names = [...new Set(fws.map((f) => f.data.framework))];
    push(2, "built-on", "What it is built on", `Written in ${top}.${names.length ? ` Its dependencies name ${names.join(", ")}.` : " Its dependencies name no agent framework Inspect knows."}`, [...langs.slice(0, 4), ...fws], { detail: { languages: langs.map((l) => l.data), frameworks: names } });
  }
  if (act) {
    const a = act.data ?? {};
    const recent = rec?.data?.count === null || rec?.data?.count === undefined ? "the commits of the last 90 days could not be read" : `${rec.data.at_least ? "at least " : ""}${plural(rec.data.count, "commit")} in the 90 days before the inspection`;
    push(2, "activity", "How actively it is kept up", `Last pushed ${day(a.pushed_at)}; ${recent}; ${plural(a.open_issues ?? 0, "open issue")}; ${a.archived ? "archived, so it takes no more changes" : "not archived"}; ${plural(a.stars ?? 0, "star")}.`, [act, ...(rec ? [rec] : [])], { detail: { ...a, commits_last_90_days: rec?.data?.count ?? null } });
  }

  // Section 3: its skills, and the parts that can be lifted out.
  const skills = of("skill");
  const own = skills.filter((s) => !s.data?.for_coding_assistants);
  const helpers = skills.filter((s) => s.data?.for_coding_assistants);
  if (skills.length) push(3, "skill", "Skills", `${plural(own.length, "skill")} of the agent's own${helpers.length ? `, and ${plural(helpers.length, "skill")} kept for coding assistants that work on the repository (${[...new Set(helpers.map((h) => h.data.folder.split("/")[0]))].join(", ")})` : ""}.`, skills, { detail: { own: own.length, for_coding_assistants: helpers.length } });
  const parts = of("part");
  for (const s of [...own, ...helpers]) {
    const p = parts.find((x) => x.data?.part === "skill" && x.data?.folder === s.data?.folder);
    const keeps = p?.data?.keeps ?? [];
    const lift = !p ? "" : s.data.instructions_only ? "It holds instructions only, with no code of its own, so it can be lifted out as it is." : p.data.lift_out === "yes" ? `It can be lifted out on its own: its code imports nothing from outside its folder, reads no credential and loads no package at run time.${(p.data.settings ?? []).length ? ` It reads ${plural(p.data.settings.length, "setting")}: ${p.data.settings.map((x) => x.name).join(", ")}.` : ""}` : `It cannot be lifted out on its own: ${keeps.slice(0, 3).map((k) => `${k.file}:${k.line} ${k.why} (${k.spec})`).join("; ")}${keeps.length > 3 ? `, and ${keeps.length - 3} more in detail.keeps` : ""}.`;
    push(3, "skill", skillTitle(s.data.name, s.data.description), `${s.data.description ? `${s.data.description} ` : ""}${s.data.for_coding_assistants ? "A skill for coding assistants that work on the repository. " : ""}${lift}`.trim(), [s, ...(p ? [p] : [])], { detail: { name: s.data.name, path: s.data.folder, scripts: s.data.scripts, instructions_only: s.data.instructions_only === true, for_coding_assistants: s.data.for_coding_assistants === true, lift_out: p?.data?.lift_out ?? "no", keeps } });
  }
  const scriptParts = parts.filter((p) => p.data?.part === "script");
  for (const p of scriptParts.filter((x) => x.data.lift_out === "yes")) {
    const others = (p.data.files ?? []).filter((f) => f !== p.file);
    const sets = p.data.settings ?? [];
    push(3, "part", spaced(p.data.name), `${p.file} runs as a command and can be lifted out on its own${others.length ? `, with ${others.join(", ")}, which it imports from its own folder` : ""}: its code imports only the language's own modules, reads no credential and loads no package at run time.${sets.length ? ` It reads ${plural(sets.length, "setting")}: ${sets.map((s) => `${s.name} (${s.file}:${s.line})`).join(", ")}.` : ""}`, [p], { detail: { name: p.data.name, path: p.file, files: p.data.files ?? [p.file], lift_out: "yes", keeps: [], settings: sets } });
  }
  const tied = scriptParts.filter((x) => x.data.lift_out !== "yes");
  if (tied.length) push(3, "part", "Scripts that cannot be lifted out", `${plural(tied.length, "script")} that run as commands cannot be lifted out on their own: each imports a package or a file from outside its folder, reads a credential, or loads a package at run time. Each is in detail.parts with what keeps it.`, tied, { detail: { parts: tied.map((p) => ({ path: p.file, keeps: p.data.keeps })) } });

  // Section 4: the models the code names.
  const models = of("model").filter((m) => !m.data?.in_config);
  const configModels = of("model").filter((m) => m.data?.in_config);
  if (models.length || configModels.length) {
    const names = [...new Set(models.map((m) => m.data.match))];
    const bySetting = models.filter((m) => m.data.chosen_by === "setting");
    const configFiles = [...new Set(configModels.map((m) => m.file))];
    push(4, "model", "The models it names", `${names.length ? `Its code names ${plural(names.length, "model")}: ${names.join(", ")}.` : "Its code names no model."} ${bySetting.length ? `${plural(bySetting.length, "line")} choose${bySetting.length === 1 ? "s" : ""} a model through a setting (${[...new Set(bySetting.flatMap((m) => m.data.settings ?? []))].join(", ")}).` : names.length ? "No line that names one reads a setting." : ""}${configFiles.length ? ` Its configuration files name ${plural(new Set(configModels.map((m) => m.data.match)).size, "model")} more (${configFiles.join(", ")}).` : ""}`.trim(), [...models, ...configModels], { detail: { models: names, set_by_setting: [...new Set(bySetting.flatMap((m) => m.data.settings ?? []))], in_config: [...new Set(configModels.map((m) => m.data.match))] } });
  }

  // Section 5: each credential it expects, by name; one its tests alone read is said so.
  const creds = of("setting").filter((s) => s.data?.credential);
  for (const n of [...new Set(creds.map((c) => c.data.name))]) {
    const at = creds.filter((c) => c.data.name === n);
    const run = at.filter((c) => !c.data.in_test);
    const places = (list) => list.reduce((k, c) => k + (c.data.lines?.length ?? 1), 0);
    const says = run.length
      ? `It reads the credential ${n} from its environment, in ${plural(places(run), "place")} of ${plural(run.length, "file")}${run.length < at.length ? `, and its tests read it in ${plural(at.length - run.length, "more file")}` : ""}.`
      : `Only its tests read the credential ${n}, in ${plural(at.length, "file")}; no other code reads it.`;
    push(5, "credential", credentialTitle(n), says, at, { detail: { env: n, read_by_code: run.length > 0, files: at.map((c) => c.file) } });
  }

  // Section 7: known vulnerabilities with OSV's level, and committed credentials.
  // One finding per package at its version (0.2.6): its title says so in
  // words, its level is the highest of its advisories, and each advisory, its
  // summary, the version that fixes it and its id, is in detail.advisories.
  const byPackage = new Map();
  for (const v of of("vulnerability").filter((x) => x.data?.level)) {
    const key = v.data.purl || `${v.data.name}@${v.data.version}`;
    byPackage.set(key, [...(byPackage.get(key) ?? []), v]);
  }
  for (const vs of byPackage.values()) {
    const d = vs[0].data;
    // A summary that opens with the package's own name ("Hono: …") says it again; it is left out.
    const own = String(d.name ?? "").split("/").pop().toLowerCase();
    const plainSummary = (s) => { const t = String(s ?? "").trim(); const m = /^([\w@/.-]+):\s+/.exec(t); return m && m[1].split("/").pop().toLowerCase() === own ? t.slice(m[0].length) : t || null; };
    const advisories = vs.map((v) => ({ id: v.data.osv_id, aliases: v.data.aliases ?? [], summary: plainSummary(v.data.summary), level: v.data.level, fixed: v.data.fixed ?? null }));
    const level = LEVEL_ORDER.find((l) => advisories.some((a) => a.level === l)) ?? advisories[0].level;
    const cats = [categoryOf("LLM03:2025"), categoryOf("ASI04"), { list: LIST_IDS.cyclonedx, id: d.purl, name: `${d.name} ${d.version}` }, ...advisories.map((a) => ({ list: LIST_IDS.osv, id: a.id, name: a.id }))];
    const sentence = (s) => { const t = String(s ?? "").trim().replace(/[.;:]+$/, ""); return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : ""; };
    const says = advisories.map((a) => `${sentence(a.summary) || "A known security flaw."}${a.fixed ? ` Fixed in ${a.fixed}.` : ""}`).join(" ");
    push(7, "risk", `${d.name} ${d.version} has ${advisories.length === 1 ? "a known security flaw" : "known security flaws"}`, says, vs, { level, level_by: "source", categories: cats, detail: { name: d.name, version: d.version, purl: d.purl, advisories } });
  }
  // The rule: a credential in the code is high; one in a test file is medium,
  // since a test often holds a made-up key, and Inspect cannot tell which.
  for (const c of of("credential-shape")) push(7, "risk", c.data.in_test ? "A committed credential in a test file" : "A committed credential in the code",`Line ${c.line} of ${c.file} looks like ${c.data.what}.${c.data.in_test ? " The file is a test, and Inspect cannot tell whether the key is live or made up for the test." : ""} Inspect keeps only where it is, never its characters.`, [c], { level: c.data.in_test ? "medium" : "high", level_by: "rule", categories: [categoryOf("LLM02:2025"), categoryOf("ASI03")], detail: { what: c.data.what, in_test: c.data.in_test === true } });

  // Section 8: its tests, and what Inspect could not read or ask.
  const tests = of("test-file"); const cmd = of("test-command")[0];
  if (tests.length) push(8, "test", "Tests",`${plural(tests.length, "test file")} with ${plural(tests.reduce((n, t) => n + (t.data.cases ?? 0), 0), "test case")} found by rule.${cmd?.data?.command ? ` Its test command is ${cmd.data.command}.` : ""} Inspect ran none of them.`, [...tests, ...(cmd?.file ? [cmd] : [])], { detail: { files: tests.length, cases: tests.reduce((n, t) => n + (t.data.cases ?? 0), 0) } });
  const archiveFact = of("commit")[0] ?? of("publisher")[0];
  if (!textFiles && archiveFact) push(8, "could-not-tell", "There was no code to read", "The archive held no file Inspect could read as text, so there was no code to inspect.", [archiveFact]);
  // 0.2.7: one finding for every gap in the dependency list, its title in
  // words; the files are in its words and its evidence, not in its title.
  const gapFacts = bomGaps.map((g) => ({ g, f: facts.find((x) => x.kind === "bom-gap" && x.data?.about === g.about) })).filter((x) => x.f);
  if (gapFacts.length) push(8, "could-not-tell", gapFacts.length === 1 ? "Versions missing from the dependency list" : "Some versions are missing from the dependency list", gapFacts.map(({ g }) => `${g.about}: ${g.why}.`).join(" "), gapFacts.map((x) => x.f), { detail: { gaps: gapFacts.map(({ g }) => ({ about: g.about, why: g.why })) } });
  const nc = of("not-checked");
  if (nc.length) push(8, "could-not-tell", "Dependencies not checked against OSV", `${plural(nc.length, "dependency", "dependencies")} could not be asked about: ${[...new Set(nc.map((x) => x.data.why))].join("; ")}. Each is in detail.components.`, nc, { detail: { components: nc.map((x) => ({ purl: x.data.purl, why: x.data.why })) } });
  if (osv && !osv.ok) { const f = of("osv-failed")[0]; if (f) push(8, "could-not-tell", "The dependencies were not checked against OSV", `The dependencies were not checked against OSV: ${osv.said}.`, [f]); }
  const unread = of("vulnerability-unread");
  if (unread.length) push(8, "could-not-tell", "Vulnerabilities not read in full", `OSV named ${plural(unread.length, "more vulnerability", "more vulnerabilities")} than Inspect reads in one job; each is listed by id alone in detail.ids.`, unread, { detail: { ids: unread.map((u) => u.data.id) } });
  const links = of("link");
  if (links.length) push(8, "could-not-tell", "Links in the repository", `The archive holds ${plural(links.length, "link")}, which Inspect did not follow or write: ${links.map((l) => `${l.data.path} to ${l.data.points_to}`).join("; ")}.`, links, { detail: { links: links.map((l) => l.data) } });
  const refused = of("refused-path");
  if (refused.length) push(8, "could-not-tell", "Files not written", `${plural(refused.length, "entry", "entries")} of the archive had a path that leaves the folder and were not written: ${refused.map((r) => r.data.path).join("; ")}.`, refused, { detail: { paths: refused.map((r) => r.data.path) } });
  return out;
}

/** The findings that say a judgment was not made, one for each section it would have held. */
export function notJudged(sections, why, which) {
  return sections.map((s) => ({
    section: s, kind: "not-judged", title: "Not judged", by: "script", based_on: [],
    says: `The judgment of section ${s} was not made: ${trim(why)}. The scripts' findings of this section stand.`,
    source: [{ system: "text-reasoning", call: `the judgment of sections ${which}`, field: "why the answer ended" }],
  }));
}

/** The levels a finding may carry, highest first. */
export const LEVEL_ORDER = ["critical", "high", "medium", "low", "none"];
const levelRank = (f) => { const i = LEVEL_ORDER.indexOf(f?.level); return i < 0 ? LEVEL_ORDER.length : i; };
/** How many findings carry each level, and how many carry none, each counted
 *  once: section 1 repeats findings of the other sections and is left out. */
export function byLevel(findings) {
  const out = Object.fromEntries([...LEVEL_ORDER, "not_rated"].map((l) => [l, 0]));
  for (const f of findings) if (f.section !== 1 && !f.repeats) out[LEVEL_ORDER.includes(f.level) ? f.level : "not_rated"] += 1;
  return out;
}
const bySection = (findings) => Object.fromEntries(SECTIONS.map((s) => [String(s.number), findings.filter((f) => f.section === s.number).length]));

/** The report as the inspection-report-v1 schema says. */
export function buildReport({ owner, name, url, sha, checked, date, version, now, findings, held, facts, bom, osv, usage }) {
  const by = bySection(findings);
  return {
    format: "inspection-report-v1",
    repository: { owner, name, url },
    commit: { sha, checked: checked === true, date: date ?? null },
    inspected_at: now,
    inspector: { name: "inspect", version },
    sections: SECTIONS,
    findings,
    held_back: held,
    facts,
    dependencies: { bom: "sbom.cdx.json", components: bom?.components?.length ?? 0, checked: osv?.asked ?? 0, not_checked: facts.filter((f) => f.kind === "not-checked").length },
    counts: { findings: findings.length, by_section: by, by_level: byLevel(findings), held_back: held.length, facts: facts.length },
    usage,
  };
}

/** The most a working copy takes as JSON: one piece, which the adapter caps at 64 KB. */
export const WORKING_COPY_CHARS = 60_000;

/**
 * The working copy of the report while the job runs (0.2.0): the same
 * inspection-report-v1 document, with `partial` saying the stage it is at,
 * and the findings so far in their short form (no facts, no detail, the first
 * place each cites). It is one piece, so it is kept within
 * WORKING_COPY_CHARS: when the findings with their words do not fit, they go
 * without their words (`partial.says_left_out`), and when that still does not
 * fit, findings that carry no level are left out from the largest section
 * first, counted in `partial.omitted`. The counts are always of every finding
 * so far. The delivered report replaces it.
 */
export function workingCopy({ about, findings, stage, limit = WORKING_COPY_CHARS }) {
  const a = about ?? {};
  const short = (f, words) => {
    const ev = Array.isArray(f.evidence) ? f.evidence : [];
    return {
      id: f.id, section: f.section, kind: f.kind, title: f.title, ...(words ? { says: f.says } : {}), by: f.by,
      ...(f.level ? { level: f.level, ...(f.level_by ? { level_by: f.level_by } : {}) } : {}),
      ...(f.categories?.length ? { categories: f.categories } : {}),
      ...(f.repeats ? { repeats: f.repeats } : {}),
      ...(ev.length ? { evidence: [{ file: ev[0].file, line: ev[0].line }], ...(ev.length > 1 ? { more_evidence: ev.length - 1 } : {}) } : {}),
      ...(!ev.length && f.source?.length ? { source: [f.source[0]] } : {}),
    };
  };
  const all = [...findings].sort((x, y) => x.section - y.section);
  const doc = (list, words, omitted) => ({
    format: "inspection-report-v1",
    partial: { stage: trim(stage) || "Starting.", findings_so_far: all.length, omitted, says_left_out: !words },
    repository: { owner: a.owner, name: a.name, url: a.url },
    commit: { sha: a.sha, checked: a.checked === true, date: a.date ?? null },
    inspected_at: a.started_at,
    inspector: { name: "inspect", version: a.version },
    sections: SECTIONS,
    findings: list,
    held_back: [],
    facts: [],
    counts: { findings: all.length, by_section: bySection(all), by_level: byLevel(all), held_back: 0, facts: 0 },
  });
  const fits = (d) => JSON.stringify(d).length <= limit;
  let d = doc(all.map((f) => short(f, true)), true, 0);
  if (fits(d)) return d;
  let list = all.map((f) => short(f, false));
  d = doc(list, false, 0);
  let omitted = 0;
  while (!fits(d)) {
    const sizes = new Map();
    for (const f of list) if (!f.level) sizes.set(f.section, (sizes.get(f.section) ?? 0) + 1);
    if (!sizes.size) break;
    const biggest = [...sizes.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0][0];
    const drop = Math.max(1, Math.ceil(list.length / 20));
    let dropped = 0;
    list = list.filter((f) => !(f.section === biggest && !f.level && dropped++ < drop));
    omitted += dropped;
    d = doc(list, false, omitted);
  }
  return d;
}

// ── The report as Markdown, for a person to read without the view ──

/** Text from the repository or the model, made safe to put in Markdown: no
 *  character starts a link, an image, a tag or emphasis. */
export function mdText(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim().replace(/[\\`*_[\]<>!|#~]/g, (c) => `\\${c}`);
}
/** The address of one line of one file at the commit, on GitHub, or null
 *  when the repository's address is not GitHub's. */
export function lineAddress(repo, sha, file, line) {
  let u;
  try { u = new URL(String(repo?.url ?? "")); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== "github.com" || !/^[0-9a-f]{40}$/.test(String(sha ?? ""))) return null;
  const path = String(file ?? "").split("/").map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}/blob/${String(sha).slice(0, 7)}/${path}${Number(line) >= 1 ? `#L${Number(line)}` : ""}`;
}
const LEVEL_WORDS = { critical: "Critical", high: "High", medium: "Medium", low: "Low", none: "No risk" };
/** A category as a person names it (0.2.6): an OWASP list's name in words
 *  ("Supply chain"), a license by its name; a package's URL and an advisory's
 *  id are said with the package's advisories instead. */
function categoryWords(c) {
  if (c.list === LIST_IDS.llm || c.list === LIST_IDS.agentic) { const w = String(c.name ?? "").replace(/\s*&\s*/g, " and ").trim(); return w ? `${w[0].toUpperCase()}${w.slice(1).toLowerCase()}` : null; }
  if (c.list === LIST_IDS.spdx) return c.name || c.id;
  return null;
}
/** A finding's level, category and place, as a person reads them, with no finding code. */
function findingLine(f, report) {
  const level = f.level ? `**${LEVEL_WORDS[f.level] ?? mdText(f.level)}${f.level === "none" ? "" : " risk"}.** ` : "";
  const cats = [...new Set((f.categories ?? []).map(categoryWords).filter(Boolean))].map(mdText).join("; ");
  const advisories = Array.isArray(f.detail?.advisories) && f.detail.advisories.length ? ` Advisories: ${f.detail.advisories.map((a) => `${mdText(a.id)}${a.fixed ? ` (fixed in ${mdText(a.fixed)})` : ""}`).join(", ")}.` : "";
  // A place is set as code, where nothing is read as Markdown, so a path
  // needs no escapes; a backquote in it, the one character that would end
  // the code, is shown as a quote.
  const places = (f.evidence ?? []).slice(0, 5).map((e) => {
    const at = `\`${`${e.file}:${e.line}`.replace(/[`\r\n]/g, "'")}\``;
    const addr = lineAddress(report.repository, report.commit.sha, e.file, e.line);
    return addr ? `[${at}](${addr})` : at;
  });
  const more = (f.evidence?.length ?? 0) > 5 ? `, and ${f.evidence.length - 5} more` : "";
  const systemWord = { "code-host": "GitHub's records", "vulnerability-database": "OSV, the vulnerability database", "text-reasoning": "the model" };
  const from = !places.length && f.source?.length ? ` From ${mdText([...new Set(f.source.map((s) => systemWord[s.system] ?? s.system))].join(" and "))}.` : "";
  return `- ${level}**${mdText(f.title)}.** ${mdText(f.says)}${advisories}${cats ? ` Category: ${cats}.` : ""}${places.length ? ` At ${places.join(", ")}${more}.` : ""}${from}`;
}

/** The whole report as Markdown: the same findings, in the same sections, with
 *  each risk's level in words, sorted by level within its section. */
export function markdownOf(report) {
  const r = report; const sha = r.commit.sha;
  const lv = byLevel(r.findings);
  const sorted = (list) => [...list].sort((x, y) => levelRank(x) - levelRank(y) || r.findings.indexOf(x) - r.findings.indexOf(y));
  const lines = [
    `# Inspection of ${mdText(`${r.repository.owner}/${r.repository.name}`)}`,
    "",
    // 0.2.6: the short commit, and no remarks on how the report was made.
    `Commit ${String(sha ?? "").slice(0, 7)}${r.commit.date ? `, committed ${day(r.commit.date)}` : ""}. Inspected ${day(r.inspected_at)}.`,
    "",
    `Repository: ${r.repository.url}`,
    "",
    "## At a glance",
    "",
    `Risks by level: ${lv.critical} critical, ${lv.high} high, ${lv.medium} medium and ${lv.low} low.`,
    "",
  ];
  const glance = r.findings.filter((f) => f.section === 1);
  lines.push(...(glance.length ? glance.map((f) => findingLine(f, r)) : ["- Nothing was judged for this section."]), "");
  for (const s of SECTIONS.filter((x) => x.number > 1)) {
    const list = sorted(r.findings.filter((f) => f.section === s.number));
    lines.push(`## ${s.title}`, "", ...(list.length ? list.map((f) => findingLine(f, r)) : ["- None found."]), "");
  }
  if (r.held_back?.length) {
    lines.push("## Held back", "", ...r.held_back.map((h) => `- ${mdText(h.title)}: ${mdText(h.why)}`), "");
  }
  return lines.join("\n");
}

/** The reply: a header of named fields, section 1's findings, the counts. */
export function replyOf(report, { notes = [] } = {}) {
  const glance = report.findings.filter((f) => f.section === 1);
  const lines = [
    `repository: ${report.repository.owner}/${report.repository.name}`,
    `commit: ${report.commit.sha}`,
    `findings: ${report.counts.findings}`,
    `held_back: ${report.counts.held_back}`,
    "",
    ...notes.flatMap((n) => [n, ""]),
    "## At a glance",
    ...(glance.length ? glance.map((f) => `- ${f.says} (${f.repeats ?? f.id})`) : ["- Nothing was judged for this section; see the report."]),
    "",
    "## Sections",
    ...SECTIONS.map((s) => `${s.number}. ${s.title}: ${plural(report.counts.by_section[String(s.number)] ?? 0, "finding")}`),
    "",
    `The whole report is attached as inspection.json and, to read, as inspection.md; the dependency list as sbom.cdx.json. ${plural(report.counts.held_back, "judgment")} held back, each listed in the report with why.`,
  ];
  return lines.join("\n");
}
