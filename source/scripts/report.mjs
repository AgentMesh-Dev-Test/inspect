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
import { scrub } from "./secrets.mjs";
import { HOW_ORDER, settingNeed } from "./collect.mjs";
import { hookLevel, toolWords } from "./plugin-facts.mjs";
import { bodyOf } from "./agent-facts.mjs";

/** The most of one skill's instructions the report carries, and of all of them (0.3.0). */
export const INSTRUCTIONS_CHARS = 8_000;
export const INSTRUCTIONS_TOTAL = 250_000;
/** The most of a plugin's commands', sub-agents' and rules' instructions the report carries, beside the skills' (0.5.4). */
export const PARTS_TOTAL = 80_000;

const trim = (s) => String(s ?? "").trim();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Titles a person reads (0.2.6): never a slug, a file name or a setting's name.
/** A name with spaces for its dashes and underscores and no file extension: "brand-lint.mjs" as "Brand lint". */
export function spaced(name, cased = (w) => w) {
  const t = String(name ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().split(" ").map((w) => cased(w)).join(" ");
  return t ? `${t[0].toUpperCase()}${t.slice(1)}` : String(name ?? "");
}
/** A skill's title: its own one-line description when the repository gives
 *  one (its first sentence, when that is short), else its name with spaces. */
export function skillTitle(name, description, cased) {
  let d = String(description ?? "").replace(/\s+/g, " ").trim().replace(/^(['"])(.*)\1$/, "$2").replace(/''/g, "'");
  // A YAML block marker (">", "|-") is not a description; the lines after it were not read.
  if (/^[>|][+-]?\d?$/.test(d)) d = "";
  // A description written to trigger the skill says what it is for.
  d = d.replace(/^(?:invoke|use)\s+this\s+skill\s+(?:when|to|for|if)\s+|^use\s+(?:when|to|for|if)\s+/i, "");
  // Shouted words are said plainly: a word of five or more capitals ("GENERAL") as a word.
  d = d.replace(/\b(OR|AND|ANY|ALL|NOT|ONLY)\b/g, (w) => w.toLowerCase()).replace(/\b[A-Z]{5,}\b/g, (w) => `${w[0]}${w.slice(1).toLowerCase()}`).replace(/\s+[—–]\s+/g, ": ");
  const first = d.split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]+$/, "") ?? "";
  return first && first.length <= 110 ? `${first[0].toUpperCase()}${first.slice(1)}` : spaced(name, cased);
}
/** A credential's title from the setting it is read from: "GEMINI_API_KEY" as "Gemini API key". */
export function credentialTitle(env, cased = (w) => w) {
  const words = String(env ?? "").toLowerCase().split(/[_\s]+/).filter(Boolean).map((w) => (/^(api|url|id|ssh|aws|gcp|llm|mcp|oauth|jwt)$/.test(w) ? w.toUpperCase() : cased(w)));
  if (!words.length) return String(env ?? "");
  const t = words.join(" ");
  return `${t[0].toUpperCase()}${t.slice(1)}`;
}
/** The address of a file at the commit on GitHub, or null when the repository is not on GitHub. */
export function fileAddress(repoUrl, sha, file) {
  let u;
  try { u = new URL(String(repoUrl ?? "")); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== "github.com" || !/^[0-9a-f]{40}$/.test(String(sha ?? "")) || !file) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}/blob/${sha}/${String(file).split("/").map(encodeURIComponent).join("/")}`;
}
/** The maker of a model, from the name the code gives it, or null. */
export function makerOf(id) {
  const t = String(id ?? "").toLowerCase();
  if (/anthropic|claude/.test(t)) return "Anthropic";
  if (/openai|gpt|\bo[1-9]\b|dall-?e|whisper/.test(t)) return "OpenAI";
  if (/gemini|lyria|imagen|veo|google|palm/.test(t)) return "Google";
  if (/eleven/.test(t)) return "ElevenLabs";
  if (/mistral|mixtral/.test(t)) return "Mistral";
  if (/llama|meta/.test(t)) return "Meta";
  if (/grok|xai/.test(t)) return "xAI";
  if (/deepseek/.test(t)) return "DeepSeek";
  if (/cohere|command-r/.test(t)) return "Cohere";
  return null;
}
/** Versions in order, by their numbers. */
export const byVersion = (a, b) => { const x = String(a).split(/[.+-]/); const y = String(b).split(/[.+-]/); for (let i = 0; i < Math.max(x.length, y.length); i += 1) { const d = (Number(x[i]) || 0) - (Number(y[i]) || 0); if (d) return d; } return 0; };
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
export function scriptFindings({ facts, ctx, owner, name, sha, repoUrl, osv = null, bomGaps = [], files = [], textFiles = 0, skillTexts = new Map(), cased = (w) => w, subject = null, read = () => null }) {
  const out = [];
  const of = (kind) => facts.filter((f) => f.kind === kind);
  const push = (section, kind, title, says, cited, extra = {}) => {
    const { evidence, source } = evidenceOf(cited, ctx);
    if (!evidence.length && !source.length) return;
    out.push({ section, kind, title, says, by: "script", based_on: cited.map((f) => f.id), ...(evidence.length ? { evidence } : {}), ...(source.length ? { source } : {}), ...extra });
  };

  // Section 2: what was inspected. 0.5.0: first, what a plugin or skill
  // repository is, where it runs, and the plugins it holds.
  if (subject) push(2, "subject", "What it is", subjectWords(subject), [...of("plugin-manifest"), ...of("plugin").filter((p) => p.data?.inspected), ...(subject.kind === "skills" ? of("skill").slice(0, 3) : [])], { detail: { kind: subject.kind, name: subject.name ?? null, ...(subject.display_name ? { display_name: subject.display_name } : {}), version: subject.version ?? null, author: subject.author ?? null, tools: subject.tools ?? [], also_for: subject.also_for ?? [], ...(subject.description ? { description: subject.description } : {}) } });
  if (subject?.plugins?.length) {
    const listed = subject.plugins.map((p) => `${p.name}${p.elsewhere ? " (kept in another repository)" : ` (${plural(p.skills ?? 0, "skill")}${p.inspected ? ", this report" : ""})`}`);
    const mine = subject.plugins.find((p) => p.inspected);
    push(2, "plugins", "The plugins in this repository", `${plural(subject.plugins.length, "plugin")}: ${and(listed)}. This report is ${mine?.name ?? "the first"}${subject.picked_by === "request" ? ", the one asked for" : ", the first listed"}; to inspect another, run Inspect again and name it.`, of("plugin"), { detail: { plugins: subject.plugins, picked_by: subject.picked_by ?? "first" } });
  }
  const pub = of("publisher")[0]; const act = of("activity")[0]; const com = of("commit")[0]; const rec = of("recent-commits")[0];
  if (pub) push(2, "repository", "The repository", `${owner}/${name} on GitHub, ${repoUrl}.`, [pub], { detail: { owner, name, url: repoUrl } });
  // 0.4.0: a commit read because none was named is the newest on the default branch, and says so.
  const newestOn = trim(com?.data?.newest_on);
  if (com) push(2, "commit", "The commit", `Commit ${String(sha).slice(0, 7)}, committed ${day(com.data?.date)}${newestOn ? `, the newest on ${newestOn} when it was inspected` : ""}. ${com.data?.checked ? "The archive's own header names this commit." : "The archive's own header did not name this commit, so it is not marked as checked."}`, [com], { detail: { sha, date: com.data?.date ?? null, checked: com.data?.checked === true, ...(newestOn ? { newest_on: newestOn } : {}) } });
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
  // 0.5.0: a SKILL.md a plugin's tools never load is no skill of it.
  const own = skills.filter((s) => !s.data?.for_coding_assistants && !s.data?.not_loaded);
  const helpers = skills.filter((s) => s.data?.for_coding_assistants);
  if (skills.length) push(3, "skill", "Skills", `${plural(own.length, "skill")}${subject ? "" : " of the agent's own"}${helpers.length ? `, and ${plural(helpers.length, "skill")} kept for coding assistants that work on the repository (${[...new Set(helpers.map((h) => h.data.folder.split("/")[0]))].join(", ")})` : ""}.`, skills, { detail: { own: own.length, for_coding_assistants: helpers.length } });
  const parts = of("part");
  let carried = 0;
  for (const s of [...own, ...helpers]) {
    const p = parts.find((x) => x.data?.part === "skill" && x.data?.folder === s.data?.folder);
    const keeps = p?.data?.keeps ?? [];
    const lift = !p ? "" : s.data.instructions_only ? "It holds instructions only, with no code of its own, so it can be lifted out as it is." : p.data.lift_out === "yes" ? `It can be lifted out on its own: its code imports nothing from outside its folder, reads no credential and loads no package at run time.${(p.data.settings ?? []).length ? ` It reads ${plural(p.data.settings.length, "setting")}: ${p.data.settings.map((x) => x.name).join(", ")}.` : ""}` : `It cannot be lifted out on its own: ${keeps.slice(0, 3).map((k) => `${k.file}:${k.line} ${k.why} (${k.spec})`).join("; ")}${keeps.length > 3 ? `, and ${keeps.length - 3} more in detail.keeps` : ""}.`;
    // 0.3.0: the skill's size (its scripts, their lines of code, its
    // instructions' length and the tests that name it) and its instructions,
    // for the view to show in a viewer; past INSTRUCTIONS_CHARS, or once the
    // report carries INSTRUCTIONS_TOTAL of them, the rest is on GitHub.
    const body = String(skillTexts.get(s.data.folder) ?? "");
    const room = Math.max(0, Math.min(INSTRUCTIONS_CHARS, INSTRUCTIONS_TOTAL - carried));
    const text = body.length <= room ? body : body.slice(0, room).replace(/\s+\S*$/, ""); // cut-ok: the whole file is at instructions_address, and instructions_cut says so
    carried += text.length;
    push(3, "skill", skillTitle(s.data.name, s.data.description, cased), `${s.data.description ? `${s.data.description} ` : ""}${s.data.for_coding_assistants ? "A skill for coding assistants that work on the repository. " : ""}${lift}`.trim(), [s, ...(p ? [p] : [])], { detail: { name: s.data.name, path: s.data.folder, ...(s.data.description ? { description: s.data.description } : {}), scripts: s.data.scripts, instructions_only: s.data.instructions_only === true, for_coding_assistants: s.data.for_coding_assistants === true, lift_out: p?.data?.lift_out ?? "no", keeps, size: subject && s.data.size ? { ...s.data.size, instruction_lines: body.split(/\r?\n/).filter((l) => l.trim()).length } : s.data.size ?? null, instructions: scrub(text), instructions_cut: text.length < body.length, instructions_address: fileAddress(repoUrl, sha, s.file) } });
  }
  const scriptParts = parts.filter((p) => p.data?.part === "script");
  for (const p of scriptParts.filter((x) => x.data.lift_out === "yes")) {
    const others = (p.data.files ?? []).filter((f) => f !== p.file);
    const sets = p.data.settings ?? [];
    push(3, "part", spaced(p.data.name, cased), `${p.file} runs as a command and can be lifted out on its own${others.length ? `, with ${others.join(", ")}, which it imports from its own folder` : ""}: its code imports only the language's own modules, reads no credential and loads no package at run time.${sets.length ? ` It reads ${plural(sets.length, "setting")}: ${sets.map((s) => `${s.name} (${s.file}:${s.line})`).join(", ")}.` : ""}`, [p], { detail: { name: p.data.name, path: p.file, files: p.data.files ?? [p.file], lift_out: "yes", keeps: [], settings: sets } });
  }
  const tied = scriptParts.filter((x) => x.data.lift_out !== "yes");
  if (tied.length) push(3, "part", "Scripts that cannot be lifted out", `${plural(tied.length, "script")} that run as commands cannot be lifted out on their own: each imports a package or a file from outside its folder, reads a credential, or loads a package at run time.`, tied, { detail: { parts: tied.map((p) => ({ path: p.file, keeps: p.data.keeps })) } });

  // The agent's own code outside its skills and tests (0.3.0): how much there
  // is; the model says what it covers.
  const ownCode = of("own-code")[0];
  if (ownCode) push(3, "code", "Its own code", `${plural(ownCode.data.files, "file")} and ${ownCode.data.lines.toLocaleString("en-US")} lines of code outside its skills and its tests.`, [ownCode], { detail: { files: ownCode.data.files, lines: ownCode.data.lines } });

  // 0.5.0: each command, sub-agent and rule a plugin adds to the person's
  // tools, with its size and the tools it may use; its instructions travel
  // with it for the viewer, from the same budget as the skills'.
  const SAID = { "slash-command": "A command the person types to start it", "sub-agent": "A sub-agent the assistant can hand work to", rule: "A rule the assistant follows" };
  // 0.5.4: their own budget, so a plugin's many skills never leave its
  // commands and sub-agents with nothing to read (vercel-plugin's forty did).
  let carriedParts = 0;
  for (const kind of ["slash-command", "sub-agent", "rule"]) {
    for (const c of of(kind)) {
      const d = c.data ?? {};
      const body = bodyOfText(read(c.file));
      const room = Math.max(0, Math.min(INSTRUCTIONS_CHARS, PARTS_TOTAL - carriedParts));
      const text = body.length <= room ? body : body.slice(0, room).replace(/\s+\S*$/, ""); // cut-ok: the whole file is at instructions_address, and instructions_cut says so
      carriedParts += text.length;
      const how = [d.shell ? "It may run shell commands." : null, kind === "rule" && d.always ? "It applies to every request." : null, d.tools?.length && subject?.tools?.length > 1 ? `For ${and(d.tools)}.` : null].filter(Boolean).join(" ");
      push(3, kind, skillTitle(d.name, d.description, cased), `${d.description ? `${d.description}${/[.!?]$/.test(d.description) ? "" : "."} ` : `${SAID[kind]}. `}${how}`.trim(), [c], { detail: { name: d.name, ...(d.description ? { description: d.description } : {}), tools: d.tools ?? [], ...(d.may_use ? { may_use: d.may_use, shell: d.shell === true } : {}), ...(d.model ? { model: d.model } : {}), ...(kind === "rule" ? { always: d.always === true } : {}), size: d.size ?? null, instructions: scrub(text), instructions_cut: text.length < body.length, instructions_address: fileAddress(repoUrl, sha, c.file) } });
    }
  }

  // Section 4: the models the code names.
  const models = of("model").filter((m) => !m.data?.in_config);
  const configModels = of("model").filter((m) => m.data?.in_config);
  if (models.length || configModels.length) {
    const names = [...new Set(models.map((m) => m.data.match))];
    const bySetting = models.filter((m) => m.data.chosen_by === "setting");
    const configFiles = [...new Set(configModels.map((m) => m.file))];
    // 0.3.4: its words name the makers, never a model's id, a setting or a
    // file as the code writes them; those are in its detail and the Markdown.
    const inConfig = [...new Set(configModels.map((m) => m.data.match))];
    const makers = [...new Set([...names, ...inConfig].map(makerOf).filter(Boolean))];
    const and = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
    const says = `${names.length ? `Its code names ${plural(names.length, "model")}${makers.length ? `, from ${and(makers)}` : ""}.` : "Its code names no model."}${bySetting.length ? ` A setting chooses the model in ${plural(bySetting.length, "place")}.` : names.length ? " No setting chooses one." : ""}${inConfig.length ? ` Its configuration names ${plural(inConfig.length, "model")} more.` : ""}`;
    push(4, "model", "The models it names", says, [...models, ...configModels], { detail: { models: names, makers, set_by_setting: [...new Set(bySetting.flatMap((m) => m.data.settings ?? []))], in_config: inConfig, config_files: configFiles } });
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
    // 0.4.0: whether a person must supply it, by the same rule as a system's.
    const need = settingNeed(n, facts);
    push(5, "credential", credentialTitle(n, cased), says, at, { detail: { env: n, read_by_code: run.length > 0, files: at.map((c) => c.file), how: HOW_ORDER.find((h) => run.some((c) => c.data.how === h)) ?? null, ...(need ? { need: need.need, need_by: "rule", need_why: need.why } : {}) } });
  }

  // 0.5.0: each MCP server a plugin brings, a program it starts on the
  // person's machine or an address it connects to, with what it needs; and
  // each key the plugin asks the person for.
  for (const m of of("mcp-server")) {
    const d = m.data ?? {};
    const title = spaced(d.name, cased);
    const local = d.transport === "stdio";
    const program = d.programs?.[0];
    const needs = (d.settings ?? []).map((s) => credentialTitle(String(s).replace(/^user_config\./, ""), cased));
    const supply = d.auth === "oauth" ? `Your ${title} account, signed in` : needs.length ? `Your ${and(needs)}` : local || !d.auth ? "Nothing to set up" : null;
    const says = local
      ? (program ? `Starts ${program.kind} that comes with the plugin (${Number(program.lines).toLocaleString("en-US")} ${program.lines === 1 ? "line" : "lines"} of code) on the person's machine, each time the tool starts.`
        : d.runner ? `Starts ${d.package ?? "a package"} on the person's machine${d.pinned ? ", at the version the plugin names" : ", fetching its newest version each time it starts"}.`
          : `Starts the program ${d.command ?? "it names"} on the person's machine.`)
      : `Connects to ${d.host ?? "an outside address"}${d.auth === "oauth" ? ", where the person signs in with their own account" : d.auth === "header" ? ", sending a key with each request" : ""}.`;
    push(5, "mcp-server", title, `${says}${needs.length ? ` It needs ${and(needs)}.` : ""}${d.tools?.length && subject?.tools?.length > 1 ? ` For ${and(d.tools)}.` : ""}`, [m], { detail: { name: d.name, transport: d.transport, local, ...(d.host ? { host: d.host } : {}), ...(d.runner ? { runner: d.runner, package: d.package ?? null, pinned: d.pinned === true } : {}), ...(d.auth ? { auth: d.auth } : {}), settings: d.settings ?? [], ...(supply ? { supply } : {}), tools: d.tools ?? [] } });
  }
  for (const u of of("user-config").filter((x) => x.data?.sensitive)) {
    const d = u.data;
    const title = trim(d.title) || credentialTitle(d.name, cased);
    push(5, "credential", title, `The plugin asks the person for their ${title.toLowerCase()} when it is turned on${d.tool === "Claude Code" ? ", and Claude Code keeps it in the machine's secure store" : ""}.`, [u], { detail: { env: d.name, read_by_code: true, from: "plugin-settings", need: d.required ? "required" : "optional", need_by: "rule", need_why: d.required ? "the plugin asks for it before it turns on" : "the plugin turns on without it" } });
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
    // How to make it safe (0.3.0): the newest version any advisory names as its fix.
    const fixes = [...new Set(advisories.map((a) => a.fixed).filter(Boolean))].sort(byVersion);
    const safe = fixes.length ? `Update ${d.name} to ${fixes.at(-1)} or later.${advisories.some((a) => !a.fixed) ? " One or more of its flaws has no fix yet." : ""}` : `No fixed version of ${d.name} is out yet; leave out the part that uses it, or wait for a fix.`;
    push(7, "risk", `${d.name} ${d.version} has ${advisories.length === 1 ? "a known security flaw" : "known security flaws"}`, says, vs, { level, level_by: "source", categories: cats, detail: { name: d.name, version: d.version, purl: d.purl, advisories, safe } });
  }
  // The rule: a credential in the code is high; one in a test file is medium,
  // since a test often holds a made-up key, and Inspect cannot tell which.
  // Its words name no file (0.3.0): the file and line are its evidence.
  for (const c of of("credential-shape")) push(7, "risk", c.data.in_test ? "A committed credential in a test file" : "A committed credential in the code", `${c.data.in_test ? "A test file" : "The code"} holds what looks like ${c.data.what}.${c.data.in_test ? " Inspect cannot tell whether the key is live or made up for the test." : ""} Inspect keeps only where it is, never its characters.`, [c], { level: c.data.in_test ? "medium" : "high", level_by: "rule", categories: [categoryOf("LLM02:2025"), categoryOf("ASI03")], detail: { what: c.data.what, in_test: c.data.in_test === true, safe: "Take the key out of the repository, and replace it if it was ever live." } });

  // 0.5.0: each hook, by rule: what starts it, what it runs, and what that
  // reaches. A hook runs on the person's machine with their access, without
  // asking, every time its event comes, so each is a risk of its own.
  // The hooks one event starts in the same tools, of the same type, are one
  // risk at the highest level of theirs, so a row never says what another does.
  const hookGroups = new Map();
  for (const h of of("hook")) {
    const d = h.data ?? {};
    const key = `${d.trigger}|${d.type === "agent" ? "prompt" : d.type}|${(d.tools ?? []).join(",")}`;
    hookGroups.set(key, [...(hookGroups.get(key) ?? []), h]);
  }
  const RANK = ["critical", "high", "medium", "low", "none"];
  for (const group of hookGroups.values()) {
    const d = group[0].data ?? {};
    const levels = group.map((h) => hookLevel(h.data));
    const lv = levels.sort((a, b) => RANK.indexOf(a.level) - RANK.indexOf(b.level))[0];
    const n = group.length;
    const programs = group.flatMap((h) => h.data?.programs ?? []);
    const own = group.filter((h) => (h.data?.programs ?? []).length);
    const fetched = group.filter((h) => !(h.data?.programs ?? []).length && h.data?.runner);
    const lines = programs.reduce((k, p) => k + (Number(p.lines) || 0), 0);
    const imports = programs.reduce((k, p) => k + (Number(p.imports) || 0), 0);
    const kinds = [...new Set(own.map((h) => h.data.programs[0].kind))];
    const progWords = (count) => (kinds.length === 1 ? (count === 1 ? kinds[0] : `${count} ${kinds[0].replace(/^an? /, "").replace(/(script|program)$/, "$1s")}`) : count === 1 ? "a program" : `${count} programs`);
    const what = d.type === "http" ? `sends what happens in the session to ${and([...new Set(group.map((h) => hostOf(h.data?.url) ?? "an outside address"))])}`
      : d.type === "prompt" || d.type === "agent" ? `asks a model to check what happens${n > 1 ? `, ${n} times` : ""}, and runs no program`
        : [own.length ? `runs ${progWords(own.length)} that come${own.length === 1 ? "s" : ""} with the plugin` : null,
          fetched.length ? `runs ${and(fetched.map((h) => h.data.package ?? "a package"))}, fetched fresh each time` : null,
          group.length - own.length - fetched.length > 0 ? `runs ${group.length - own.length - fetched.length === 1 ? "a command" : `${group.length - own.length - fetched.length} commands`} the plugin does not hold` : null].filter(Boolean).join(", and ");
    const hosts = [...new Set(programs.flatMap((p) => p.hosts ?? []))];
    const touches = new Set(programs.flatMap((p) => p.touches ?? []));
    const reach = [
      // 0.5.3: what it prints, the tool adds to the assistant's instructions.
      touches.has("adds-context") ? "What it prints is added to the assistant's instructions." : null,
      hosts.length ? `What it runs calls ${and(hosts)}.` : null,
      touches.has("credential-store") ? "It reads where keys and sign-ins are kept." : null,
      touches.has("download-run") ? "It downloads code and runs it." : null,
      touches.has("home-folder") ? "It works in the person's home folder." : null,
      touches.has("environment") ? "It reads the whole environment, where keys are often kept." : null,
      programs.some((p) => p.starts?.length) ? "It starts other programs." : null,
    ].filter(Boolean);
    // Its words say what its title can't (0.3.4): the tools, where and how it
    // runs, how much code, and what that code reaches; the title says what
    // starts it and what it runs.
    const files = programs.length + imports;
    const size = own.length ? ` ${lines.toLocaleString("en-US")} ${lines === 1 ? "line" : "lines"} of code${files > 1 ? ` across ${files} files` : ""}` : "";
    const where = d.type === "command" ? `it runs${size} on the person's machine with their access, without asking` : `it ${what}`;
    const tail = d.type === "command" && fetched.length + (group.length - own.length - fetched.length) > 0 && own.length ? ` It also ${what.split(", and ").slice(1).join(" and ")}.` : "";
    const says = `${d.tools?.length ? `In ${and(d.tools)}, ` : ""}${where}.${tail} ${reach.length ? reach.join(" ") : own.length && own.length === n ? "Its code names no outside address and reads no stored credentials." : ""}`.replace(/^i/, "I").trim();
    const verb = d.type === "http" ? "Sends the session's events out" : d.type === "prompt" || d.type === "agent" ? "Asks a model" : own.length === n ? `Runs ${progWords(n)}` : n === 1 && fetched.length ? `Runs ${fetched[0].data.package ?? "a package"}` : n === 1 ? "Runs a command" : `Runs ${n} commands`;
    const trigger = String(d.trigger ?? "").replace(/^When /, "when ").replace(/^(Before|After|Each|On) /, (m) => m.toLowerCase());
    const safe = `${d.type === "command" ? "Read what it runs before allowing the plugin, and allow it only where that code may run with the person's access." : "Check where it sends what it sees before allowing the plugin."}${(d.tools ?? []).includes("Claude Code") ? " In Claude Code, an administrator's managed settings can allow only the hooks a company approves." : ""}`;
    push(7, "risk", `${verb} ${trigger}`.replace(/\s+/g, " "), says, group, { level: lv.level, level_by: "rule", categories: lv.categories.map(categoryOf).filter(Boolean), detail: { hook: { event: d.event, trigger: d.trigger, type: d.type, tools: d.tools ?? [], hooks: n, runs: what, lines, files: group.reduce((k, h) => k + (h.data?.files ?? []).length, 0), hosts, touches: [...touches], why: lv.why }, safe } });
  }
  // An MCP server fetched fresh each time it starts: what runs can change with no change to the plugin.
  for (const m of of("mcp-server").filter((x) => x.data?.runner && x.data.runner !== "docker" && !x.data.pinned)) {
    const d = m.data;
    push(7, "risk", `Starts the newest ${d.package ?? "version of a package"} each time`, `Its ${spaced(d.name, cased)} MCP server fetches ${d.package ?? "a package"} and runs it on the person's machine each time it starts, so what runs can change with no change to the plugin.`, [m], { level: "medium", level_by: "rule", categories: [categoryOf("LLM03:2025"), categoryOf("ASI04")], detail: { package: d.package ?? null, safe: `Pin ${d.package ?? "the package"} to one version you have read, or install a reviewed copy.` } });
  }
  // Scripts that read where keys and sign-ins are kept.
  const stores = of("capability").filter((c) => c.data?.what === "credential-store");
  if (stores.length) {
    const kinds = [...new Set(stores.map((c) => storeWord(c.data.match)).filter(Boolean))];
    push(7, "risk", stores.length === 1 ? "A script that reads stored credentials" : "Scripts that read stored credentials", `${stores.length === 1 ? "One of its scripts reads" : `${plural(stores.length, "script")} read`} where keys and sign-ins are kept on the person's machine${kinds.length ? `: ${and(kinds)}` : ""}. They run with the person's own access.`, stores, { level: "high", level_by: "rule", categories: [categoryOf("LLM02:2025"), categoryOf("ASI03")], detail: { stores: kinds, safe: "Find out why it reads them before allowing the plugin, and run it only where those files hold nothing it may not use." } });
  }

  // Section 8: its tests, and what Inspect could not read or ask.
  const tests = of("test-file"); const cmd = of("test-command")[0];
  // 0.3.0: how many tests, of what kind, and how many run without live keys.
  if (tests.length) {
    const cases = tests.reduce((n, t) => n + (t.data.cases ?? 0), 0);
    const live = tests.filter((t) => t.data.live).reduce((n, t) => n + (t.data.cases ?? 0), 0);
    const kinds = {}; for (const t of tests) kinds[t.data.kind ?? "other"] = (kinds[t.data.kind ?? "other"] ?? 0) + (t.data.cases ?? 0);
    push(8, "test", "Tests", `${plural(cases, "test")} in ${plural(tests.length, "file")}, found by rule; ${live ? `${plural(live, "test")} need live keys or services, and the rest run offline` : "none needs live keys"}. Inspect ran none of them.`, [...tests, ...(cmd?.file ? [cmd] : [])], { detail: { files: tests.length, cases, live, kinds, ...(cmd?.data?.command ? { command: cmd.data.command } : {}) } });
  }
  const archiveFact = of("commit")[0] ?? of("publisher")[0];
  if (!textFiles && archiveFact) push(8, "could-not-tell", "There was no code to read", "The archive held no file Inspect could read as text, so there was no code to inspect.", [archiveFact]);
  // 0.2.7: one finding for every gap in the dependency list, its title in
  // words; the files are in its words and its evidence, not in its title.
  const gapFacts = bomGaps.map((g) => ({ g, f: facts.find((x) => x.kind === "bom-gap" && x.data?.about === g.about) })).filter((x) => x.f);
  // 0.3.0: its words name no file; the files are its evidence and its detail.
  if (gapFacts.length) push(8, "could-not-tell", gapFacts.length === 1 ? "Versions missing from the dependency list" : "Some versions are missing from the dependency list", `The versions installed for ${plural(gapFacts.length, "part")} of the repository are not in the dependency list, so they were not checked for known security flaws.`, gapFacts.map((x) => x.f), { detail: { gaps: gapFacts.map(({ g }) => ({ about: g.about, why: g.why })) } });
  const nc = of("not-checked");
  if (nc.length) { const why = (w) => (/ecosystem/.test(w) ? "the database of known flaws is not asked about their kind of package" : /range/.test(w) ? "only a range of versions is given, not one version" : "there were more than the database of known flaws is asked about in one job"); push(8, "could-not-tell", "Dependencies not checked for known security flaws", `${plural(nc.length, "dependency", "dependencies")} could not be checked for known security flaws: ${[...new Set(nc.map((x) => why(String(x.data.why))))].join("; ")}.`, nc, { detail: { components: nc.map((x) => ({ purl: x.data.purl, why: x.data.why })) } }); }
  if (osv && !osv.ok) { const f = of("osv-failed")[0]; if (f) push(8, "could-not-tell", "The dependencies were not checked for known security flaws", `The dependencies were not checked for known security flaws: ${osv.said}.`, [f]); }
  const unread = of("vulnerability-unread");
  if (unread.length) push(8, "could-not-tell", "Vulnerabilities not read in full", `OSV named ${plural(unread.length, "more known security flaw", "more known security flaws")} than Inspect reads in one job.`, unread, { detail: { ids: unread.map((u) => u.data.id) } });
  const links = of("link");
  if (links.length) push(8, "could-not-tell", "Links in the repository", `The repository holds ${plural(links.length, "link")} to other files, which Inspect did not follow.`, links, { detail: { links: links.map((l) => l.data) } });
  const refused = of("refused-path");
  if (refused.length) push(8, "could-not-tell", "Files not written", `${plural(refused.length, "file")} of the archive had a path that leads outside it, so Inspect did not read ${refused.length === 1 ? "it" : "them"}.`, refused, { detail: { paths: refused.map((r) => r.data.path) } });
  // 0.5.0: what a plugin reaches that the repository does not hold.
  const away = of("plugin").filter((p) => p.data?.elsewhere);
  if (away.length) push(8, "could-not-tell", "Plugins kept in other repositories", `The repository lists ${plural(away.length, "plugin")} kept elsewhere (${and(away.map((p) => p.data.name))}), which Inspect did not read.`, away, { detail: { plugins: away.map((p) => ({ name: p.data.name, elsewhere: p.data.elsewhere })) } });
  const outside = of("hook").filter((h) => h.data?.type === "command" && !(h.data.files ?? []).length);
  if (outside.length) push(8, "could-not-tell", outside.length === 1 ? "What a hook runs is not in the repository" : "What some hooks run is not in the repository", `${outside.length === 1 ? "One hook runs" : `${plural(outside.length, "hook")} run`} a program the plugin does not hold, installed on the machine or fetched when it runs, so Inspect could not read it.`, outside);
  const remote = of("mcp-server").filter((m) => m.data?.transport !== "stdio" && m.data?.host);
  if (remote.length) push(8, "could-not-tell", remote.length === 1 ? `What the ${spaced(remote[0].data.name, cased)} connection can do` : "What its MCP connections can do", `The tools ${remote.length === 1 ? `the ${spaced(remote[0].data.name, cased)} connection offers come from its server at ${remote[0].data.host}` : `its MCP connections offer come from their servers (${and(remote.map((m) => m.data.host))})`}, not from the repository, so Inspect could not list them or say what they can change in the person's accounts.`, remote);
  return out;
}

/** "a, b and c". */
const and = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
/** A SKILL.md's or a command's text without its front matter. */
const bodyOfText = (text) => bodyOf(text);
/** An address's host, or null. */
const hostOf = (u) => { try { return new URL(String(u ?? "")).hostname || null; } catch { return null; } };
/** Where keys are kept, in words, from what a script names. */
function storeWord(match) {
  const m = String(match ?? "").toLowerCase();
  if (m.includes(".ssh")) return "SSH keys"; if (m.includes(".aws")) return "AWS credentials"; if (m.includes(".npmrc")) return "npm's token file";
  if (m.includes(".pypirc")) return "PyPI's token file"; if (m.includes(".netrc")) return "saved sign-ins for sites"; if (m.includes(".docker")) return "Docker's sign-in";
  if (m.includes(".kube")) return "Kubernetes credentials"; if (m.includes("gh") || m.includes("git-credentials")) return "GitHub's saved token"; if (m.includes("gcloud")) return "Google Cloud's token";
  if (/keychain|keytar|security/.test(m)) return "the system keychain"; if (/chrom|firefox|brave|cookie|login data/.test(m)) return "a browser's cookies or saved passwords";
  return null;
}
/** What a plugin or skill repository is, as a fact: where it runs and with whose access. */
export function subjectWords(subject) {
  const s = subject ?? {};
  const where = "Once installed, it runs inside the person's own tool, on their machine, with their files and their credentials.";
  if (s.kind === "skills") return `${s.skills === 1 ? "A skill" : `${plural(s.skills ?? 0, "skill")}`} on ${s.skills === 1 ? "its" : "their"} own, with no plugin manifest, in the Agent Skills format that Claude Code, Cursor and Codex read. ${where.replace("it runs", s.skills === 1 ? "it runs" : "each runs")}`;
  const tools = toolWords(s);
  const also = s.also_for?.length ? `, also packaged for ${and(s.also_for)}` : "";
  const by = [s.version ? `version ${s.version}` : null, s.author ? `made by ${s.author}` : null].filter(Boolean).join(", ");
  return `A plugin for ${tools || "coding tools"}${also}${by ? `; ${by}` : ""}. ${where}`;
}

/** The findings that say a judgment was not made, one for each section it
 *  would have held. `source` names what ended it: the model by default, or
 *  the screening when it could not pass the text first (0.4.6). */
export function notJudged(sections, why, which, source = { system: "text-reasoning", call: `the judgment of sections ${which}`, field: "why the answer ended" }) {
  return sections.map((s) => ({
    section: s, kind: "not-judged", title: "Not judged", by: "script", based_on: [],
    says: `The judgment of section ${s} was not made: ${trim(why)}. The scripts' findings of this section stand.`,
    source: [source],
  }));
}

/** What ends a judgment that the screening could not pass the text for. */
export const SCREENING_SOURCE = { system: "screening", call: "POST /v1/screen-text", field: "why nothing was screened" };

/**
 * 0.4.6: the passages AgentMesh's screening held before the model could read
 * them, as one risk by rule. `held` is [{fact, verdict, reason?}]. A "hold" is
 * the screener reading the text as instructions aimed at an AI (prompt
 * injection or a jailbreak), so the risk is high; a passage held for another
 * reason the screener named is medium. Its words are Inspect's own and quote
 * none of the passages, because the last call reads them: the passages are its
 * evidence, for a person to read.
 */
export function screeningFindings(held, ctx) {
  if (!held.length) return [];
  const cited = held.map((h) => h.fact);
  const { evidence, source } = evidenceOf(cited, ctx);
  const n = held.length;
  const steer = held.filter((h) => h.verdict === "hold").length;
  const them = n === 1 ? "it" : "them";
  const how = !steer ? "" : steer === n ? `: ${n === 1 ? "it reads" : "they read"} as instructions aimed at an AI that reads the code` : `: ${steer} of them read as instructions aimed at an AI that reads the code`;
  return [{
    section: 7, kind: "risk", by: "script",
    title: steer ? "Text that tries to steer an AI that reads it" : "Text the screening kept from Inspect's model",
    says: `AgentMesh's screening held ${plural(n, "passage")} of the code before Inspect's model could read ${them}${how}. The judgments in this report rest on the rest of the code.`,
    based_on: cited.map((f) => f.id), ...(evidence.length ? { evidence } : {}), source: [...source, SCREENING_SOURCE],
    level: steer ? "high" : "medium", level_by: "rule",
    ...(steer ? { categories: [categoryOf("LLM01:2025"), categoryOf("ASI01")] } : {}),
    detail: {
      held: n, as_instructions: steer,
      reasons: [...new Set(held.map((h) => trim(h.reason)).filter(Boolean))],
      safe: `Read the ${n === 1 ? "passage" : "passages"} this cites before you bring the agent in: text written to steer an AI can also reach the models the agent itself uses.`,
    },
  }];
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
export function buildReport({ owner, name, url, sha, checked, date, version, now, findings, held, facts, bom, osv, usage, subject = null }) {
  const by = bySection(findings);
  return {
    format: "inspection-report-v1",
    repository: { owner, name, url },
    // 0.5.0: what a plugin or skill repository is; an agent's report has none.
    ...(subject ? { subject } : {}),
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
 *
 * 0.4.0: each finding also carries the few fields of its detail the view
 * draws (WORKING_DETAIL: what was inspected, each skill's size, the agent's
 * own code, the count of tests, each system's need and what the person
 * supplies, each risk's fix), so a field on the page is filled while the job
 * runs, never shown empty. When the copy does not fit, the words are left
 * out first, then these fields, then findings.
 */
export const WORKING_DETAIL = {
  repository: ["owner", "name", "url"], commit: ["sha", "date", "checked", "newest_on"], publisher: ["login", "type"], license: ["spdx"],
  "built-on": ["languages", "frameworks"], activity: ["pushed_at", "archived", "commits_last_90_days"],
  skill: ["name", "path", "size", "own", "for_coding_assistants", "instructions_only", "lift_out", "plain", "does"],
  code: ["files", "lines"], test: ["files", "cases", "live"],
  system: ["system", "need", "need_by", "supply", "without", "sends", "credentials"],
  credential: ["env", "how", "need", "need_by", "need_why", "read_by_code", "from"],
  risk: ["safe", "hook"],
  // 0.5.0: a plugin's parts and what it is.
  subject: ["kind", "name", "display_name", "version", "author", "tools", "also_for"], plugins: ["plugins", "picked_by"],
  "slash-command": ["name", "size", "tools", "shell"], "sub-agent": ["name", "size", "tools", "shell"], rule: ["name", "size", "always"],
  "mcp-server": ["name", "transport", "local", "host", "package", "pinned", "auth", "supply", "tools"],
};
/** The fields the Overview and the systems' cards need, kept longest (0.4.5):
 *  when the copy is too big for every field, the rest go first. At the end of
 *  design-agent's job the whole copy of 206 findings dropped every field, and
 *  for six seconds the Overview drew "0 of 18" systems required. */
export const WORKING_DETAIL_FIRST = {
  repository: WORKING_DETAIL.repository, commit: WORKING_DETAIL.commit, publisher: WORKING_DETAIL.publisher, license: WORKING_DETAIL.license,
  "built-on": WORKING_DETAIL["built-on"], activity: WORKING_DETAIL.activity,
  skill: ["path", "size", "own", "for_coding_assistants", "instructions_only"],
  code: WORKING_DETAIL.code, test: WORKING_DETAIL.test,
  system: ["system", "need", "need_by", "supply", "credentials"],
  credential: ["env", "how", "need", "need_by", "read_by_code", "from"],
  subject: WORKING_DETAIL.subject, plugins: WORKING_DETAIL.plugins,
  "slash-command": ["size"], "sub-agent": ["size"], "mcp-server": ["name", "transport", "local", "host", "supply"],
};
export function workingCopy({ about, findings, stage, limit = WORKING_COPY_CHARS }) {
  const a = about ?? {};
  const shown = (f, fields = WORKING_DETAIL) => {
    const keep = fields[f.kind];
    if (!keep || !f.detail || typeof f.detail !== "object") return null;
    const out = Object.fromEntries(keep.filter((k) => f.detail[k] !== undefined && f.detail[k] !== null).map((k) => [k, f.detail[k]]));
    return Object.keys(out).length ? out : null;
  };
  const short = (f, words, detail = true) => {
    const ev = Array.isArray(f.evidence) ? f.evidence : [];
    const dt = detail === "first" ? shown(f, WORKING_DETAIL_FIRST) : detail ? shown(f) : null;
    return {
      id: f.id, section: f.section, kind: f.kind, title: f.title, ...(words ? { says: f.says } : {}), by: f.by,
      ...(f.level ? { level: f.level, ...(f.level_by ? { level_by: f.level_by } : {}) } : {}),
      ...(f.categories?.length ? { categories: f.categories } : {}),
      ...(f.repeats ? { repeats: f.repeats } : {}),
      ...(ev.length ? { evidence: [{ file: ev[0].file, line: ev[0].line }], ...(ev.length > 1 ? { more_evidence: ev.length - 1 } : {}) } : {}),
      ...(!ev.length && f.source?.length ? { source: [f.source[0]] } : {}),
      ...(dt ? { detail: dt } : {}),
    };
  };
  const all = [...findings].sort((x, y) => x.section - y.section);
  const doc = (list, words, omitted) => ({
    format: "inspection-report-v1",
    partial: { stage: trim(stage) || "Starting.", findings_so_far: all.length, omitted, says_left_out: !words },
    repository: { owner: a.owner, name: a.name, url: a.url },
    ...(a.subject ? { subject: a.subject } : {}),
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
  // The words go before the fields the view draws; then every field but
  // those the Overview and the systems' cards need (0.4.5); then those too.
  d = doc(all.map((f) => short(f, false)), false, 0);
  if (fits(d)) return d;
  d = doc(all.map((f) => short(f, false, "first")), false, 0);
  if (fits(d)) return d;
  let list = all.map((f) => short(f, false, false));
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
  const systemWord = { "code-host": "GitHub's records", "vulnerability-database": "OSV, the vulnerability database", "text-reasoning": "the model", screening: "AgentMesh's screening" };
  const from = !places.length && f.source?.length ? ` From ${mdText([...new Set(f.source.map((s) => systemWord[s.system] ?? s.system))].join(" and "))}.` : "";
  const d = f.detail ?? {};
  // 0.5.0: an MCP server says what the person supplies.
  const mcp = f.kind === "mcp-server" && d.supply ? ` You supply: ${mdText(d.supply)}.` : "";
  // 0.5.7: what the model found in a hook's own code, said on the hook's line.
  const also = Array.isArray(d.hook?.also) ? d.hook.also.map((a) => ` Also, ${mdText(String(a.title ?? "").replace(/^\w/, (c) => c.toLowerCase()))}: ${mdText(a.says)}${a.safe ? ` To make it safe: ${mdText(a.safe)}` : ""}`).join("") : "";
  const need = f.kind === "system" && d.need ? ` ${d.need === "required" ? "Required" : d.need === "optional" ? "Optional" : "Whether it is required is not clear from the code"}.${d.supply ? ` You supply: ${mdText(d.supply)}.` : ""}${d.without ? ` Without it: ${mdText(d.without)}.` : ""}` : "";
  const safe = d.safe ? ` To make it safe: ${mdText(d.safe)}` : "";
  // The names the code gives its models, for the reader who checks them (0.3.4).
  const named = f.kind === "model" && f.by === "script" && Array.isArray(d.models) && d.models.length ? ` Models as the code names them: ${d.models.map(mdText).join(", ")}.` : "";
  return `- ${level}**${mdText(f.title)}.** ${mdText(f.says)}${need}${mcp}${also}${named}${advisories}${safe}${cats ? ` Category: ${cats}.` : ""}${places.length ? ` At ${places.join(", ")}${more}.` : ""}${from}`;
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
    // 0.3.0: the commit's date only; a date the reader's time zone may move is left out.
    `Commit ${String(sha ?? "").slice(0, 7)}${r.commit.date ? `, committed ${day(r.commit.date)}` : ""}.`,
    "",
    `Repository: ${r.repository.url}`,
    "",
    // 0.5.0: what a plugin or skill repository is, and which plugin this is.
    ...(r.subject ? [`${r.subject.kind === "plugin" && r.subject.plugins?.length ? `This report is the plugin ${mdText(r.subject.name)}. ` : ""}${mdText(subjectWords(r.subject))}`, ""] : []),
    "## At a glance",
    "",
    `Risks by level: ${lv.critical} critical, ${lv.high} high, ${lv.medium} medium and ${lv.low} low.`,
    "",
  ];
  const glance = r.findings.filter((f) => f.section === 1 && f.kind !== "description");
  const described = r.findings.find((f) => f.section === 1 && f.kind === "description");
  if (described) lines.splice(lines.indexOf("## At a glance") + 2, 0, mdText(described.says), "");
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
    ...(report.subject?.kind === "plugin" ? [`plugin: ${report.subject.name}`] : []),
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
