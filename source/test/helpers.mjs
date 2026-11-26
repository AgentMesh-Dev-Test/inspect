// What every test of Inspect is handed instead of the world: an archive
// built here, stand-ins for GitHub, OSV and the model, a small JSON Schema
// checker, and temporary folders removed whatever happened.
//
// Nothing here touches a network: GitHub and OSV are a fetch function that
// answers from the values a test gives it, at made-up addresses, and the model
// is an ask function that answers from the test's drafts.
//   imported by the test files; never run on its own
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");
export const API = "https://api.github.test";
export const OSV = "https://osv.test";
export const ENV = { GITHUB_API: API, OSV_API: OSV };
export const SHA = "86d8f667796890eb6d3612dbd1b9e941782fe03f";

/** A temporary folder for `fn`, removed afterwards whatever happened. */
export async function inTemp(fn) {
  const at = mkdtempSync(join(tmpdir(), "inspect-test-"));
  try { return await fn(at); } finally { rmSync(at, { recursive: true, force: true }); }
}

const BLOCK = 512;
function header({ name, size = 0, type = "0", link = "" }) {
  const h = Buffer.alloc(BLOCK);
  let n = name; let prefix = "";
  if (Buffer.byteLength(n) > 100) { const cut = n.lastIndexOf("/", 154); prefix = n.slice(0, cut); n = n.slice(cut + 1); }
  h.write(n, 0, "utf8");
  h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.fill(0x20, 148, 156);
  h.write(type, 156, "latin1");
  h.write(link, 157, "utf8");
  h.write("ustar\0", 257); h.write("00", 263);
  h.write(prefix, 345, "utf8");
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "latin1");
  return h;
}
const pad = (b) => (b.length % BLOCK ? Buffer.concat([b, Buffer.alloc(BLOCK - (b.length % BLOCK))]) : b);
function paxBody(records) {
  return Buffer.from(Object.entries(records).map(([k, v]) => {
    const rest = ` ${k}=${v}\n`;
    let len = rest.length + 2;
    while (String(len).length + rest.length !== len) len = String(len).length + rest.length;
    return `${len}${rest}`;
  }).join(""), "utf8");
}

/**
 * GitHub's archive of a commit, as bytes: a pax global header naming the
 * commit, then every file under one top folder. `files` maps a path to its
 * text or bytes; `links` maps a path to where it points; `raw` entries keep
 * their own path (for one that climbs out).
 */
export function archiveOf(files, { commit = SHA, top = "acme-helper-86d8f66", links = {}, raw = [] } = {}) {
  const parts = [];
  if (commit) { const body = paxBody({ comment: commit }); parts.push(header({ name: "pax_global_header", size: body.length, type: "g" }), pad(body)); }
  parts.push(header({ name: `${top}/`, type: "5" }));
  for (const [path, content] of Object.entries(files)) {
    const body = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
    parts.push(header({ name: `${top}/${path}`, size: body.length }), pad(body));
  }
  for (const [path, to] of Object.entries(links)) parts.push(header({ name: `${top}/${path}`, type: "2", link: to }));
  for (const { name, content } of raw) { const body = Buffer.from(content); parts.push(header({ name, size: body.length }), pad(body)); }
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts));
}

/** A response a fetch answers with. */
export function response(status, { json = undefined, bytes = null, headers = {} } = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => h[k.toLowerCase()] ?? null },
    json: async () => json,
    text: async () => (json === undefined ? "" : JSON.stringify(json)),
    arrayBuffer: async () => (bytes ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) : new ArrayBuffer(0)),
    body: bytes ? (async function* () { yield bytes; })() : null,
  };
}

/** The repository's record as GitHub's API gives it. */
export const repoRecord = (over = {}) => ({ full_name: "acme/helper", html_url: "https://github.com/acme/helper", private: false, owner: { login: "acme", type: "Organization" }, license: { spdx_id: "Apache-2.0" }, pushed_at: "2026-11-23T21:25:28Z", created_at: "2026-10-18T04:44:58Z", archived: false, open_issues_count: 2, stargazers_count: 761, default_branch: "main", ...over });

/**
 * A fetch that answers as GitHub and OSV would, from the test's values, and
 * records every call: {fetchImpl, calls}. `github.status` maps a part of a
 * path to the status that call answers with.
 */
export function world({ files = {}, links = {}, raw = [], commit = SHA, archiveCommit = commit, repo = repoRecord(), status = {}, archiveLength = null, commits = 72, osv = {}, osvStatus = null } = {}) {
  const calls = [];
  const archive = archiveOf(files, { commit: archiveCommit, links, raw });
  const fetchImpl = async (url, opts = {}) => {
    const method = (opts.method ?? "GET").toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method, body });
    const u = new URL(url);
    if (url.startsWith(API)) {
      for (const [part, s] of Object.entries(status)) if (u.pathname.includes(part)) return response(s, { json: { message: "no" }, headers: s === 403 ? { "x-ratelimit-remaining": 0 } : {} });
      if (/\/tarball\//.test(u.pathname)) return response(200, { bytes: archive, headers: archiveLength ? { "content-length": archiveLength } : { "content-length": archive.length } });
      // A commit's record, by its digest or, for the newest, by the default branch's name (0.4.0).
      if (/\/commits\/[0-9a-f]+$/.test(u.pathname) || u.pathname.endsWith(`/commits/${repo.default_branch}`)) return response(200, { json: { sha: commit, commit: { committer: { date: "2026-11-23T21:25:23Z" } } } });
      if (/\/commits$/.test(u.pathname)) return response(200, { json: Array.from({ length: commits }, (_, i) => ({ sha: String(i) })) });
      if (/^\/repos\/[^/]+\/[^/]+$/.test(u.pathname)) return response(200, { json: repo });
      return response(404, { json: { message: "Not Found" } });
    }
    if (url.startsWith(OSV)) {
      if (osvStatus) return response(osvStatus, { json: { message: "osv failed" } });
      if (u.pathname === "/v1/querybatch") return response(200, { json: { results: body.queries.map((q) => ({ vulns: (osv.affects?.[`${q.package.ecosystem}:${q.package.name}@${q.version}`] ?? []).map((id) => ({ id })) })) } });
      const id = decodeURIComponent(u.pathname.split("/").pop());
      return osv.records?.[id] ? response(200, { json: osv.records[id] }) : response(404, { json: { message: "no" } });
    }
    throw new Error(`a test reached ${url}, which is not a stand-in`);
  };
  return { fetchImpl, calls, archive };
}

/** A model stand-in: answers each call from `answers` in order ({findings} or {glance}), and records each call. */
export function model(answers = []) {
  const asked = [];
  const ask = async (prompt, options) => {
    asked.push({ prompt, options });
    const a = answers[asked.length - 1];
    if (a instanceof Error) throw a;
    if (typeof a === "function") return a(prompt, options);
    const doc = a ?? (prompt.includes('"glance"') ? { glance: [] } : { findings: [] });
    return { text: JSON.stringify(doc), tokens_in: 10, tokens_out: 5 };
  };
  return { ask, asked };
}

/** A model failure as the shared caller throws it. */
export function modelFailure(message) { const e = new Error(message); e.modelFailure = true; return e; }

/** The package's own descriptor beside test/. */
export const descriptor = () => JSON.parse(readFileSync(join(ROOT, "agent-descriptor.json"), "utf8"));

/** The report's JSON Schema, as the package declares its inspection output. */
export const reportSchema = () => descriptor().offerings[0].outputs.find((o) => o.name === "inspection").schema;

/** The problems of a value against a JSON Schema (the parts the report's schema uses): [] when it fits. */
export function schemaProblems(value, schema, root = schema, at = "$") {
  const out = [];
  if (schema.$ref) return schemaProblems(value, schema.$ref.replace(/^#\/\$defs\//, "").split("/").reduce((s, k) => s[k], root.$defs), root, at);
  const typeOk = (t) => (t === "null" ? value === null : t === "array" ? Array.isArray(value) : t === "integer" ? Number.isInteger(value) : t === "object" ? value !== null && typeof value === "object" && !Array.isArray(value) : typeof value === t);
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(typeOk)) return [`${at} is not ${schema.type}`];
  if ("const" in schema && value !== schema.const) out.push(`${at} is not ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) out.push(`${at} ${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) out.push(`${at} does not match ${schema.pattern}`);
  if (schema.minLength && typeof value === "string" && value.length < schema.minLength) out.push(`${at} is too short`);
  if (typeof value === "number") { if (schema.minimum !== undefined && value < schema.minimum) out.push(`${at} is under ${schema.minimum}`); if (schema.maximum !== undefined && value > schema.maximum) out.push(`${at} is over ${schema.maximum}`); }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push(`${at} has fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push(`${at} has more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => out.push(...schemaProblems(v, schema.items, root, `${at}[${i}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) out.push(`${at} lacks ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) out.push(...schemaProblems(v, schema.properties[k], root, `${at}.${k}`));
      else if (schema.additionalProperties === false) out.push(`${at} has ${k}, which the schema does not allow`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") out.push(...schemaProblems(v, schema.additionalProperties, root, `${at}.${k}`));
    }
  }
  if (schema.anyOf && !schema.anyOf.some((s) => schemaProblems(value, s, root, at).length === 0)) out.push(`${at} fits none of its anyOf`);
  return out;
}

/** A small agent's codebase, as files. */
export function smallAgent(extra = {}) {
  return {
    "LICENSE": "                                 Apache License\n                           Version 2.0, January 2004\n",
    "pyproject.toml": "[project]\nname = \"helper\"\nlicense = \"Apache-2.0\"\ndependencies = [\n  \"langgraph>=1.0\",\n  \"httpx>=0.27\",\n]\n",
    "uv.lock": "version = 1\n\n[[package]]\nname = \"helper\"\nversion = \"0.1.0\"\nsource = { editable = \".\" }\n\n[[package]]\nname = \"httpx\"\nversion = \"0.27.0\"\nsource = { registry = \"https://pypi.org/simple\" }\n",
    "src/agent.py": "import os\nfrom langgraph.graph import StateGraph\n\nMODEL = os.environ.get(\"HELPER_MODEL\", \"anthropic:claude-sonnet-5-5\")\n\ndef run():\n    return StateGraph\n",
    "tests/test_agent.py": "def test_runs():\n    assert True\n",
    ...extra,
  };
}
