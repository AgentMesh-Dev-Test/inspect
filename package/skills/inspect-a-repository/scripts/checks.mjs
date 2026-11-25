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
    const title = trim(d?.title); const says = trim(d?.says);
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
      const j = JUDGING.exec(words); if (j) { hold(`it judges ("${j[0]}"), and section ${section} says only what the facts show`); continue; }
      const i = INFERRING.exec(words); if (i) { hold(`it infers ("${i[0]}"), and section ${section} says only what the facts show`); continue; }
    }
    const v = VERDICT.exec(words);
    if (v) { hold(`it gives a verdict or judges fit ("${v[0]}"), which Inspect does not`); continue; }
    const f = { section, kind: trim(d.kind), title, says, by: "model", based_on: ids, ...(evidence.length ? { evidence } : {}), ...(source.length ? { source } : {}) };
    if (d.detail && typeof d.detail === "object" && !Array.isArray(d.detail)) f.detail = d.detail;
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
    const says = trim(d?.says);
    if (!target) { held.push({ section: 1, title: says || "(no words)", why: `it repeats ${JSON.stringify(d?.repeats ?? null)}, which is not a finding of sections 2 to 8` }); continue; }
    if (!says) { held.push({ section: 1, title: target.title, why: "it has no words" }); continue; }
    const v = VERDICT.exec(unquoted(says));
    if (v) { held.push({ section: 1, title: target.title, says, why: `it gives a verdict or judges fit ("${v[0]}"), which Inspect does not` }); continue; }
    if (kept.some((k) => k.repeats === target.id)) continue;
    if (kept.length >= most) { held.push({ section: 1, title: target.title, says, why: `section 1 holds at most ${most} findings` }); continue; }
    kept.push({ section: 1, kind: "glance", title: target.title, says, by: "model", based_on: target.based_on, repeats: target.id, ...(target.evidence ? { evidence: target.evidence } : {}), ...(target.source ? { source: target.source } : {}), ...(target.level ? { level: target.level, level_by: target.level_by } : {}) });
  }
  return { kept, held };
}
