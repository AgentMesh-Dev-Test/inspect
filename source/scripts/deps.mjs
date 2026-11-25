// The dependencies: a uv.lock read into the CycloneDX list, the line each
// component is written on, and OSV asked which exact versions have known
// vulnerabilities.
//
// The bill of materials itself is the reverse engineer's (sbom.mjs makeSbom,
// carried byte for byte), which reads package-lock.json, npm-shrinkwrap.json,
// package.json, requirements.txt, go.mod and Cargo.lock, and lists a uv.lock
// as a lockfile it does not read. Inspect reads uv.lock here and adds its
// packages to the same list, each with its package URL.
//
// OSV is asked by POST /v1/querybatch, a query that reads and writes nothing,
// at most QUERY_SIZE components a query and QUERIES queries a job, then each
// vulnerability found is read with GET /v1/vulns/{id}, at most VULN_READS. A
// vulnerability's level is OSV's record's own: its severity word, or the base
// score of a CVSS 3 vector it carries, in the CVSS qualitative words.
// OSV's address is OSV_API, read on every run and written nowhere here.
//
//   needs: node >= 22; OSV_API for checkWithOsv
//   import { fromUvLock, addUvLock, lineOfComponent, ecosystemOf, checkWithOsv, cvss3Score } from "./deps.mjs"
import { posix } from "node:path";
import { linesOf } from "./codebase.mjs";
import { levelOf } from "./lists.mjs";

const trim = (s) => String(s ?? "").trim();

export const QUERY_SIZE = 1000;
export const QUERIES = 10;
export const VULN_READS = 60;
export const CALL_MS = 30_000;

/** The packages a uv.lock pins: [{name, version, line, source}]; the project's own (editable, virtual) left out. */
export function fromUvLock(text) {
  const out = [];
  let cur = null;
  const flush = () => { if (cur?.name && cur.version && !/editable|virtual|path\s*=/.test(cur.source)) out.push(cur); cur = null; };
  linesOf(text).forEach((line, i) => {
    if (/^\s*\[\[package\]\]\s*$/.test(line)) { flush(); cur = { name: "", version: "", line: i + 1, source: "" }; return; }
    if (/^\s*\[/.test(line) && !/^\s*\[\[package\]\]/.test(line)) { if (cur && !/^\s*\[package\./.test(line)) { flush(); } return; }
    if (!cur) return;
    const m = /^\s*(name|version|source)\s*=\s*(.+?)\s*$/.exec(line);
    if (!m) return;
    if (m[1] === "source") { if (!cur.source) cur.source = m[2]; return; }
    if (cur[m[1]]) return;
    const v = /^"([^"]*)"/.exec(m[2]);
    if (v) { cur[m[1]] = v[1]; if (m[1] === "name") cur.line = i + 1; }
  });
  flush();
  return out;
}

/** The PyPI package URL of a name and version, its name normalized as PEP 503 says. */
export const pypiPurl = (name, version) => `pkg:pypi/${encodeURIComponent(name.toLowerCase().replace(/[-_.]+/g, "-"))}@${encodeURIComponent(version)}`;

/** The bill of materials with every uv.lock's packages added (a new object); the uv.lock gap is taken out for each one read. */
export function addUvLock(bom, gaps, files, read) {
  const components = [...(bom?.components ?? [])];
  const known = new Set(components.map((c) => c["bom-ref"]));
  const readLocks = [];
  for (const f of files.filter((x) => posix.basename(x) === "uv.lock")) {
    const text = read(f);
    if (text === null || text === undefined) continue;
    readLocks.push(f);
    for (const p of fromUvLock(text)) {
      const ref = pypiPurl(p.name, p.version);
      if (known.has(ref)) continue;
      known.add(ref);
      components.push({ type: "library", "bom-ref": ref, name: p.name.toLowerCase().replace(/[-_.]+/g, "-"), version: p.version, purl: ref, evidence: { occurrences: [{ location: f, line: p.line }] } });
    }
  }
  components.sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"]));
  const props = [...(bom?.metadata?.properties ?? []), ...readLocks.map((f) => ({ name: "inspect:read-from", value: f }))];
  const next = { ...bom, metadata: { ...(bom?.metadata ?? {}), properties: props }, components };
  const dependencies = [...(bom?.dependencies ?? [])];
  for (const c of components) if (!dependencies.some((d) => d.ref === c["bom-ref"])) dependencies.push({ ref: c["bom-ref"], dependsOn: [] });
  next.dependencies = dependencies;
  const left = (gaps ?? []).filter((g) => !readLocks.some((f) => g.about === `the packages in ${f}`));
  return { bom: next, gaps: left };
}

/** Where a component was read: {file, line}, its line found in the file's text. */
export function lineOfComponent(c, read) {
  const occ = c?.evidence?.occurrences?.[0] ?? {};
  const file = trim(occ.location);
  if (!file) return null;
  if (Number.isInteger(occ.line)) return { file, line: occ.line };
  const text = read(file);
  if (text === null || text === undefined) return { file, line: 1 };
  const lines = linesOf(text);
  const name = trim(c.name);
  const tries = [`"node_modules/${name}"`, `"${name}":`, `${name}==`, `${name} ==`, `${name} `, name];
  for (const t of tries) {
    const i = lines.findIndex((l) => l.includes(t));
    if (i >= 0) return { file, line: i + 1 };
  }
  return { file, line: 1 };
}

/** OSV's ecosystem for a package URL, or null when OSV is not asked about it. */
export function ecosystemOf(purl) {
  const m = /^pkg:([a-z]+)\//.exec(trim(purl));
  return m ? ({ npm: "npm", pypi: "PyPI", golang: "Go", cargo: "crates.io" })[m[1]] ?? null : null;
}

/** Whether a component names one exact version (not a range). */
export function isExact(c) {
  if (!trim(c?.version)) return false;
  if ((c.properties ?? []).some((p) => /range/.test(p.name) && p.value === "true")) return false;
  return !/[\^~<>=*| ]|^v?\d+(\.\d+)?\.x/i.test(c.version);
}

/** The base score of a CVSS 3.0 or 3.1 vector, or null. */
export function cvss3Score(vector) {
  const v = Object.fromEntries(String(vector ?? "").split("/").slice(1).map((p) => p.split(":")));
  if (!/^CVSS:3\.[01]\//.test(String(vector ?? "")) || !v.AV || !v.AC || !v.PR || !v.UI || !v.S || !v.C || !v.I || !v.A) return null;
  const changed = v.S === "C";
  const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[v.AV];
  const AC = { L: 0.77, H: 0.44 }[v.AC];
  const PR = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[v.PR];
  const UI = { N: 0.85, R: 0.62 }[v.UI];
  const cia = (x) => ({ H: 0.56, L: 0.22, N: 0 })[x];
  if ([AV, AC, PR, UI, cia(v.C), cia(v.I), cia(v.A)].some((x) => x === undefined)) return null;
  const iss = 1 - (1 - cia(v.C)) * (1 - cia(v.I)) * (1 - cia(v.A));
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  const exploit = 8.22 * AV * AC * PR * UI;
  if (impact <= 0) return 0;
  const roundup = (x) => { const n = Math.round(x * 100000); return n % 10000 === 0 ? n / 100000 : (Math.floor(n / 10000) + 1) / 10; };
  return roundup(Math.min(changed ? 1.08 * (impact + exploit) : impact + exploit, 10));
}

/** A CVSS score in the qualitative words. */
export const wordOfScore = (s) => (s === 0 ? "none" : s < 4 ? "low" : s < 7 ? "medium" : s < 9 ? "high" : "critical");

/** The level an OSV record gives, or null: its severity word, else a CVSS 3 vector's score. */
export function levelOfVuln(v) {
  const word = levelOf(v?.database_specific?.severity) ?? (v?.affected ?? []).map((a) => levelOf(a?.database_specific?.severity)).find(Boolean);
  if (word) return word;
  for (const s of v?.severity ?? []) {
    if (/^CVSS_V3/.test(trim(s?.type))) { const n = cvss3Score(s.score); if (n !== null) return wordOfScore(n); }
  }
  return null;
}

/** The version that fixes a vulnerability for one package, from OSV's ranges, or null. */
export function fixedIn(v, name, ecosystem) {
  for (const a of v?.affected ?? []) {
    if (a?.package?.ecosystem !== ecosystem || trim(a?.package?.name).toLowerCase().replace(/[-_.]+/g, "-") !== name.toLowerCase().replace(/[-_.]+/g, "-")) continue;
    for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) return e.fixed;
  }
  return null;
}

/**
 * Ask OSV about every exact component: {ok, found: [{component, vuln, level,
 * fixed}], not_checked: [{component, why}], unread: [ids], calls, said}. When
 * OSV fails, ok is false and `said` says what it answered; nothing is thrown.
 */
export async function checkWithOsv(components, { env = process.env, fetchImpl = fetch } = {}) {
  const api = trim(env?.OSV_API).replace(/\/+$/, "");
  const calls = [];
  const notChecked = [];
  const asked = [];
  for (const c of components) {
    const eco = ecosystemOf(c.purl ?? c["bom-ref"]);
    if (!eco) { notChecked.push({ component: c, why: "OSV is not asked about this ecosystem" }); continue; }
    if (!isExact(c)) { notChecked.push({ component: c, why: `only a range is given (${trim(c.version) || "no version"}), not one version` }); continue; }
    asked.push({ c, eco });
  }
  if (!api) return { ok: false, found: [], not_checked: notChecked, unread: [], calls, said: "the address of OSV's API (OSV_API) is not set here", asked: asked.length };
  const call = async (method, path, body) => {
    const entry = { call: `${method} ${path.replace(/\/vulns\/.+$/, "/vulns/{id}")}`, status: 0 };
    calls.push(entry);
    const res = await fetchImpl(`${api}${path}`, { method, headers: { "content-type": "application/json", accept: "application/json", "user-agent": "AgentMesh inspect" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(CALL_MS) }).catch((e) => ({ failed: trim(e?.message) || "no answer" }));
    if (res.failed) { entry.status = "no answer"; return { error: `OSV did not answer ${entry.call}: ${res.failed}` }; }
    entry.status = res.status;
    if (res.status >= 400) return { error: `OSV answered ${res.status} to ${entry.call}` };
    const data = await res.json().catch(() => null);
    return data ? { data } : { error: `OSV's answer to ${entry.call} was not JSON` };
  };
  const ids = new Map();
  const batches = [];
  for (let i = 0; i < asked.length; i += QUERY_SIZE) batches.push(asked.slice(i, i + QUERY_SIZE));
  for (const [n, batch] of batches.entries()) {
    if (n >= QUERIES) { for (const { c } of batch) notChecked.push({ component: c, why: `over the ${QUERIES * QUERY_SIZE} components OSV is asked about in one job` }); continue; }
    const r = await call("POST", "/v1/querybatch", { queries: batch.map(({ c, eco }) => ({ package: { name: c.name, ecosystem: eco }, version: c.version })) });
    if (r.error) return { ok: false, found: [], not_checked: notChecked, unread: [], calls, said: r.error, asked: asked.length };
    (r.data.results ?? []).forEach((res, k) => {
      for (const v of res?.vulns ?? []) {
        if (!ids.has(v.id)) ids.set(v.id, []);
        ids.get(v.id).push(batch[k]);
      }
    });
  }
  const found = []; const unread = [];
  let reads = 0;
  for (const [id, hits] of ids) {
    if (reads >= VULN_READS) { unread.push(id); continue; }
    reads += 1;
    const r = await call("GET", `/v1/vulns/${encodeURIComponent(id)}`);
    if (r.error) { unread.push(id); continue; }
    for (const { c, eco } of hits) found.push({ component: c, ecosystem: eco, vuln: { id: r.data.id ?? id, aliases: r.data.aliases ?? [], summary: trim(r.data.summary) }, level: levelOfVuln(r.data), fixed: fixedIn(r.data, c.name, eco) });
  }
  return { ok: true, found, not_checked: notChecked, unread, calls, asked: asked.length };
}
