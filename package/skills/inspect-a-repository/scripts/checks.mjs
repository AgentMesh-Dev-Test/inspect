// Check the judgments: the model drafts, and this decides what is delivered.
//
// A drafted judgment becomes a finding only when every rule below holds; one
// that does not is held back and listed with why, never dropped silently:
//
//   - it names a section the call was asked for and a kind of that section;
//   - it cites, by id, facts the scripts found, and at least one cited fact's
//     file and line checks against the commit (the reverse engineer's
//     checkEvidence) or names the call it came from;
//   - in sections 3, 4 and 5 its words neither judge the code nor infer beyond
//     the facts (the reverse engineer's JUDGING and INFERRING, quoted words
//     left out);
//   - a risk has a level from the CVSS words and at least one category from a
//     published list: the two OWASP lists, an SPDX identifier a license fact
//     names, a package URL in the dependency list, or an OSV id found;
//   - it gives no verdict on bringing the agent in, and judges no fit.
//
//   needs: node >= 22. Nothing here reads or writes a file.
//   import { checkDrafts, checkGlance, VERDICT } from "./checks.mjs"
import { INFERRING, JUDGING, checkEvidence, unquoted } from "./evidence.mjs";
import { KINDS, LEVELS, LIST_IDS, PRECISE, categoryOf } from "./lists.mjs";
import { evidenceOf } from "./report.mjs";

const trim = (s) => String(s ?? "").trim();

/** Words that give a verdict on bringing the agent in, or judge its fit. */
export const VERDICT = /\b(?:safe to (?:bring|use|install|adopt|deploy)|(?:do not|don't|should not|shouldn't|must not) (?:bring|use|install|adopt|deploy)(?: (?:it|this))? in|we recommend (?:bringing|using|adopting|installing|against)|(?:i|we) (?:would )?recommend (?:bringing|using|adopting|installing|against)|recommend(?:ed)? (?:bringing|adopting|against adopting)|bring (?:it|this agent|the agent) in\b|(?:is|is not|isn't) (?:a )?(?:good |poor |bad )?fit|fits? (?:the|your|our) (?:plan|roadmap|department)|catalog role|go\/no-go|not recommended for adoption|approve (?:it|this agent) for)\b/i;

/**
 * Words a manager would not write (0.2.6, judge.mjs PLAIN_RULE): code, files
 * and Inspect's own internal word. Each is a reason to hold a judgment back;
 * files and names as the code writes them belong only in its evidence.
 */
export const NOT_PLAIN = [
  ["backquotes", /`/],
  ["a file name", /\b[\w.-]+\.(?:py|mjs|cjs|js|jsx|ts|tsx|json|ya?ml|toml|md|sh|lock|txt|env|cfg|ini|html|css|go|rs|rb|java|ipynb)\b/i],
  ["a path", /\b[\w.-]+\/[\w.-]+\/[\w./-]+/],
  ["a line number", /\w:\d+\b/],
  ["a name with an underscore", /\b\w+_\w+\b/],
  ["a dotted name", /\b[a-z_][a-z0-9_]+\.[a-z_][a-z0-9_]+\b/],
  ["a call with brackets", /\b\w+\(\)/],
  // A command as typed ("npm install", "npx hyperframes", "through gh"); the
  // name of a registry or a tool said in passing ("packages from npm") is plain.
  ["a command line", /\b(?:npm|pnpm|yarn|pip|pipx|uv)\s+(?:install|i|add|run|exec|ci|sync)\b|\b(?:npx|uvx|sudo|kubectl|wget)\s+\S|\bcurl\s+-|\bgh\s+[a-z]+\b|\bthrough gh\b|\bgit (?:clone|pull|push|checkout)\b/i],
  ["a version tag", /@(?:latest|next|\d)|(?:^|\s)@[\w-]+\//i],
  ["an advisory id", /\b(?:GHSA|CVE)-/i],
  ["a finding code", /\bS[1-8]-\d{3}\b/],
  ["an internal word", /\bthe facts?\b/i],
];
/** The first thing in `text` a manager would not write, as {what, match}, or null. */
export function notPlain(text) {
  for (const [what, re] of NOT_PLAIN) {
    const m = re.exec(String(text ?? ""));
    if (m) return { what, match: m[0].trim() };
  }
  return null;
}
/** Why a judgment was held back, in words that quote none of it. */
const plainWhy = (p) => `it puts ${p.what} in its words, which belong only in its evidence`;
/**
 * Inspect's own word for what the scripts found, said as a person would
 * (0.2.7): "the facts show" is "the code shows". The model is told not to
 * write it; this keeps a judgment that does anyway rather than losing it.
 */
export function plainWords(text) {
  return String(text ?? "")
    .replace(/\b(t|T)he facts (?:do|does) not show\b/g, (m, t) => `${t}he code does not show`)
    .replace(/\b(t|T)he facts (?:show|shows)\b/g, (m, t) => `${t}he code shows`)
    .replace(/\b(t|T)he facts (?:say|says)\b/g, (m, t) => `${t}he code says`)
    .replace(/\b(t|T)he facts? (?:found|given|listed|here)\b/g, (m, t) => `${t}he code`)
    .replace(/\b(t|T)he facts\b/g, (m, t) => `${t}he code`);
}

// ── Said once, and detail a person reads (0.3.0) ──
/** The kinds that may say the same thing: what could not be told and the
 *  questions for the publisher are one group; every other kind its own. */
const kindGroup = (k) => (k === "could-not-tell" || k === "question" ? "unsettled" : k);
// Words that mean a person's approval, said as one word, and the words a
// title carries that say nothing of its subject.
const SAME = [
  [/\b(?:wait(?:s|ing)? for (?:a |the )?(?:person|human|people)|(?:a |the )?(?:person|human)(?:'s)? (?:ok|okay|approval|sign-?off)|an? ok\b|okay|sign-?offs?|approv(?:e|es|ed|al|als|ing)|human review|confirmation)/g, " approval "],
];
const FILLER = new Set("a an the which what who whom whose when where why how is are was were be been being do does did to for of in on at by with without and or but it its this that these those there their they them should would could can may might must need needs needed run runs running ran time deployed deploy deployment any some all each every not no yes".split(" "));
const wordsOf = (t) => {
  let s = ` ${String(t ?? "").toLowerCase()} `;
  for (const [re, w] of SAME) s = s.replace(re, w);
  return new Set(s.split(/[^a-z0-9]+/).filter((w) => w && !FILLER.has(w)).map((w) => (w.length > 3 ? w.replace(/(?:ies)$/, "y").replace(/(?<!s)s$/, "") : w)));
};
/** Whether two titles say the same thing: once their filler is gone, nearly
 *  every word of the shorter is in the longer. */
export function nearSame(a, b) {
  const x = wordsOf(a); const y = wordsOf(b);
  const small = Math.min(x.size, y.size);
  if (small < 2) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both += 1;
  return both / small >= 0.75;
}
/** The fields of a judgment's detail a person reads, by kind. */
export const SHOWN = { system: ["supply", "without", "sends"], risk: ["safe"], job: ["does"], code: ["covers"] };
/** A judgment's detail with each field a person reads in plain words: Inspect's
 *  own word said as a person would, and a field that is still not plain left
 *  out (the finding stands without it). A system's need is one of the three. */
export function plainDetail(kind, detail) {
  const out = { ...detail };
  for (const k of SHOWN[kind] ?? []) {
    if (typeof out[k] !== "string") { delete out[k]; continue; }
    out[k] = plainWords(trim(out[k]));
    if (!out[k] || notPlain(out[k])) delete out[k];
  }
  if (kind === "system") out.need = ["required", "optional", "unclear"].includes(trim(out.need).toLowerCase()) ? trim(out.need).toLowerCase() : "unclear";
  return out;
}
/**
 * The description of the agent (0.3.0): two to four plain sentences that open
 * section 1. {kept: finding | null, held: [...]}. It rests on the findings of
 * sections 3 to 5 it describes: their facts are its facts.
 */
export function checkDescription(text, findings, { most = 700 } = {}) {
  const says = plainWords(trim(text).replace(/\s+/g, " "));
  const held = (why) => ({ kept: null, held: [{ section: 1, title: "What it is", ...(says ? { says } : {}), why }] });
  if (!says) return { kept: null, held: [] };
  const v = VERDICT.exec(unquoted(says));
  if (v) return held(`it gives a verdict or judges fit ("${v[0]}"), which Inspect does not`);
  const p = notPlain(says);
  if (p) return held(plainWhy(p));
  if (says.length > most) return held(`it is longer than ${most} characters, and a description is two to four sentences`);
  const rest = findings.filter((f) => [3, 4, 5].includes(f.section) && f.by === "model");
  const based_on = [...new Set(rest.flatMap((f) => f.based_on ?? []))].slice(0, 40);
  const evidence = []; const source = [];
  for (const f of rest) {
    for (const e of f.evidence ?? []) if (evidence.length < 8 && !evidence.some((x) => x.file === e.file && x.line === e.line)) evidence.push(e);
    for (const s of f.source ?? []) if (source.length < 4 && !source.some((x) => x.call === s.call)) source.push(s);
  }
  if (!based_on.length || (!evidence.length && !source.length)) return held("there are no findings of sections 3 to 5 for it to rest on");
  return { kept: { section: 1, kind: "description", title: "What it is", says, by: "model", based_on, ...(evidence.length ? { evidence } : {}), ...(source.length ? { source } : {}) }, held: [] };
}

/**
 * The model's name and words for each skill (0.3.3): {kept: Map(fact id →
 * {title, does}), held: [...]}. A title is three to eight plain words (two to
 * ten are taken) with no full stop; its words are one or two plain sentences
 * that do not say the title again and give no verdict. One that breaks a rule
 * is held back with why, and the skill keeps the scripts' title.
 */
export function checkSkillNames(entries, byId) {
  const kept = new Map(); const held = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const id = trim(e?.skill); const fact = byId.get(id);
    const title = plainWords(trim(e?.title)).replace(/\s+/g, " "); const does = plainWords(trim(e?.does)).replace(/\s+/g, " ");
    const hold = (why) => held.push({ section: 3, title: title || "(a skill with no name)", ...(does ? { says: does } : {}), why });
    if (!fact || fact.kind !== "skill") { hold(`it names ${JSON.stringify(e?.skill ?? null)}, which is not a skill the scripts found`); continue; }
    if (kept.has(id)) continue;
    const words = title.split(" ").filter(Boolean).length;
    if (words < 2 || words > 10 || /[.!?;:]$/.test(title)) { hold("its name is not a short plain name of three to eight words"); continue; }
    const sentences = does.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    if (!does || sentences > 2 || does.length > 320) { hold("its words are not one or two plain sentences"); continue; }
    if (does.toLowerCase().includes(title.toLowerCase())) { hold("its words say its name again"); continue; }
    if (/^(?:use|invoke|run|call|trigger)\b|\b(?:use (?:this|it) (?:when|for)|route by)\b/i.test(does)) { hold("its words are written for a model, not a person"); continue; }
    const p = notPlain(`${title} ${does}`);
    if (p) { hold(plainWhy(p)); continue; }
    const v = VERDICT.exec(unquoted(does));
    if (v) { hold(`it gives a verdict or judges fit ("${v[0]}"), which Inspect does not`); continue; }
    kept.set(id, { title: `${title[0].toUpperCase()}${title.slice(1)}`, does });
  }
  return { kept, held };
}

/** A category the draft names, resolved against the lists and the facts: {list, id, name} or null. */
export function resolveCategory(raw, { spdx = new Set(), purls = new Set(), osv = new Set() } = {}) {
  const s = trim(typeof raw === "string" ? raw : raw?.id).replace(/^(\S+)\s.*$/, "$1");
  if (!s) return null;
  const owasp = categoryOf(s);
  if (owasp) return owasp;
  if (spdx.has(s)) return { list: LIST_IDS.spdx, id: s, name: s };
  if (purls.has(s)) return { list: LIST_IDS.cyclonedx, id: s, name: s };
  if (osv.has(s)) return { list: LIST_IDS.osv, id: s, name: s };
  return null;
}

/**
 * Check one call's drafts: {kept: [finding without id], held: [{section, title, says, why}]}.
 * `sections` the call was asked for; `byId` the facts; `ctx` the evidence
 * context (evidence.mjs contextFor); `known` the SPDX ids, package URLs and
 * OSV ids the facts hold.
 */
export function checkDrafts(drafts, { sections, byId, ctx, known = {} }) {
  const kept = []; const held = [];
  for (const d of Array.isArray(drafts) ? drafts : []) {
    const section = Number(d?.section);
    const title = plainWords(trim(d?.title)); const says = plainWords(trim(d?.says));
    const hold = (why) => held.push({ section: Number.isInteger(section) && section >= 1 && section <= 8 ? section : sections[0], title: title || "(no title)", ...(says ? { says } : {}), why });
    if (!sections.includes(section)) { hold(`it names section ${JSON.stringify(d?.section)}, which this judgment was not asked for`); continue; }
    if (!KINDS[section].includes(trim(d?.kind))) { hold(`its kind ${JSON.stringify(d?.kind)} is not one section ${section} holds`); continue; }
    if (!title || !says) { hold("it has no title or no words"); continue; }
    const ids = (Array.isArray(d?.based_on) ? d.based_on : []).map(trim).filter(Boolean);
    if (!ids.length) { hold("it cites no fact the scripts found"); continue; }
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) { hold(`it cites ${unknown.join(", ")}, which the scripts did not find`); continue; }
    const cited = ids.map((id) => byId.get(id));
    const { evidence, source } = evidenceOf(cited, ctx);
    const fileFacts = cited.filter((f) => f.file);
    if (fileFacts.length && !evidence.length) {
      const { failed } = checkEvidence(fileFacts.map((f) => ({ file: f.file, line: f.line })), ctx);
      hold(`none of its evidence checks against the commit: ${failed.map((x) => x.why).join("; ")}`);
      continue;
    }
    if (!evidence.length && !source.length) { hold("none of the facts it cites has a file and line or a call"); continue; }
    const words = unquoted(`${title} ${says}`);
    if (PRECISE.has(section)) {
      const j = JUDGING.exec(words); if (j) { hold(`it judges ("${j[0]}"), and section ${section} says only what the code shows`); continue; }
      const i = INFERRING.exec(words); if (i) { hold(`it infers ("${i[0]}"), and section ${section} says only what the code shows`); continue; }
    }
    const v = VERDICT.exec(words);
    if (v) { hold(`it gives a verdict or judges fit ("${v[0]}"), which Inspect does not`); continue; }
    const p = notPlain(`${title} ${says}`);
    if (p) { hold(plainWhy(p)); continue; }
    // Said once (0.3.0): a title that says or asks what another of the same
    // section and the same group of kinds says is held back.
    const twin = kept.find((k) => k.section === section && kindGroup(k.kind) === kindGroup(trim(d.kind)) && nearSame(k.title, title));
    if (twin) { hold(`it says what "${twin.title}" says`); continue; }
    const f = { section, kind: trim(d.kind), title, says, by: "model", based_on: ids, ...(evidence.length ? { evidence } : {}), ...(source.length ? { source } : {}) };
    if (d.detail && typeof d.detail === "object" && !Array.isArray(d.detail)) f.detail = plainDetail(f.kind, d.detail);
    if (f.kind === "risk") {
      const level = trim(d.level).toLowerCase();
      if (!LEVELS.includes(level)) { hold(`its level ${JSON.stringify(d.level ?? null)} is not one of ${LEVELS.join(", ")}`); continue; }
      const cats = (Array.isArray(d.categories) ? d.categories : [d.categories]).map((c) => resolveCategory(c, known)).filter(Boolean);
      if (!cats.length) { hold(`its category ${JSON.stringify(d.categories ?? null)} is on no published list it may use`); continue; }
      f.level = level; f.level_by = "model"; f.categories = cats;
    }
    kept.push(f);
  }
  return { kept, held };
}

/**
 * Check section 1's drafts against the findings delivered: {kept, held}. At
 * most `most`, each repeating a finding of sections 2 to 8 and carrying its
 * evidence and source.
 */
export function checkGlance(drafts, findings, { most = 5 } = {}) {
  const kept = []; const held = [];
  const byId = new Map(findings.filter((f) => f.section >= 2).map((f) => [f.id, f]));
  for (const d of Array.isArray(drafts) ? drafts : []) {
    const target = byId.get(trim(d?.repeats));
    const says = plainWords(trim(d?.says));
    if (!target) { held.push({ section: 1, title: says || "(no words)", why: `it repeats ${JSON.stringify(d?.repeats ?? null)}, which is not a finding of sections 2 to 8` }); continue; }
    if (!says) { held.push({ section: 1, title: target.title, why: "it has no words" }); continue; }
    const v = VERDICT.exec(unquoted(says));
    if (v) { held.push({ section: 1, title: target.title, says, why: `it gives a verdict or judges fit ("${v[0]}"), which Inspect does not` }); continue; }
    const p = notPlain(says);
    if (p) { held.push({ section: 1, title: target.title, says, why: plainWhy(p) }); continue; }
    if (kept.some((k) => k.repeats === target.id)) continue;
    if (kept.length >= most) { held.push({ section: 1, title: target.title, says, why: `section 1 holds at most ${most} findings` }); continue; }
    kept.push({ section: 1, kind: "glance", title: target.title, says, by: "model", based_on: target.based_on, repeats: target.id, ...(target.evidence ? { evidence: target.evidence } : {}), ...(target.source ? { source: target.source } : {}), ...(target.level ? { level: target.level, level_by: target.level_by } : {}) });
  }
  return { kept, held };
}
