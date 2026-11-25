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
//   needs: node >= 22. Nothing here reads the network or writes a file.
//   import { scriptFindings, notJudged, buildReport, replyOf, evidenceOf } from "./report.mjs"
import { checkEvidence } from "./evidence.mjs";
import { SECTIONS, categoryOf, LIST_IDS } from "./lists.mjs";

const trim = (s) => String(s ?? "").trim();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
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
  if (com) push(2, "commit", "The commit", `Commit ${sha}, committed ${day(com.data?.date)}. ${com.data?.checked ? "The archive's own header names this commit." : "The archive's own header did not name this commit, so it is not marked as checked."}`, [com], { detail: { sha, date: com.data?.date ?? null, checked: com.data?.checked === true } });
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
  if (skills.length) push(3, "skill", "Its skills", `${plural(own.length, "skill")} of the agent's own${helpers.length ? `, and ${plural(helpers.length, "skill")} kept for coding assistants that work on the repository (${[...new Set(helpers.map((h) => h.data.folder.split("/")[0]))].join(", ")})` : ""}.`, skills, { detail: { own: own.length, for_coding_assistants: helpers.length } });
  const parts = of("part");
  for (const s of [...own, ...helpers]) {
    const p = parts.find((x) => x.data?.part === "skill" && x.data?.folder === s.data?.folder);
    const keeps = p?.data?.keeps ?? [];
    const lift = !p ? "" : s.data.instructions_only ? "It holds instructions only, with no code of its own, so it can be lifted out as it is." : p.data.lift_out === "yes" ? `It can be lifted out on its own: its code imports nothing from outside its folder, reads no credential and loads no package at run time.${(p.data.settings ?? []).length ? ` It reads ${plural(p.data.settings.length, "setting")}: ${p.data.settings.map((x) => x.name).join(", ")}.` : ""}` : `It cannot be lifted out on its own: ${keeps.slice(0, 3).map((k) => `${k.file}:${k.line} ${k.why} (${k.spec})`).join("; ")}${keeps.length > 3 ? `, and ${keeps.length - 3} more in detail.keeps` : ""}.`;
    push(3, "skill", s.data.name, `${s.data.description ? `${s.data.description} ` : ""}${s.data.for_coding_assistants ? "A skill for coding assistants that work on the repository. " : ""}${lift}`.trim(), [s, ...(p ? [p] : [])], { detail: { name: s.data.name, path: s.data.folder, scripts: s.data.scripts, instructions_only: s.data.instructions_only === true, for_coding_assistants: s.data.for_coding_assistants === true, lift_out: p?.data?.lift_out ?? "no", keeps } });
  }
  const scriptParts = parts.filter((p) => p.data?.part === "script");
  for (const p of scriptParts.filter((x) => x.data.lift_out === "yes")) {
    const others = (p.data.files ?? []).filter((f) => f !== p.file);
    const sets = p.data.settings ?? [];
    push(3, "part", p.data.name, `${p.file} runs as a command and can be lifted out on its own${others.length ? `, with ${others.join(", ")}, which it imports from its own folder` : ""}: its code imports only the language's own modules, reads no credential and loads no package at run time.${sets.length ? ` It reads ${plural(sets.length, "setting")}: ${sets.map((s) => `${s.name} (${s.file}:${s.line})`).join(", ")}.` : ""}`, [p], { detail: { name: p.data.name, path: p.file, files: p.data.files ?? [p.file], lift_out: "yes", keeps: [], settings: sets } });
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
    push(5, "credential", n, says, at, { detail: { env: n, read_by_code: run.length > 0, files: at.map((c) => c.file) } });
  }

  // Section 7: known vulnerabilities with OSV's level, and committed credentials.
  for (const v of of("vulnerability").filter((x) => x.data?.level)) {
    const d = v.data;
    const cats = [categoryOf("LLM03:2025"), categoryOf("ASI04"), { list: LIST_IDS.cyclonedx, id: d.purl, name: `${d.name} ${d.version}` }, { list: LIST_IDS.osv, id: d.osv_id, name: d.osv_id }];
    push(7, "risk", `${d.name} ${d.version}: ${d.osv_id}`, `${d.name} ${d.version} has a known vulnerability, ${d.osv_id}${d.aliases?.length ? ` (${d.aliases.join(", ")})` : ""}${d.summary ? `: ${d.summary}` : ""}.${d.fixed ? ` It is fixed in ${d.fixed}.` : " OSV names no version that fixes it."}`, [v], { level: d.level, level_by: "source", categories: cats, detail: d });
  }
  // The rule: a credential in the code is high; one in a test file is medium,
  // since a test often holds a made-up key, and Inspect cannot tell which.
  for (const c of of("credential-shape")) push(7, "risk", `A committed credential in ${c.file}`, `Line ${c.line} of ${c.file} looks like ${c.data.what}.${c.data.in_test ? " The file is a test, and Inspect cannot tell whether the key is live or made up for the test." : ""} Inspect keeps only where it is, never its characters.`, [c], { level: c.data.in_test ? "medium" : "high", level_by: "rule", categories: [categoryOf("LLM02:2025"), categoryOf("ASI03")], detail: { what: c.data.what, in_test: c.data.in_test === true } });

  // Section 8: its tests, and what Inspect could not read or ask.
  const tests = of("test-file"); const cmd = of("test-command")[0];
  if (tests.length) push(8, "test", "Its tests", `${plural(tests.length, "test file")} with ${plural(tests.reduce((n, t) => n + (t.data.cases ?? 0), 0), "test case")} found by rule.${cmd?.data?.command ? ` Its test command is ${cmd.data.command}.` : ""} Inspect ran none of them.`, [...tests, ...(cmd?.file ? [cmd] : [])], { detail: { files: tests.length, cases: tests.reduce((n, t) => n + (t.data.cases ?? 0), 0) } });
  const archiveFact = of("commit")[0] ?? of("publisher")[0];
  if (!textFiles && archiveFact) push(8, "could-not-tell", "There was no code to read", "The archive held no file Inspect could read as text, so there was no code to inspect.", [archiveFact]);
  for (const g of bomGaps) {
    const f = facts.find((x) => x.kind === "bom-gap" && x.data?.about === g.about);
    if (f) push(8, "could-not-tell", `Not in the dependency list: ${g.about}`, `${g.why}.`, [f]);
  }
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

/** The report as the inspection-report-v1 schema says. */
export function buildReport({ owner, name, url, sha, checked, date, version, now, findings, held, facts, bom, osv, usage }) {
  const by = Object.fromEntries(SECTIONS.map((s) => [String(s.number), findings.filter((f) => f.section === s.number).length]));
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
    counts: { findings: findings.length, by_section: by, held_back: held.length, facts: facts.length },
    usage,
  };
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
    `The whole report is attached as inspection.json, and the dependency list as sbom.cdx.json. ${plural(report.counts.held_back, "judgment")} held back, each listed in the report with why.`,
  ];
  return lines.join("\n");
}
